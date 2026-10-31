/**
 * Luật phía khách của "chạm giới thiệu" dùng chung Mini App và web: lúc bấm link gửi lên API, và dấu "mã này đã được
 * máy chủ ghi công như CTV" gắn theo người dùng.
 */

const norm = (code: string | null | undefined) => (code ?? '').trim().toUpperCase();

/**
 * Khoảng thời gian đã trôi từ lúc bấm link, tính bằng cùng một đồng hồ máy (lúc bấm cũng do máy này ghi) nên đồng hồ lệch không
 * ảnh hưởng. Máy chủ tự trừ từ giờ của nó. Thiếu lúc bấm thì không gửi (máy chủ tính từ lúc nhận); đồng hồ lùi làm âm thì gửi 0.
 */
export function clickedAgoParam(clickedAtMs: number | null | undefined, nowMs: number = Date.now()): { clickedAgoMs: number } | Record<string, never> {
  return typeof clickedAtMs === 'number' && clickedAtMs > 0 ? { clickedAgoMs: Math.max(0, nowMs - clickedAtMs) } : {};
}

export interface TouchMark {
  userId: string;
  code: string;
}

export function serializeTouchMark(userId: string, code: string): string {
  return JSON.stringify({ u: userId, c: norm(code) });
}

/** Chuỗi cũ (chỉ có mã, không biết của ai) hay hỏng thì coi như không có dấu. */
export function parseTouchMark(raw: string | null): TouchMark | null {
  try {
    const p = JSON.parse(raw ?? '') as { u?: unknown; c?: unknown } | null;
    return p && typeof p.u === 'string' && p.u && typeof p.c === 'string' && p.c ? { userId: p.u, code: p.c } : null;
  } catch {
    return null;
  }
}

/** Dấu chỉ có hiệu lực với đúng người đã được ghi công: người đăng nhập sau trong cùng tab không thừa hưởng. */
export function touchMarkMatches(mark: TouchMark | null, userId: string | null | undefined, code: string): boolean {
  return !!mark && !!userId && mark.userId === userId && mark.code === norm(code);
}

/**
 * Dấu sau một lượt chạm máy chủ đã trả lời. Chạm CTV ghi công thì dấu là mã đó. Chạm brand ghi công thì dòng chạm ở máy chủ giờ
 * là mã brand: dấu của mã khác không còn đúng nữa, nếu giữ thì lần chạm brand về mã CTV cũ sẽ bị bỏ qua và máy chủ mãi ghi mã kia.
 */
export function touchMarkAfter(
  mark: TouchMark | null,
  userId: string,
  code: string,
  kind: 'ctv' | 'brand',
  ok: boolean,
): TouchMark | null {
  if (!ok) return mark;
  if (kind === 'ctv') return { userId, code: norm(code) };
  return touchMarkMatches(mark, userId, code) ? mark : null;
}
