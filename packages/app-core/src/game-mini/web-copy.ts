import { fillTemplate } from '../copy-template';

/**
 * Chữ game mini chỉ web dùng: bản đồ của Đoán Xuất Xứ (từ 1024px), liên kết nguồn mở tab mới, bộ chờ thêm sau khi đăng nhập (trang tải lại), ô "Cách
 * chơi" cạnh bàn chơi, mô tả SEO, bộ chờ và thẻ lối vào của Chọn Chuẩn Xanh. Tách khỏi `GAME_MINI_COPY` và `MATCHER_COPY` vì hai bảng đó đi trong gói
 * Mini App, nơi Zalo cân tổng dung lượng thô (Mini App đăng nhập tại chỗ và không mở trang ngoài Zalo nên không cần các dòng này). Cùng luật chữ:
 * `game-mini.spec.ts` chạy `FORBIDDEN_TERMS`, bộ chặn tuyên bố thưởng và ngân sách độ dài trên từng khoá.
 */
export const GAME_MINI_WEB_COPY = {
  'origin.mapAria': 'Bản đồ Việt Nam vẽ sơ đồ, có quần đảo Hoàng Sa và Trường Sa',
  'origin.mapNone': 'Chọn một vùng để xem trên bản đồ',
  'origin.mapPicked': 'Vùng bạn chọn: {place}',
  'basket.pending': 'Bộ đúng ở ván trước của bạn',
  'result.sourceAria': 'Mở nguồn của mục {n} ở tab mới',
  'aside.how': 'Cách chơi',
  'matcher.meta.description': 'Trả lời 3 câu về việc nhà, giải 2 câu đố nhỏ, nhận bộ 2–4 món còn hàng hợp với nhà bạn trong khoảng 1 phút.',
  'matcher.trivia.sourceAria': 'Mở nguồn của câu đố ở tab mới',
  'matcher.result.viewEach': 'Xem từng món',
  'matcher.result.guestFull': 'Giỏ tạm đã đủ món. Bạn bỏ bớt món trong giỏ rồi thêm lại nhé.',
  'matcher.result.pending': 'Bộ bạn vừa chọn trước khi đăng nhập',
  'matcher.result.pendingPrice': 'Giá mới nhất hiện trong giỏ khi bạn thêm.',
  'matcher.entry.link': 'Chưa biết chọn gì? Thử Chọn Chuẩn Xanh',
} as const;

export type GameMiniWebCopyKey = keyof typeof GAME_MINI_WEB_COPY;

/** Số ký tự tối đa sau khi điền biến với giá trị thường gặp: chặn câu dài làm vỡ dòng gọn ở 360px. */
export const GAME_MINI_WEB_COPY_MAX: Partial<Record<GameMiniWebCopyKey, number>> = {
  'matcher.meta.description': 160,
  'matcher.result.pendingPrice': 48,
  'matcher.result.viewEach': 16,
  'matcher.entry.link': 48,
};

export function gameWebCopy(key: GameMiniWebCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(GAME_MINI_WEB_COPY[key], vars, key);
}
