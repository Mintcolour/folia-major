const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const { createBodianApiBridge } = require('../../electron/bodianApiBridge.cjs');

// test/manual/bodian-acceptance.cjs
// Uses only a fresh QR login in the isolated test profile, never the official client's credentials.
app.setPath('userData', path.resolve('test-results/bodian-desktop-profile'));
app.whenReady().then(async () => {
  const Store = require('electron-store').default;
  const store = new Store({ projectName: 'Folia' });
  let bridge = createBodianApiBridge({ store, safeStorage });
  const localKey = crypto.randomBytes(24).toString('hex');
  const resume = process.argv.includes('--resume');
  let state = resume ? 'confirmed' : 'waiting';
  const keyResponse = resume ? { ok: true, data: { key: '' } } : await bridge.request('login_qr_key');
  if (!keyResponse.ok) throw new Error(keyResponse.error.message);
  const key = keyResponse.data.key;
  const imagePath = path.resolve(`test-results/bodian-acceptance-${Date.now()}.png`);
  if (!resume) {
    const qr = await bridge.request('login_qr_create', { key });
    if (!qr.ok) throw new Error(qr.error.message);
    await fs.writeFile(imagePath, Buffer.from(qr.data.imageUrl.split(',')[1], 'base64'));
  }
  const redact = (key, value) => /token|secret|phone|mobile|freeSign|fsig|nickname|headImg|avatar|audio.*url/i.test(key)
    ? '[redacted]' : /birthday|prov|city|address|description|email/i.test(key) ? '[redacted]'
    : Array.isArray(value) ? value.slice(0, 2) : typeof value === 'string' && value.length > 250 ? `[string:${value.length}]` : value;
  const server = http.createServer(async (req, res) => {
    if (req.headers['x-probe-key'] !== localKey || req.headers.origin) return res.writeHead(403).end();
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      let result = { state };
      if (url.pathname === '/reload') {
        for (const file of Object.keys(require.cache)) if (file.includes(`${path.sep}electron${path.sep}bodian`)) delete require.cache[file];
        bridge = require('../../electron/bodianApiBridge.cjs').createBodianApiBridge({ store, safeStorage });
        result = { state, reloaded: true };
      }
      if (url.pathname === '/invoke') {
        const operation = url.searchParams.get('operation');
        if (!['login_status', 'user_playlists', 'user_albums', 'liked_songs', 'song_detail', 'audio', 'playlist_detail', 'playlist_tracks'].includes(operation)) throw new Error('Only read-only acceptance operations are allowed');
        const params = Object.fromEntries(url.searchParams); delete params.operation;
        result = await bridge.request(operation, params);
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result, redact));
    } catch (error) { res.writeHead(500).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  console.log(JSON.stringify({ ...(resume ? {} : { qrImage: imagePath }), port: server.address().port, localKey }));
  const poll = async () => {
    const result = await bridge.request('login_qr_check', { key });
    const next = result.ok ? result.data.state : result.error.message;
    if (state !== next) console.log(JSON.stringify({ state: next }));
    state = next;
    if (state === 'confirmed') return;
    setTimeout(poll, 2000);
  };
  if (!resume) void poll();
  setTimeout(() => { server.close(); app.quit(); }, 30 * 60 * 1000);
}).catch(error => { console.error(error.message); app.quit(); });
