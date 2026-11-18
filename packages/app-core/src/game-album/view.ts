import { albumCopy } from './copy';
import type { AlbumCard, AlbumResponse, AlbumTopicId } from './types';

/** Màn sổ ở mỗi nền tảng (cặp trong `route-map.json`). */
export const ALBUM_PATH = { miniapp: '/game/album', web: '/vuon-xanh/so-tay' } as const;
/** "Chơi hôm nay" ở Vườn Xanh: nơi mở thẻ mới. */
export const ALBUM_PLAY_PATH = { miniapp: '/game', web: '/vuon-xanh' } as const;

/** Số câu tối đa của một ván ôn (máy chủ giữ cùng số). */
const REVIEW_ITEMS = 5;
/** Ô "?" lẻ tối đa trước ô gộp "+N": lưới không kéo dài cả trăm ô trống. */
const LOCKED_TILES = 3;

/** Dòng lối vào ở Vườn Xanh. null khi sổ chưa tải hay chưa có thẻ nào (chưa có nội dung đã kiểm nguồn). */
export function albumEntry(r: AlbumResponse | undefined): { text: string; pct: number } | null {
  if (!r || r.total <= 0) return null;
  return { text: albumCopy('entry', { n: r.seen, m: r.total }), pct: Math.min(100, Math.round((r.seen / r.total) * 100)) };
}

export type AlbumFilter = 'all' | AlbumTopicId;

/** Chip chủ đề: "Tất cả" rồi các chủ đề máy chủ trả (đã bỏ chủ đề trống), số là thẻ đã mở. */
export const albumChips = (r: AlbumResponse): Array<{ id: AlbumFilter; label: string; count: number }> => [
  { id: 'all', label: albumCopy('topic.all'), count: r.seen },
  ...r.topics.map((t) => ({ id: t.id, label: albumCopy(`topic.${t.id}`), count: t.seen })),
];

export type AlbumTile = { key: string; card: AlbumCard; fresh: boolean } | { key: string; card: null; text: string; label: string };

/**
 * Ô của lưới theo chủ đề đang chọn: thẻ đã mở (máy chủ đã sắp theo chủ đề rồi ngày gặp gần nhất), rồi ô mờ "?" cho thẻ chưa mở; quá
 * `LOCKED_TILES` + 1 ô thì ô cuối gộp số còn lại ("+N"). `fresh`: thẻ gặp hôm nay, lật khi hiện.
 */
export function albumTiles(r: AlbumResponse, filter: AlbumFilter): AlbumTile[] {
  const topic = r.topics.find((t) => t.id === filter);
  const scope = filter === 'all' ? r : topic;
  const tiles: AlbumTile[] = r.cards.filter((c) => filter === 'all' || c.topic === filter).map((card) => ({ key: card.id, card, fresh: card.lastSeenDay === r.dayKey }));
  const locked = scope ? Math.max(0, scope.total - scope.seen) : 0;
  const singles = locked > LOCKED_TILES + 1 ? LOCKED_TILES : locked;
  for (let i = 0; i < singles; i++) tiles.push({ key: `?${i}`, card: null, text: '?', label: albumCopy('locked', { n: 1 }) });
  if (locked > singles) tiles.push({ key: '+', card: null, text: `+${locked - singles}`, label: albumCopy('locked', { n: locked - singles }) });
  return tiles;
}

/**
 * Hành động chính của màn sổ (đúng một): "Ôn n thẻ" khi có thẻ tới hạn và còn lượt ôn hôm nay. Chưa có thẻ tới hạn thì dòng mời chơi thêm (dẫn về
 * "Chơi hôm nay"); hết lượt ôn thì chỉ một dòng chữ. Sổ trống (chưa gặp thẻ nào) là trạng thái rỗng riêng, mời chơi một ván.
 */
export function albumAction(r: AlbumResponse): { kind: 'empty' | 'review' | 'play' | 'note'; text: string } {
  if (r.cards.length === 0 && r.seen === 0) return { kind: 'empty', text: albumCopy('empty') };
  if (r.review.due <= 0) return { kind: 'play', text: albumCopy('review.none') };
  if (r.review.leftToday <= 0) return { kind: 'note', text: albumCopy('review.limit') };
  return { kind: 'review', text: albumCopy('review', { n: Math.min(r.review.due, REVIEW_ITEMS) }) };
}

/** Số thẻ lần đầu gặp ở ván vừa nộp; 0 khi sổ chưa tải, ván là của khách chưa đăng nhập hay ván gần nhất của sổ là ván khác. */
export const albumNewCards = (r: AlbumResponse | undefined, roundId: string | null | undefined) =>
  r?.lastRound && roundId && r.lastRound.roundId === roundId ? r.lastRound.newCards : 0;

/** Huy hiệu thuộc bài đã đạt (chỉ ghi nhận, không thưởng). */
export const albumBadges = (r: AlbumResponse) => r.badges.filter((b) => b.earned).map((b) => albumCopy(`badge.${b.id}`));

/** Mức thuộc của thẻ, cũng là nhãn đọc của các chấm. */
export const albumLevel = (c: AlbumCard) => albumCopy('level', { n: c.level });
