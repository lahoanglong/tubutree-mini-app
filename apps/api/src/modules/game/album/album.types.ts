import type { AlbumBadgeId, MiniChoiceItem, MiniProductCard, MiniReview, MiniStartResponse, MiniSubmitResponse } from '@tubutree/shared-types';
import type { AlbumGame, AlbumLevel, AlbumTopicId } from './album.constants';

/**
 * Hợp đồng HTTP của Sổ tay Xanh (`/game/album*`). Bản sao phía client ở `packages/app-core/src/game-album/types.ts`; `album.service.spec.ts`
 * khoá tên trường của phản hồi.
 */

export interface AlbumTopicSummary {
  id: AlbumTopicId;
  /** Thẻ đang bật trong chủ đề (mẫu số). */
  total: number;
  /** Thẻ đang bật khách đã gặp. */
  seen: number;
  /** Thẻ đang bật khách đã thuộc (bậc 3). */
  mastered: number;
}

/** Thẻ khách đã gặp. Thẻ chưa gặp không có trong danh sách: chỉ có số lượng theo chủ đề. */
export interface AlbumCard {
  id: string;
  topic: AlbumTopicId;
  game: AlbumGame;
  level: Exclude<AlbumLevel, 0>;
  /** Số ván (thường và ôn) có thẻ này, số ván làm đúng, ngày VN gặp gần nhất. */
  seen: number;
  correct: number;
  lastSeenDay: string;
  /** Câu hỏi/món/nguyên liệu của thẻ. */
  title: string;
  /** Đáp án đúng ở dạng chữ; null khi không dựng được (vd sản phẩm đáp án của Căn Bếp Xanh đã ngừng bán). */
  answer: string | null;
  explanation: string;
  sourceUrl: string;
  /** Sản phẩm liên quan đang bán và còn hàng (tối đa một). */
  product: MiniProductCard | null;
  /** Admin đã tắt mục này: thẻ vẫn giữ, không tính vào mẫu số, không vào ván ôn. */
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
  /** Rỗng khi gọi `?summary=1` (dòng lối vào, màn kết quả ván). */
  cards: AlbumCard[];
  review: {
    /** Số thẻ tới hạn ôn lúc này (chưa trừ trần ván ôn trong ngày); có ván ôn đang mở thì là số câu của ván đó. */
    due: number;
    /** Số ván ôn còn bắt đầu được hôm nay; có ván ôn đang mở thì ít nhất 1 (bấm là mở lại ván đó). */
    leftToday: number;
  };
  /** Ván thường đã nộp gần nhất của game có vào sổ, và số thẻ lần đầu gặp ở ván đó. */
  lastRound: { roundId: string; newCards: number } | null;
  badges: AlbumBadge[];
}

/**
 * Ván "Ôn 5 thẻ" ở đúng dạng ván Đố Xanh không thưởng (`game: 'daily_quiz'`, `roundId` là mã ván ôn, `rewarded: false`), để client chạy nó trên máy
 * trạng thái ván và bàn chơi, màn kết quả sẵn có mà không cần lớp chuyển đổi. Câu không kèm đáp án, `product` luôn null.
 */
export type AlbumReviewStartResponse = MiniStartResponse & { content: { game: 'daily_quiz'; items: MiniChoiceItem[] } };

/** Kết quả ván ôn ở dạng kết quả ván Đố Xanh không thưởng: 💧, điểm, thưởng gốc luôn 0, không trần, không điểm danh. */
export type AlbumReviewSubmitResponse = MiniSubmitResponse & {
  water: 0;
  points: 0;
  baseWater: 0;
  basePoints: 0;
  rewarded: false;
  review: Extract<MiniReview, { game: 'daily_quiz' | 'origin' }>;
};
