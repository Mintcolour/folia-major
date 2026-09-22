const { app } = require('electron');
const path = require('node:path');

// test/manual/bodian-desktop.cjs
// Isolated profile for provider acceptance testing; keeps the user's normal Folia data intact.
app.setPath('userData', path.resolve('test-results/bodian-desktop-profile'));
require('../../electron/main.cjs');
