import { fillTemplate } from '../copy-template';

/**
 * Chữ của "Chọn Chuẩn Xanh" (màn chơi ở web và Mini App, các dòng dẫn vào). Tách khỏi `GAME_MINI_COPY` để chữ của màn này chỉ đi theo chunk lười của
 * màn chơi. `matcher.spec.ts` chạy `FORBIDDEN_TERMS`, bộ chặn tuyên bố và ngân sách độ dài.
 * Không hứa Giọt nước trước khi chơi: máy chủ chỉ thưởng khi game mini đang bật, nên chữ thưởng chỉ hiện khi kết quả có `water > 0`.
 */
export const MATCHER_COPY = {
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
  loading: 'Đang chọn bộ hợp với bạn…',
  'result.kicker': 'Bộ hợp với nhà bạn',
  'result.fallback': 'Bán chạy còn hàng',
  'result.fallbackNote': 'Bộ gợi ý đang tạm hết hàng, đây là các món bán chạy cùng nhóm.',
  'result.whyFallback': 'Bán chạy và còn hàng trong nhóm bạn chọn.',
  'result.total': 'Tổng {n} món',
  'result.addAll': 'Thêm cả bộ vào giỏ',
  'result.viewCart': 'Xem giỏ',
  'result.added': 'Đã thêm {n} món vào giỏ.',
  'result.addError': 'Chưa thêm được vào giỏ. Bạn thử lại nhé.',
  'result.water': '+{n} Giọt nước cho lượt đầu hôm nay',
  'result.again': 'Chọn lại từ đầu',
  'result.empty': 'Nhóm này đang tạm hết hàng. Bạn chọn lại góc khác nhé.',
  'error.disabled': 'Chọn Chuẩn Xanh đang tạm nghỉ. Bạn quay lại sau nhé.',
  'error.noContent': 'Chọn Chuẩn Xanh đang được cập nhật câu hỏi. Bạn quay lại sau nhé.',
  'error.load': 'Chưa tải được câu hỏi. Bạn thử lại nhé.',
  'error.result': 'Chưa ra được bộ gợi ý. Đáp án vẫn được giữ, bạn thử lại nhé.',
  'error.retry': 'Thử lại',
  'error.home': 'Về Vườn Xanh',
} as const;

export type MatcherCopyKey = keyof typeof MATCHER_COPY;

/** Số ký tự tối đa sau khi điền biến với giá trị thường gặp: chặn câu dài làm vỡ dòng gọn ở 360px. */
export const MATCHER_COPY_MAX: Partial<Record<MatcherCopyKey, number>> = {
  'intro.sub': 96,
  'intro.start': 16,
  'step.label': 12,
  back: 12,
  next: 12,
  'trivia.kicker': 16,
  'result.kicker': 32,
  'result.fallback': 32,
  'result.total': 16,
  'result.addAll': 24,
  'result.viewCart': 12,
  'result.water': 48,
  'result.again': 20,
};

export function matcherCopy(key: MatcherCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(MATCHER_COPY[key], vars, key);
}
