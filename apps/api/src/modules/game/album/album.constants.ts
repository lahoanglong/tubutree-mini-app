import type { MiniGameId } from '@tubutree/shared-types';

export const ALBUM_ENABLED_KEY = 'game.album_enabled';

/** Chủ đề của Sổ tay Xanh, theo thứ tự hiện trên hàng chip. */
export const ALBUM_TOPIC_IDS = ['waste', 'quiz', 'ingredients', 'origin', 'kitchen'] as const;
export type AlbumTopicId = (typeof ALBUM_TOPIC_IDS)[number];

/**
 * Game vào sổ và chủ đề của nó: mỗi game ghi đúng/sai theo TỪNG mục (`correctIds`), nên một mục là một thẻ. Chủ đề lấy theo game, không đoán theo
 * chữ của câu. Không vào sổ:
 * - Giỏ Đúng Việc (`basket`): chấm cả đề một lần (chỉ đúng khi chọn đủ 3 món), đáp án là bộ sản phẩm đang bán nên thẻ đổi theo tồn kho.
 * - Chọn Chuẩn Xanh (matcher): không ghi ván vào `game_play_rounds`, không chấm đúng/sai theo mục.
 * - Câu Đố Xanh cũ (`game_quizzes`, id `gq:`): không có ngày kiểm nguồn và không bật/tắt được theo mục.
 */
export const ALBUM_GAME_TOPIC = {
  sort: 'waste',
  daily_quiz: 'quiz',
  match: 'ingredients',
  origin: 'origin',
  kitchen_swap: 'kitchen',
} as const satisfies Partial<Record<MiniGameId, AlbumTopicId>>;
export type AlbumGame = keyof typeof ALBUM_GAME_TOPIC;
export const ALBUM_GAMES = Object.keys(ALBUM_GAME_TOPIC) as AlbumGame[];

export function isAlbumGame(game: string): game is AlbumGame {
  return Object.prototype.hasOwnProperty.call(ALBUM_GAME_TOPIC, game);
}

/** Bậc thuộc bài: 0 chưa gặp, 1 đã gặp, 2 đúng ở một ngày, 3 đúng ở ít nhất `ALBUM_MASTER_DAYS` ngày khác nhau (thuộc). */
export type AlbumLevel = 0 | 1 | 2 | 3;
export const ALBUM_MASTER_DAYS = 2;

/** Số mục tối đa của một ván "Ôn 5 thẻ". */
export const ALBUM_REVIEW_ITEMS = 5;
/** Số ván ôn tối đa một tài khoản bắt đầu trong một ngày VN (chặn cào nội dung qua ván ôn). */
export const ALBUM_REVIEWS_PER_DAY = 20;
/** Mục bậc 1–2 chưa gặp lại ít nhất chừng này ngày thì tới hạn ôn (lặp lại ngắt quãng). */
export const ALBUM_SPACING_DAYS = 3;
/** Số lựa chọn của câu ôn dựng từ một cặp Ghép Cặp (công dụng đúng + công dụng của cặp khác). */
export const ALBUM_MATCH_OPTIONS = 3;
/** Bộ nhớ đệm sổ theo người và bộ nhớ đệm nội dung chung. */
export const ALBUM_CACHE_MS = 60_000;
export const ALBUM_CACHE_MAX_USERS = 5_000;
