const { createBodianClient } = require('../../electron/bodian/http.cjs');
const crypto = require('node:crypto');

// test/manual/bodian-probe.cjs
// Read-only protocol diagnostics. No credentials, signed URLs or lyric text are printed.

async function main() {
  const deviceId = crypto.randomBytes(16).toString('hex');
  const client = createBodianClient({ deviceId });
  const operation = process.argv[2] || 'search';
  const paths = {
    search: ['/api/search/music/list', { params: { keyword: '晴天', pn: 0, rn: 2, correct: 1 } }],
    qr: ['/api/ucenter/login/qrCode', {}],
    qrStatus: ['/api/ucenter/login/qrCodeStatus', { params: { qrCode: process.argv[3] } }],
    detail: ['/api/service/music/info', { params: { musicId: 228908 } }],
    home: ['/api/service/home/index', {}],
    artist: ['/api/service/artist/336', {}],
    album: ['/api/service/album/1294', {}],
    albumTracks: ['/api/service/album/music/1294', { params: { pn: 0, rn: 2 } }],
    artistTracks: ['/api/service/artist/music/336', { params: { pn: 0, rn: 2 } }],
    artistAlbums: ['/api/service/artist/album/336', { params: { pn: 0, rn: 2 } }],
    playlists: ['/api/service/playlist/userCreate', { params: { pn: 1, rn: 2 } }],
    collects: ['/api/service/collect/2', { params: { pn: 1, rn: 2 } }],
    fond: ['/api/service/playlist/fond', { params: { pn: 1, rn: 2 } }],
    homeModule: ['/api/service/home/module', { params: { id: 2 } }],
    finds: ['/api/service/finds/playlist', { params: { pn: 1, rn: 2 } }],
    recommend: ['/api/service/music/recommendList', { params: { pn: 1, rn: 2 } }],
    checkRight: ['/api/play/music/v2/checkRight', { params: { musicId: '228908', freeSign: '' }, body: { musicId: 228908, freeSign: '' }, signed: true }],
    audio: ['/api/play/music/v2/audioUrl', { params: { devId: deviceId, musicId: '228908', format: 'mp3', br: '128kmp3', freeSign: '' }, body: { devId: deviceId, musicId: 228908, format: 'mp3', br: '128kmp3', freeSign: '' }, signed: true }],
    playlistDetail: ['/api/service/playlist/info/3677488020', { params: { source: 4 } }],
    playlistTracks: ['/api/service/playlist/3677488020/musicList', { params: { source: 4, pn: 1, rn: 2 } }],
    lyric: ['/mobi.s', { lyric: true, params: { f: 'bodian', q: Buffer.from('type=lyric&req=2&lrcx=1&rid=228908&songname=&artist=&corp=kuwo&fromchannel=bodian').toString('base64') } }],
    config: ['/api/service/pc/conf/all', {}],
  };
  if (!paths[operation]) throw new Error('Unknown read-only probe operation');
  const result = await client.call(...paths[operation]);
  const redact = (key, value) => /token|freeSign|fsig|audio.*url|credential/i.test(key) ? '[redacted]'
    : Array.isArray(value) ? value.slice(0, 1)
    : typeof value === 'string' && value.length > 400 ? `[string:${value.length}]` : value;
  console.log(JSON.stringify(result, redact, 2));
}

main().catch(error => { console.error(error.code || error.name, error.message); process.exitCode = 1; });
