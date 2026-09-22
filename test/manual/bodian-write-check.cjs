const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createBodianClient, requestJson } = require('../../electron/bodian/http.cjs');
const { createSessionRepository } = require('../../electron/bodian/session.cjs');

// test/manual/bodian-write-check.cjs
// The user's accepted test-playlist workflow; only the isolated fresh-QR profile is read.
app.setPath('userData', path.resolve('test-results/bodian-desktop-profile'));
app.whenReady().then(async () => {
  const Store = require('electron-store').default;
  const repository = createSessionRepository({ store: new Store({ projectName: 'Folia' }), safeStorage });
  if (!repository.get()) throw new Error('A new QR session is required');
  const client = createBodianClient({ deviceId: repository.deviceId, getSession: () => repository.get(),
    request: async (...args) => {
      const result = await requestJson(...args);
      if (result.code !== 200) console.log(JSON.stringify({ code: result.code, message: result.msg }));
      return result;
    },
  });
  const marker = 'Folia 接口验证 20260920';
  const receipt = path.resolve('test-results/bodian-test-playlist.json');
  const action = process.argv[2] || 'read';
  if (action === 'diagnose') {
    const session = repository.get();
    const profile = (await client.call(`/api/ucenter/users/pub/${session.uid}`)).data?.userInfo;
    console.log(JSON.stringify({ nickname: profile?.nickname, profileMatchesScreenshot: profile?.nickname === '薄荷薄荷',
      cachedProfileMatches: session.user?.nickname === profile?.nickname }));
    for (const [label, params, anonymous] of [
      ['current', { userId: session.uid }, false],
      ['paged', { userId: session.uid, fromUid: session.uid, pn: 1, rn: 50 }, false],
      ['self', { pn: 1, rn: 50 }, false],
      ['anonymousControl', { userId: session.uid, pn: 1, rn: 50 }, true],
    ]) {
      try {
        const result = await client.call('/api/service/playlist/userCreate', { params, anonymous });
        console.log(JSON.stringify({ label, keys: Object.keys(result.data || {}),
          playlists: result.data?.playLists?.map(item => ({ id: item.id, name: item.name, sourceType: item.sourceType })) }));
      } catch (error) { console.log(JSON.stringify({ label, error: error.code, upstreamCode: error.upstreamCode })); }
    }
    app.quit();
    return;
  }
  const owned = (await client.call('/api/service/playlist/userCreate', { params: { userId: repository.get().uid } })).data.playLists;
  let playlist = owned.find(item => item.name === marker);
  if (action === 'create' && !playlist) {
    const result = await client.call('/api/service/playlist', {
      method: 'POST', signed: true, params: { name: marker, isPrivate: 1 }, body: { name: marker, isPrivate: 1 },
    });
    console.log(JSON.stringify({ created: true, result: result.data }));
    await fs.writeFile(receipt, JSON.stringify({ marker, result: result.data }));
  } else console.log(JSON.stringify({ authenticated: true, testPlaylist: playlist || null,
    totalOwned: owned.length }, (key, value) => /creator|uid|token|nickname/i.test(key) ? undefined : value));
  app.quit();
}).catch(error => { console.error(error.code || error.name, error.message); app.quit(); });
