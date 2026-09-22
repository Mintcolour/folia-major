const { app } = require('electron');
const path = require('node:path');
const Store = require('electron-store').default;

// test/manual/bodian-verified-desktop.cjs
// Launch the actual app with only the freshly verified encrypted acceptance session.

const profile = path.resolve('test-results/bodian-verified-account-profile');
app.setPath('userData', profile);
const accepted = new Store({ name: 'verified-account', cwd: profile });
const target = new Store({ projectName: 'Folia' });
for (const key of ['BODIAN_SESSION_V2', 'BODIAN_DEVICE_ID']) {
  const value = accepted.get(key);
  if (typeof value !== 'string') throw new Error('A verified acceptance session is required');
  target.set(key, value);
}
// Explicit launch option applies the user's playback-entry preference to this isolated profile once.
if (process.argv.includes('--playback-entry-lattice')) {
  let applied = false;
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-finish-load', () => {
      if (applied || !/^http:\/\/(localhost|127\.0\.0\.1):3000\//.test(contents.getURL())) return;
      applied = true;
      void contents.executeJavaScript("localStorage.setItem('playback_entry_view', 'lattice'); localStorage.setItem('playback_entry_view_chosen', 'true'); location.reload();")
        .catch(() => console.error('Could not apply the isolated playback-entry preference'));
    });
  });
}
require('../../electron/main.cjs');
