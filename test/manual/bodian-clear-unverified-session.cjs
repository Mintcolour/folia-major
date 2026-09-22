const { app } = require('electron');
const path = require('node:path');
const { SESSION_KEY } = require('../../electron/bodian/session.cjs');

// test/manual/bodian-clear-unverified-session.cjs
// Local containment only: never decrypt the rejected session or contact any service.
app.setPath('userData', path.resolve('test-results/bodian-desktop-profile'));
app.whenReady().then(() => {
  const Store = require('electron-store').default;
  const store = new Store({ projectName: 'Folia' });
  store.delete(SESSION_KEY);
  console.log(JSON.stringify({ unverifiedSessionRemoved: !store.has(SESSION_KEY) }));
  app.quit();
}).catch(() => { console.error('Local session cleanup failed'); app.exit(1); });
