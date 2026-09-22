const { app, safeStorage, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const readline = require('node:readline');
const { createSessionRepository } = require('../../electron/bodian/session.cjs');
const { createBodianClient } = require('../../electron/bodian/http.cjs');
const { createAuthOperations } = require('../../electron/bodian/auth.cjs');
const { createLibraryOperations } = require('../../electron/bodian/library.cjs');
const { createPlaybackOperation } = require('../../electron/bodian/playback.cjs');
const { testPlaylistRoundtrip, testLikeRoundtrip } = require('./bodian-test-playlist-roundtrip.cjs');
const { createMutationOperations } = require('../../electron/bodian/mutations.cjs');

// test/manual/bodian-account-acceptance.cjs
// Fresh, identity-checked acceptance session in a dedicated encrypted Electron profile.
// Commands use stdin; no local HTTP control port or credential output is exposed.

const expectedId = process.env.BODIAN_EXPECTED_ACCOUNT_ID;
const profile = path.resolve('test-results/bodian-verified-account-profile');
const imagePath = path.join(profile, 'login.png');
app.setPath('userData', profile);
const emit = value => console.log(JSON.stringify(value));
let timer;

app.whenReady().then(async () => {
  if (!/^[1-9]\d{0,19}$/.test(expectedId || '')) throw new Error('Expected account ID is required');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is required for acceptance');
  const Store = require('electron-store').default;
  const store = new Store({ name: 'verified-account', cwd: profile });
  let repository = createSessionRepository({ store, safeStorage });
  const sessions = {
    get revision() { return repository.revision; },
    get: () => repository.get(),
    clear: () => repository.clear(),
    set(value) {
      if (value.uid !== expectedId) throw new Error('Identity mismatch');
      repository.set(value);
    },
  };
  const client = createBodianClient({ deviceId: repository.deviceId, getSession: () => sessions.get(),
    ...(process.argv.includes('--electron-net') ? { requestFactory: (options, onResponse) => {
      const request = net.request(options); request.on('response', onResponse); return request;
    } } : {}),
  });
  const auth = createAuthOperations({ client, sessions });
  const library = createLibraryOperations({ client, sessions });
  const mutations = createMutationOperations({ client, sessions });
  const audio = createPlaybackOperation({ client, deviceId: repository.deviceId, getSession: () => sessions.get() });
  timer = setTimeout(() => app.quit(), 30 * 60 * 1000);

  if (process.argv.includes('--resume')) {
    if (sessions.get()?.uid !== expectedId) throw new Error('No matching isolated session');
    emit({ state: 'encrypted-session-loaded', liveAuthenticationVerified: false });
  } else {
    sessions.clear();
    const { key } = await auth.login_qr_key();
    const { imageUrl } = await auth.login_qr_create({ key });
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(imagePath, Buffer.from(imageUrl.split(',')[1], 'base64'));
    emit({ state: 'qr-ready', imagePath });
    try {
      let previous;
      while (true) {
        const result = await auth.login_qr_check({ key });
        if (result.state !== previous) emit(result);
        previous = result.state;
        if (result.state === 'confirmed') break;
        if (result.state === 'expired' || result.state === 'error') throw new Error('QR expired');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } finally { await fs.unlink(imagePath).catch(() => {}); }
  }

  // Only summarize read operations; raw responses, credentials and signed audio URLs stay in this process.
  const run = async input => {
    const { operation, id, quality = 'high' } = JSON.parse(input);
    if (operation === 'stop') { app.quit(); return; }
    if (operation === 'logout') { await auth.logout(); emit({ state: 'logged-out' }); return; }
    if (sessions.get()?.uid !== expectedId) throw new Error('No matching session');
    if (operation === 'restore') {
      repository = createSessionRepository({ store, safeStorage });
      emit({ operation, identityMatched: repository.get()?.uid === expectedId, liveAuthenticationVerified: false });
    } else if (operation === 'status') {
      const user = await auth.login_status();
      emit({ operation, identityMatched: user?.id === expectedId });
    } else if (operation === 'library') {
      const data = await library.user_playlists({ limit: 100, offset: 0 });
      const summary = value => ({ fields: Object.keys(value || {}), count: Array.isArray(value) ? value.length : value?.playLists?.length });
      emit({ operation, owned: summary(data.owned), collected: summary(data.collected), hasLikedPlaylist: !!data.liked?.id });
    } else if (operation === 'albums') {
      const data = await library.user_albums({ limit: 100, offset: 0 });
      emit({ operation, fields: Object.keys(data || {}), count: data?.albumList?.length });
    } else if (operation === 'likes') {
      const data = await library.liked_songs({ limit: 100, offset: 0 });
      emit({ operation, count: data?.list?.length, total: data?.total, testSongLiked: data?.list?.some(song => String(song.id) === String(id)) });
    } else if (operation === 'test-playlist') {
      const expectedName = process.env.BODIAN_TEST_PLAYLIST_NAME;
      if (!expectedName) throw new Error('Expected test playlist name is required');
      const data = await library.user_playlists({ limit: 100, offset: 0 });
      const matches = (data.owned?.playLists || []).filter(item => item.name?.replace(/\s/g, '') === expectedName.replace(/\s/g, ''));
      if (matches.length !== 1) throw new Error('Test playlist must be uniquely identified');
      const playlist = matches[0];
      emit({ operation: 'test-playlist-match', id: playlist.id, name: playlist.name, sourceType: playlist.sourceType,
        source: playlist.source, fields: Object.keys(playlist) });
      const tracks = (await client.call(`/api/service/playlist/${playlist.id}/musicList`, {
        params: { source: playlist.sourceType ?? 5, pn: 1, rn: 100 },
      })).data;
      emit({ operation, matched: true, id: playlist.id, source: playlist.sourceType,
        count: tracks?.list?.length, total: tracks?.total, songIds: tracks?.list?.map(song => song.id) });
    } else if (operation === 'like-check') {
      emit({ operation, ...await testLikeRoundtrip({ library, mutations, songId: id }) });
    } else if (operation === 'write-check') {
      const result = await testPlaylistRoundtrip({ client, library, mutations,
        expectedName: process.env.BODIAN_TEST_PLAYLIST_NAME, songId: id });
      emit({ operation, ...result });
    } else if (operation === 'app-session-check') {
      const appStore = new Store({ name: 'config', cwd: profile });
      const sealed = appStore.get('BODIAN_SESSION_V2');
      let appSession = null;
      if (typeof sealed === 'string') appSession = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
      emit({ operation, present: !!appSession, identityMatched: appSession?.uid === expectedId,
        sameCredentialAsAcceptance: appSession?.token === sessions.get()?.token });
    } else if (operation === 'liked-playback') {
      const liked = await library.liked_songs({ limit: 100, offset: 0 });
      for (const song of (liked.list || []).slice(0, 3)) {
        const freeSign = song.freeSign || song.fsig || '';
        const right = (await client.call('/api/play/music/v2/checkRight', {
          params: { musicId: String(song.id), freeSign }, body: { musicId: Number(song.id), freeSign }, signed: true,
        })).data;
        let outcome;
        try { const result = await audio({ id: song.id, quality: 'high', freeSign });
          outcome = { ok: true, preview: !!result.preview, quality: result.quality }; }
        catch (error) { outcome = { ok: false, code: error.code }; }
        emit({ operation, name: song.name || song.songName, id: song.id, hasFreeSign: !!freeSign,
          rightStatus: right?.status, rightFields: Object.keys(right || {}), offline: song.offline, online: song.online,
          cannotOnlinePlay: song.payInfo?.cannotOnlinePlay, ...outcome });
        for (const quality of ['high', 'lossless']) {
          try {
            const result = await audio({ id: song.id, quality, freeSign });
            const response = await fetch(result.url, { headers: { Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(15000) });
            emit({ operation: 'audio-reachability', id: song.id, quality, status: response.status,
              host: new URL(result.url).hostname, type: response.headers.get('content-type'), bytes: response.headers.get('content-length'),
              cors: response.headers.get('access-control-allow-origin') });
            await response.body?.cancel();
            if (quality === 'high' && process.argv.includes('--audio-metadata')) {
              const media = await fetch(result.url, { signal: AbortSignal.timeout(30000) });
              const buffer = Buffer.from(await media.arrayBuffer());
              const { parseBuffer } = await import('music-metadata');
              const metadata = await parseBuffer(buffer, undefined, { duration: true, skipCovers: true });
              emit({ operation: 'liked-audio-metadata', id: song.id, duration: metadata.format.duration,
                codec: metadata.format.codec, bytes: buffer.length });
            }
          } catch (error) { emit({ operation: 'audio-reachability', id: song.id, quality, code: error.code || error.name }); }
        }
      }
    } else if (operation === 'audio') {
      const data = await audio({ id, quality });
      emit({ operation, quality: data.quality, preview: !!data.preview, hasUrl: !!data.url });
      if (process.argv.includes('--audio-metadata') && !data.preview) {
        const response = await fetch(data.url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('Audio download failed');
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) throw new Error('Audio exceeded acceptance limit');
          chunks.push(Buffer.from(chunk));
        }
        const { parseBuffer } = await import('music-metadata');
        const metadata = await parseBuffer(Buffer.concat(chunks), undefined, { duration: true, skipCovers: true });
        emit({ operation: 'audio-metadata', bytes: size, duration: metadata.format.duration,
          codec: metadata.format.codec, bitrate: metadata.format.bitrate });
      }
    } else throw new Error('Unsupported acceptance operation');
  };
  if (process.argv.includes('--check')) {
    const selected = process.argv.find(value => value.startsWith('--operation='))?.split('=')[1];
    for (const operation of selected ? [selected] : ['restore', 'library', 'albums', 'likes', 'audio']) {
      try { await run(JSON.stringify({ operation, id: '228908' })); }
      catch (error) { emit({ operation, state: 'operation-failed', code: error.code || 'invalid-operation' }); }
    }
    app.quit();
    return;
  }
  const input = readline.createInterface({ input: process.stdin });
  let pending = Promise.resolve();
  input.on('line', line => {
    pending = pending.then(() => run(line)).catch(error => emit({ state: 'operation-failed', code: error.code || 'invalid-operation' }));
  });
  input.on('close', () => app.quit());
  emit({ state: 'ready', operations: ['library', 'albums', 'likes', 'audio', 'restore', 'status', 'logout', 'stop'] });
}).catch(() => { emit({ state: 'failed' }); app.quit(); });

app.on('will-quit', () => clearTimeout(timer));
