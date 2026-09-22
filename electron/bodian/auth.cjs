const QRCode = require('qrcode');
const { BodianError } = require('./http.cjs');

// electron/bodian/auth.cjs

const QR_TTL_MS = 5 * 60 * 1000;

function publicUser(raw) {
  return { id: String(raw.uid ?? raw.id ?? ''), nickname: String(raw.nickname || ''),
    avatarUrl: String(raw.headImg || raw.avatarUrl || '') };
}

// Cancellation invalidates only the requested QR session and prevents an in-flight poll saving credentials.
function createAuthOperations({ client, sessions, now = Date.now }) {
  const qrSessions = new Map();
  const currentQr = key => {
    const session = qrSessions.get(key);
    if (!session || session.expiresAt <= now()) { qrSessions.delete(key); return null; }
    return session;
  };
  return {
    async login_qr_key() {
      for (const key of qrSessions.keys()) currentQr(key);
      if (qrSessions.size >= 5) throw new BodianError('unavailable', 'Too many pending Bodian logins');
      const { data } = await client.call('/api/ucenter/login/qrCode', { anonymous: true, signed: true });
      if (typeof data?.qrCode !== 'string' || !data.qrCode) throw new BodianError('invalid-response', 'Bodian QR key is missing');
      qrSessions.set(data.qrCode, { expiresAt: now() + QR_TTL_MS, revision: sessions.revision });
      return { key: data.qrCode };
    },
    async login_qr_create({ key }) {
      if (!currentQr(key)) throw new BodianError('unavailable', 'Bodian QR code expired');
      const url = new URL('https://bodian-oia.kuwo.cn/bodian/download.html');
      url.search = new URLSearchParams({ pageName: 'login_pc', pt: '3', id: key }).toString();
      return { imageUrl: await QRCode.toDataURL(url.toString(), { width: 320, margin: 3 }) };
    },
    async login_qr_check({ key }) {
      const qr = currentQr(key);
      if (!qr) return { state: 'expired' };
      const { data } = await client.call('/api/ucenter/login/qrCodeStatus', { params: { qrCode: key }, anonymous: true, signed: true });
      if (currentQr(key) !== qr || sessions.revision !== qr.revision) return { state: 'expired' };
      if (Number(data?.status) === 1) return { state: 'waiting' };
      if (Number(data?.status) === 2) { qrSessions.delete(key); return { state: 'expired' }; }
      let login = data;
      if (Number(data?.status) === 3) {
        try {
          login = (await client.call('/api/ucenter/users/login', {
            method: 'POST', body: { authType: 9, qrCode: key }, signed: true, anonymous: true,
          })).data;
        } catch (error) {
          if (error.upstreamCode === 11027) return { state: 'scanned' };
          throw error;
        }
      }
      if (currentQr(key) !== qr || sessions.revision !== qr.revision) return { state: 'expired' };
      const user = login?.userInfo || login?.user;
      const uid = login?.uid || login?.id || user?.uid || user?.id;
      const token = login?.token || user?.token;
      if (uid && typeof token === 'string' && token) {
        sessions.set({ uid, token, user: publicUser({ ...user, id: uid }) });
        qrSessions.clear();
        return { state: 'confirmed' };
      }
      throw new BodianError('invalid-response', 'Unrecognized Bodian QR status');
    },
    async login_qr_cancel({ key }) { qrSessions.delete(key); return null; },
    async login_status() {
      const session = sessions.get();
      if (!session) return null;
      const revision = sessions.revision;
      try {
        // Public profiles accept anonymous requests; authenticate against the user's private library first.
        await client.call('/api/service/playlist/userCreate', { params: { userId: session.uid } });
        const { data } = await client.call(`/api/ucenter/users/pub/${session.uid}`);
        if (sessions.revision !== revision) return null;
        if (!data?.userInfo) throw new BodianError('invalid-response', 'Bodian profile is missing');
        return publicUser({ ...data.userInfo, id: session.uid });
      } catch (error) {
        if (error.code === 'auth-required' && sessions.revision === revision) sessions.clear();
        throw error;
      }
    },
    async logout() { qrSessions.clear(); sessions.clear(); return null; },
  };
}

module.exports = { createAuthOperations, publicUser, QR_TTL_MS };
