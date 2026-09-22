const { BodianError } = require('./http.cjs');
const { pagination } = require('./catalog.cjs');

// electron/bodian/library.cjs

function requireSession(sessions) {
  const session = sessions.get();
  if (!session) throw new BodianError('auth-required', 'Bodian sign-in is required');
  return session;
}

function createLibraryOperations({ client, sessions }) {
  const read = async (path, params) => (await client.call(`/api/${path}`, { params })).data;
  const paramsForUser = () => {
    const { uid } = requireSession(sessions);
    return { userId: uid, fromUid: uid };
  };
  return {
    async user_playlists(params) {
      const user = paramsForUser();
      const [owned, liked, collected] = await Promise.all([
        read('service/playlist/userCreate', user),
        read('service/playlist/fond', user),
        read('service/collect/4/list', { ...user, ...pagination(params, 1) }),
      ]);
      return { owned, liked, collected };
    },
    user_albums: params => read('service/collect/6/list', { ...paramsForUser(), ...pagination(params, 1) }),
    async liked_songs(params) {
      const liked = await read('service/playlist/fond', paramsForUser());
      if (!liked?.id) return { list: [], total: 0 };
      return read(`service/playlist/${liked.id}/musicList`, { source: 5, ...pagination(params, 1) });
    },
  };
}

module.exports = { requireSession, createLibraryOperations };
