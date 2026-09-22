const { createBodianClient, BodianError } = require('./bodian/http.cjs');
const { createSessionRepository } = require('./bodian/session.cjs');
const { createAuthOperations } = require('./bodian/auth.cjs');
const { createCatalogOperations } = require('./bodian/catalog.cjs');
const { createPlaybackOperation } = require('./bodian/playback.cjs');
const { createLibraryOperations } = require('./bodian/library.cjs');

// electron/bodianApiBridge.cjs

function createBodianApiBridge({ store, safeStorage, request, requestFactory, now = Date.now, warn = console.warn }) {
  const sessions = createSessionRepository({ store, safeStorage, warn });
  // Identity mismatch during acceptance: discard unverified sessions without decrypting or sending them.
  sessions.clear();
  const client = createBodianClient({ deviceId: sessions.deviceId, getSession: () => sessions.get(), request, requestFactory, now });
  const operations = {
    ...createAuthOperations({ client, sessions, now }),
    ...createCatalogOperations(client),
    ...createLibraryOperations({ client, sessions }),
    audio: createPlaybackOperation({ client, deviceId: sessions.deviceId, getSession: () => sessions.get(), now }),
  };
  return {
    async request(operation, params = {}) {
      try {
        if (operation === 'login_status') return { ok: true, data: null };
        if (['login_qr_key', 'login_qr_create', 'login_qr_check', 'user_playlists', 'user_albums', 'liked_songs'].includes(operation)) {
          throw new BodianError('unavailable', 'Bodian account access is disabled pending QR identity verification');
        }
        if (!Object.hasOwn(operations, operation)) throw new BodianError('unsupported', 'Unsupported Bodian operation');
        if (!params || typeof params !== 'object' || Array.isArray(params)
          || Object.keys(params).length > 20 || Object.values(params).some(value => value !== undefined && !['string', 'number', 'boolean'].includes(typeof value))) {
          throw new BodianError('invalid-response', 'Invalid Bodian request parameters');
        }
        return { ok: true, data: await operations[operation](params) };
      } catch (error) {
        return { ok: false, error: { code: error instanceof BodianError ? error.code : 'invalid-response',
          message: error instanceof BodianError ? error.message : 'Bodian operation failed' } };
      }
    },
  };
}

module.exports = { createBodianApiBridge };
