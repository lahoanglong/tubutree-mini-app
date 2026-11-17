import { fillTemplate } from '../copy-template';

/**
 * Chữ của "Chọn Chuẩn Xanh" (trang chơi trên web và các dòng dẫn vào). Tách khỏi `GAME_MINI_COPY` để Mini App không mang chữ của màn chỉ có trên web;
 * Mini chỉ dùng tên game (`game.matcher.title` trong `GAME_MINI_COPY`). `matcher.spec.ts` chạy `FORBIDDEN_TERMS`, bộ chặn tuyên bố và ngân sách độ dài.
 * Không hứa Giọt nước trước khi chơi: máy chủ chỉ thưởng khi game mini đang bật, nên chữ thưởng chỉ hiện khi kết quả có `water > 0`.
 */
export const MATCHER_COPY = {
  title: 'Chọn Chuẩn Xanh',
  'meta.description': 'Trả lời 3 câu về việc nhà, giải 2 câu đố nhỏ, nhận bộ 2–4 món còn hàng hợp với nhà bạn trong khoảng 1 phút.',
  'intro.sub': '3 câu về việc nhà, 2 câu đố nhỏ, ra bộ 2–4 món hợp với nhà bạn. Chừng 1 phút.',
  'intro.start': 'Bắt đầu',
  'step.aria': 'Bước {n} trên {total}',
  'step.label': 'Bước {n}/{total}',
  back: 'Quay lại',
  next: 'Tiếp',
  'trivia.kicker': 'Đố nhanh',
  'trivia.right': 'Đúng rồi.',
  'trivia.wrong': 'Chưa đúng. Đáp án: {a}.',
  'trivia.source': 'Nguồn: {host}',
  'trivia.sourceAria': 'Mở nguồn của câu đố ở tab mới',
  loading: 'Đang chọn bộ hợp với bạn…',
  'result.kicker': 'Bộ hợp với nhà bạn',
  'result.fallback': 'Bán chạy còn hàng',
  'result.fallbackNote': 'Bộ gợi ý đang tạm hết hàng, đây là các món bán chạy cùng nhóm.',
  'result.whyFallback': 'Bán chạy và còn hàng trong nhóm bạn chọn.',
  'result.total': 'Tổng {n} món',
  'result.addAll': 'Thêm cả bộ vào giỏ',
  'result.viewEach': 'Xem từng món',
  'result.viewCart': 'Xem giỏ',
  'result.added': 'Đã thêm {n} món vào giỏ.',
  'result.addError': 'Chưa thêm được vào giỏ. Bạn thử lại nhé.',
  'result.guestFull': 'Giỏ tạm đã đủ món. Bạn bỏ bớt món trong giỏ rồi thêm lại nhé.',
  'result.water': '+{n} Giọt nước cho lượt đầu hôm nay',
  'result.again': 'Chọn lại từ đầu',
  'result.empty': 'Nhóm này đang tạm hết hàng. Bạn chọn lại góc khác nhé.',
  'result.pending': 'Bộ bạn vừa chọn trước khi đăng nhập',
  'result.pendingPrice': 'Giá mới nhất hiện trong giỏ khi bạn thêm.',
  'error.disabled': 'Chọn Chuẩn Xanh đang tạm nghỉ. Bạn quay lại sau nhé.',
  'error.noContent': 'Chọn Chuẩn Xanh đang được cập nhật câu hỏi. Bạn quay lại sau nhé.',
  'error.load': 'Chưa tải được câu hỏi. Bạn thử lại nhé.',
  'error.result': 'Chưa ra được bộ gợi ý. Đáp án vẫn được giữ, bạn thử lại nhé.',
  'error.retry': 'Thử lại',
  'error.home': 'Về Vườn Xanh',
  'entry.desc': '1 phút ra bộ đồ xanh hợp nhà bạn',
  'entry.link': 'Chưa biết chọn gì? Thử Chọn Chuẩn Xanh',
} as const;

export type MatcherCopyKey = keyof typeof MATCHER_COPY;

/** Số ký tự tối đa sau khi điền biến với giá trị thường gặp: chặn câu dài làm vỡ dòng gọn ở 360px. */
export const MATCHER_COPY_MAX: Partial<Record<MatcherCopyKey, number>> = {
  title: 24,
  'meta.description': 160,
  'intro.sub': 96,
  'intro.start': 16,
  'step.label': 12,
  back: 12,
  next: 12,
  'trivia.kicker': 16,
  'result.kicker': 32,
  'result.fallback': 32,
  'result.total': 16,
  'result.pendingPrice': 48,
  'result.addAll': 24,
  'result.viewEach': 16,
  'result.viewCart': 12,
  'result.water': 48,
  'result.again': 20,
  'entry.desc': 48,
  'entry.link': 48,
};

export function matcherCopy(key: MatcherCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(MATCHER_COPY[key], vars, key);
}
