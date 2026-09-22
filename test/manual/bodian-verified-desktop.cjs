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
require('../../electron/main.cjs');
