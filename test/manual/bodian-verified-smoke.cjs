const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs/promises');

// test/manual/bodian-verified-smoke.cjs
// Actual Electron + Omni checks; artifacts contain only aggregate results, never credential material.

async function main() {
  const desktop = await electron.launch({
    executablePath: path.resolve('node_modules/electron/dist/electron.exe'),
    args: [path.resolve('test/manual/bodian-verified-desktop.cjs')],
    env: { ...process.env, ELECTRON_DEV: 'true', ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
  });
  try {
    await desktop.firstWindow();
    let page;
    for (let attempt = 0; attempt < 60; attempt++) {
      page = desktop.windows().find(window => /^http:\/\/(localhost|127\.0\.0\.1):3000\//.test(window.url()));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!page) throw new Error('Main window did not open');
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    await page.waitForLoadState('domcontentloaded');
    if (process.argv.includes('--liked-playback')) {
      const checks = await page.evaluate(async () => {
        const { omni } = await import('/src/services/onlineMusic/omni.ts');
        const user = await omni.getLoginStatus('bodian');
        if (!user) throw new Error('Missing session');
        const ids = await omni.getProviderLikedSongIds('bodian', user.id);
        const results = [];
        for (const id of ids.slice(0, 3)) {
          const song = await omni.getSongDetail('bodian', id);
          const source = await omni.getAudioSource(song, 'high');
          const audio = new Audio();
          audio.crossOrigin = 'anonymous'; audio.muted = true; audio.src = source.url;
          let error = null;
          try {
            await Promise.race([audio.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))]);
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (e) { error = e.name; }
          results.push({ id, name: song.name, duration: Number.isFinite(audio.duration) ? audio.duration : null,
            currentTime: audio.currentTime, mediaError: audio.error?.code ?? null, error });
          audio.pause(); audio.removeAttribute('src'); audio.load();
        }
        return results;
      });
      console.log(JSON.stringify(checks));
      if (!checks.length || checks.some(check => check.currentTime <= 0 || check.mediaError || check.error)) {
        throw new Error('Liked-song decoding regression failed');
      }
      return;
    }
    const result = await page.evaluate(async () => {
      const { omni } = await import('/src/services/onlineMusic/omni.ts');
      const { useOnlineProviderAccountStore } = await import('/src/stores/useOnlineProviderAccountStore.ts');
      useOnlineProviderAccountStore.getState().setActiveProviderId('bodian');
      const user = await omni.getLoginStatus('bodian');
      if (!user) throw new Error('No restored Bodian account');
      const library = await omni.getProviderUserPlaylists('bodian', user.id, { offset: 0, limit: 50 });
      const search = await omni.searchProviderSongs('bodian', '晴天', { offset: 0, limit: 2 });
      const song = await omni.getSongDetail('bodian', '228908');
      if (!song) throw new Error('Song detail is missing');
      const source = await omni.getAudioSource(song, 'high');
      if (!source) throw new Error('Full audio source is missing');
      const audio = new Audio(source.url);
      audio.muted = true;
      let playback;
      try {
        await Promise.race([audio.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('Playback timeout')), 15000))]);
        await new Promise(resolve => setTimeout(resolve, 2000));
        playback = { duration: audio.duration, advanced: audio.currentTime > 0, error: audio.error?.code ?? null };
      } finally { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      return { userId: user.id, libraryCount: library.items.length, searchCount: search.items.length, playback };
    });
    const identityMatched = result.userId === process.env.BODIAN_EXPECTED_ACCOUNT_ID;
    delete result.userId;
    const summary = { identityMatched, ...result, pageErrorCount: errors.length };
    console.log(JSON.stringify(summary));
    await fs.mkdir('test-results/bodian-verified-account-profile', { recursive: true });
    await fs.writeFile('test-results/bodian-verified-account-profile/smoke-summary.json', JSON.stringify(summary, null, 2));
    await page.screenshot({ path: path.resolve('test-results/bodian-verified-account-profile/desktop.png') });
    if (!identityMatched || !result.playback.advanced || result.playback.duration < 200 || errors.length) {
      throw new Error('Verified desktop smoke failed');
    }
  } finally { await desktop.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
