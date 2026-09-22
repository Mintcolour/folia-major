import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/bodianProvider.test.ts

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/bodianTransport', () => ({
    requestBodian: request, getBodianTransportAvailability: () => ({ configured: true }),
}));
import { bodianProvider } from '@/services/onlineMusic/bodianProvider';
import { bodianPage, normalizeBodianCollection, normalizeBodianSong } from '@/services/onlineMusic/bodianNormalize';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';

const track = { id: 228908, songName: '测试歌曲 (Live)', name: '测试歌曲', albumId: 1293, album: '测试专辑',
    albumPic: 'https://img4.kuwo.cn/cover.jpg', artist: '测试歌手', artistId: 336,
    artists: [{ id: 336, name: '测试歌手' }], duration: 269 };

beforeEach(() => request.mockReset());

describe('Bodian provider', () => {
    it('normalizes stable identity, duration and navigable catalog references idempotently', () => {
        const song = normalizeBodianSong(track);
        expect(song).toMatchObject({ id: '228908', durationMs: 269000, name: '测试歌曲 (Live)',
            album: { catalogRef: { providerId: 'bodian', kind: 'album', id: '1293' } } });
        expect(normalizeBodianSong(song)).toEqual(song);
        expect(getPlaybackSongKey(song)).toBe('online:bodian:228908');
        expect(() => normalizeBodianSong({})).toThrow('no id');
    });

    it('preserves private/liked playlist source and counts on cache hydration', () => {
        const collection = normalizeBodianCollection({ id: 123, name: '测试歌单', musicCount: 121, sourceType: 5, isPrivate: 1 });
        expect(collection).toMatchObject({ providerId: 'bodian', trackCount: 121, providerData: { source: 5, isPrivate: 1 } });
        expect(normalizeBodianCollection(collection)).toEqual(collection);
    });

    it('ignores bogus paging flags and terminates empty pages even if total is stale', async () => {
        request.mockResolvedValue({ list: [track], total: 121, hasNextPage: false, nextPage: 0 });
        const page = await bodianProvider.catalog!.getPlaylistTracks!('123', 1, 0, normalizeBodianCollection({ id: 123, name: '喜欢', sourceType: 5 }));
        expect(request).toHaveBeenCalledWith('playlist_tracks', expect.objectContaining({ source: 5 }));
        expect(page).toMatchObject({ hasMore: true, nextOffset: 1 });
        expect(bodianPage([], 121, 50, 50)).toMatchObject({ hasMore: false, nextOffset: 50 });
    });

    it('preserves search pagination and rejects malformed results', async () => {
        request.mockResolvedValueOnce({ resultList: [track], total: 51 });
        const result = await bodianProvider.search!.searchSongs('测试', 50, 50);
        expect(result).toMatchObject({ nextOffset: 51, hasMore: false });
        request.mockResolvedValueOnce({});
        await expect(bodianProvider.search!.searchSongs('测试', 50, 0)).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('never stores a preview as full-track audio or routes another provider through Bodian', async () => {
        request.mockResolvedValue({ url: 'https://audio.example.test/preview.mp3', preview: { startTime: 0, endTime: 29 } });
        await expect(bodianProvider.playback!.getAudioSource(normalizeBodianSong(track), 'high')).rejects.toMatchObject({ code: 'preview-only' });
        await expect(bodianProvider.playback!.getAudioSource({ ...normalizeBodianSong(track), sourceRef: { kind: 'online', providerId: 'qq', mediaId: '228908' } }, 'high'))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(request).toHaveBeenCalledTimes(1);
    });
});
