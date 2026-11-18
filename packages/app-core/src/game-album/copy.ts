import { fillTemplate } from '../copy-template';

/**
 * Chữ của Sổ tay Xanh, dùng chung Mini App và web. Tách khỏi `shop-copy.ts` như chữ game mini (`game-mini/copy.ts`): chữ chỉ nạp cùng chunk lười
 * của sổ, không vào gói khởi động. `album.spec.ts` quét `FORBIDDEN_TERMS`, tuyên bố xanh và ngân sách độ dài.
 */
export const ALBUM_COPY = {
  title: 'Sổ tay Xanh',
  entry: 'Sổ tay Xanh · {n}/{m} thẻ',
  progress: 'Đã mở {n}/{m} thẻ, thuộc {k}',
  'topic.all': 'Tất cả',
  'topic.waste': 'Phân loại rác',
  'topic.quiz': 'Đố Xanh',
  'topic.ingredients': 'Nguyên liệu và công dụng',
  'topic.origin': 'Vùng miền',
  'topic.kitchen': 'Bếp ít nhựa',
  locked: '{n} thẻ chưa mở',
  level: 'Mức thuộc {n}/3',
  review: 'Ôn {n} thẻ',
  'review.none': 'Chơi thêm một ván để mở thẻ mới',
  'review.limit': 'Hôm nay đã ôn đủ, mai ôn tiếp nhé.',
  'review.fail': 'Ván ôn chưa ghi nhận được.',
  empty: 'Chơi một ván để mở thẻ đầu tiên',
  guest: 'Đăng nhập để xem thẻ đã mở',
  login: 'Đăng nhập',
  off: 'Sổ tay Xanh đang tạm nghỉ.',
  newCards: '+{n} thẻ mới vào Sổ tay Xanh',
  'badge.ALBUM_MASTER_10': 'Thuộc 10 thẻ',
  'badge.ALBUM_TOPIC': 'Thuộc trọn một chủ đề',
  'badge.ALBUM_ALL': 'Thuộc cả sổ',
} as const;

export type AlbumCopyKey = keyof typeof ALBUM_COPY;

/** Trần độ dài (sau khi điền số) của chữ nằm trên chip, nút và dòng một hàng. */
export const ALBUM_COPY_MAX: Partial<Record<AlbumCopyKey, number>> = {
  title: 16,
  entry: 32,
  'topic.all': 24,
  'topic.waste': 24,
  'topic.quiz': 24,
  'topic.ingredients': 24,
  'topic.origin': 24,
  'topic.kitchen': 24,
  review: 12,
  'review.none': 36,
  login: 16,
  newCards: 32,
  'badge.ALBUM_MASTER_10': 24,
  'badge.ALBUM_TOPIC': 24,
  'badge.ALBUM_ALL': 24,
};

export function albumCopy(key: AlbumCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(ALBUM_COPY[key], vars, key);
}
