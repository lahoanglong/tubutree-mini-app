import type { AlbumBadgeId, MiniGameId, MiniProductCard } from '@tubutree/shared-types';

/**
 * Hợp đồng HTTP của Sổ tay Xanh (`GET /game/album`), bản sao của `apps/api/src/modules/game/album/album.types.ts`. Thẻ chưa gặp không có trong
 * `cards`: máy chủ chỉ trả số lượng theo chủ đề. Ván ôn dùng thẳng kiểu ván game mini (`MiniStartResponse`, `MiniSubmitResponse`).
 */
export const ALBUM_TOPIC_IDS = ['waste', 'quiz', 'ingredients', 'origin', 'kitchen'] as const;
export type AlbumTopicId = (typeof ALBUM_TOPIC_IDS)[number];

export interface AlbumTopicSummary {
  id: AlbumTopicId;
  total: number;
  seen: number;
  mastered: number;
}

export interface AlbumCard {
  id: string;
  topic: AlbumTopicId;
  game: Exclude<MiniGameId, 'basket'>;
  /** 1 đã gặp, 2 đã đúng, 3 đúng ở hai ngày khác nhau (thuộc). */
  level: 1 | 2 | 3;
  seen: number;
  correct: number;
  lastSeenDay: string;
  title: string;
  answer: string | null;
  explanation: string;
  sourceUrl: string;
  product: MiniProductCard | null;
  retired: boolean;
}

export interface AlbumBadge {
  id: AlbumBadgeId;
  earned: boolean;
  earnedAt: string | null;
}

export interface AlbumResponse {
  dayKey: string;
  total: number;
  seen: number;
  mastered: number;
  topics: AlbumTopicSummary[];
  cards: AlbumCard[];
  review: { due: number; leftToday: number };
  lastRound: { roundId: string; newCards: number } | null;
  badges: AlbumBadge[];
}
