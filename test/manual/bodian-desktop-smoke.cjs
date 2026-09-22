const { _electron: electron } = require('playwright-core');
const path = require('node:path');

// test/manual/bodian-desktop-smoke.cjs

async function main() {
  const desktop = await electron.launch({
    executablePath: path.resolve('node_modules/electron/dist/electron.exe'),
    args: [path.resolve('test/manual/bodian-desktop.cjs')],
    env: { ...process.env, ELECTRON_DEV: 'true', ELECTRON_RUN_AS_NODE: undefined },
    timeout: 60000,
  });
  await desktop.firstWindow();
  let page;
  for (let attempt = 0; attempt < 30; attempt++) {
    page = desktop.windows().find(window => /^http:\/\/(?:localhost|127\.0\.0\.1):3000\//.test(window.url()));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!page) throw new Error('Folia main window did not open');
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('pageerror', error.message); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000);
  console.log(JSON.stringify({ title: await page.title(), url: page.url(), errors }));
  console.log((await page.locator('body').innerText()).slice(0, 4500));
  const result = await page.evaluate(async () => {
    const response = await window.electron.bodianRequest('search', { query: '晴天', limit: 2, offset: 0 });
    return response.ok ? { ok: true, count: response.data.resultList?.length } : response;
  });
  console.log('desktop-ipc-search', JSON.stringify(result));
  const playback = await page.evaluate(async () => {
    const response = await window.electron.bodianRequest('audio', { id: 228908, quality: 'high' });
    return response.ok ? { ok: true, quality: response.data.quality, preview: response.data.preview } : response;
  });
  console.log('desktop-ipc-rights', JSON.stringify(playback));
  const lyric = await page.evaluate(async () => {
    const response = await window.electron.bodianRequest('lyrics', { id: 228908 });
    return response.ok ? { ok: true, length: response.data.content.length } : response;
  });
  console.log('desktop-ipc-lyrics', JSON.stringify(lyric));
  await page.screenshot({ path: path.resolve('test-results/bodian-desktop.png') });
  console.log('screenshot: test-results/bodian-desktop.png');
  await desktop.close();
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
