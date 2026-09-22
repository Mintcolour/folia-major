import type { OnlineMusicProvider, ProviderAudioSource, QrLoginState } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { parseBodianLyrics } from '../../utils/lyrics/bodianLyrics';
import { getBodianTransportAvailability, requestBodian } from './bodianTransport';
import { bodianPage, normalizeBodianCollection, normalizeBodianSong, normalizeBodianUser } from './bodianNormalize';
import { bodianCatalog } from './bodianCatalog';
import { bodianLibrary, clearBodianLibraryCache } from './bodianLibrary';
import { bodianMutations } from './bodianMutations';

// src/services/onlineMusic/bodianProvider.ts

export const bodianProvider: OnlineMusicProvider = {
    id: 'bodian', displayName: '波点音乐', shortName: '波点',
    getAvailability: getBodianTransportAvailability,
    capabilities: {
        search: true, playback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        playlists: true, albums: true, artists: true, recommendations: true,
        userLibrary: true, userAlbums: true, likes: true, mutations: true,
    },
    normalizeSong: normalizeBodianSong, normalizeUser: normalizeBodianUser, normalizeCollection: normalizeBodianCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return bodianPage([], 0, offset, limit);
            const data = await requestBodian<any>('search', { query, limit, offset });
            if (!Array.isArray(data.resultList)) throw new OnlineProviderError('invalid-response', 'Bodian search list is missing', 'bodian');
            return bodianPage(data.resultList.map(normalizeBodianSong), data.total, offset, limit);
        },
    },
    playback: {
        async getSongDetail(id) { return normalizeBodianSong(await requestBodian('song_detail', { id })); },
        async getAudioSource(song, quality) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'bodian') {
                throw new OnlineProviderError('unsupported', 'Song does not belong to Bodian', 'bodian');
            }
            const audio = await requestBodian<ProviderAudioSource & { preview?: { startTime: number; endTime: number } }>('audio', {
                id: source.mediaId, quality, freeSign: typeof source.providerData?.freeSign === 'string' ? source.providerData.freeSign : '',
            });
            // Full-track caches and timing must never ingest a 30-second preview as the complete song.
            if (audio.preview) throw new OnlineProviderError('preview-only', 'Bodian only offers a preview; sign in with an eligible account', 'bodian');
            return audio;
        },
        getAvailability(song) {
            return song.sourceRef?.kind === 'online' && song.sourceRef.providerData?.unavailable
                ? { state: 'unavailable' } : { state: 'unknown' };
        },
    },
    lyrics: {
        async getLyrics(song) {
            const data = await requestBodian<{ content: string }>('lyrics', { id: song.id });
            return parseBodianLyrics(data.content);
        },
    },
    auth: {
        getLoginStatus: () => requestBodian('login_status'),
        async logout() { clearBodianLibraryCache(); await requestBodian('logout'); },
        async getQrKey() { return (await requestBodian<{ key: string }>('login_qr_key')).key; },
        async createQr(key) { return (await requestBodian<{ imageUrl: string }>('login_qr_create', { key })).imageUrl; },
        checkQr: key => requestBodian<QrLoginState>('login_qr_check', { key }),
        async cancelQr(key) { await requestBodian('login_qr_cancel', { key }); },
        getQrTtlMs: () => 5 * 60 * 1000,
    },
    catalog: bodianCatalog,
    library: bodianLibrary,
    mutations: bodianMutations,
    recommendations: {
        async getRecommendedCollections(limit) {
            const data = await requestBodian<any>('recommendations');
            return (data.lists || []).flatMap((group: any) => group.playLists || []).slice(0, limit).map(normalizeBodianCollection);
        },
        async getPersonalFm() {
            const data = await requestBodian<any>('personal_fm');
            return (data.musicList || []).map(normalizeBodianSong);
        },
    },
};
