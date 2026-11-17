import type { MiniMatchCard } from '@tubutree/shared-types';

/**
 * Logic thuần của bàn Ghép Cặp (G3), dùng chung Mini App và web, chỉ nằm trong chunk của bàn này.
 *
 * Máy chủ giữ đáp án: mã thẻ của ván không cho biết thẻ nào đi với thẻ nào, nên client KHÔNG biết một cặp đúng hay sai lúc ghép. Vì vậy 12 thẻ
 * để ngửa (khách đọc được cả nguyên liệu lẫn công dụng), chạm một nguyên liệu rồi một công dụng là thành một cặp; chạm lại một thẻ của cặp là
 * gỡ cặp đó (không biết đúng sai nên phải cho sửa, kẻo một lần chạm nhầm khoá sai hai cặp). Đúng/sai và dòng khoa học của từng cặp hiện ở màn
 * kết quả. Hai thẻ cùng loại (hai nguyên liệu hoặc hai công dụng) không ghép được:
 * hai thẻ báo "không khớp" rồi trở lại như cũ sau `MATCH_MISMATCH_MS`.
 */

/** Hai thẻ cùng loại giữ trạng thái "không khớp" chừng này rồi trở lại; `prefers-reduced-motion` chỉ bỏ hoạt ảnh, không bỏ khoảng chờ. */
export const MATCH_MISMATCH_MS = 800;

export interface MatchProgress {
  /** Thẻ đang chọn, chờ thẻ thứ hai. */
  selected: string | null;
  /** Hai thẻ cùng loại vừa chạm: hiện "không khớp" tới `until`. */
  mismatch: { a: string; b: string; until: number } | null;
  /** Các cặp đã ghép theo thứ tự ghép, mỗi cặp [nguyên liệu, công dụng]. */
  pairs: [string, string][];
}

export const matchStart = (): MatchProgress => ({ selected: null, mismatch: null, pairs: [] });

/** Số thứ tự (từ 1) của cặp chứa thẻ; chưa ghép thì null. */
export function matchPairNo(p: MatchProgress, cardId: string): number | null {
  const i = p.pairs.findIndex(([a, b]) => a === cardId || b === cardId);
  return i < 0 ? null : i + 1;
}

/** Đã ghép hết: mọi thẻ nằm trong một cặp. */
export const matchDone = (p: MatchProgress, cards: readonly MiniMatchCard[]) => cards.length > 0 && p.pairs.length * 2 >= cards.length;

/** Hết thời gian "không khớp": hai thẻ trở lại chưa chọn. Chưa tới hạn thì trả lại đúng đối tượng cũ. */
export function matchSettle(p: MatchProgress, now: number): MatchProgress {
  return p.mismatch && now >= p.mismatch.until ? { ...p, mismatch: null } : p;
}

/**
 * Chạm một thẻ. Bỏ qua (trả lại đúng đối tượng cũ) khi: thẻ lạ, đã ghép hết (ván đã nộp). Chạm thẻ đã nằm trong cặp thì gỡ cặp đó, hai thẻ về
 * chưa chọn (số cặp sau nó lùi một). Chạm lại thẻ đang chọn thì bỏ chọn. Đang
 * hiện "không khớp" mà chạm thẻ thứ ba thì hai thẻ kia trở lại ngay và thẻ thứ ba được chọn; chạm lại một trong hai thẻ đó thì chỉ đóng
 * "không khớp". Thẻ thứ hai khác loại với thẻ đang chọn thì thành cặp; cùng loại thì sang "không khớp".
 */
export function matchTap(p: MatchProgress, cards: readonly MiniMatchCard[], cardId: string, now: number, mismatchMs: number = MATCH_MISMATCH_MS): MatchProgress {
  const card = cards.find((c) => c.cardId === cardId);
  if (!card || matchDone(p, cards)) return p;
  const pairNo = matchPairNo(p, cardId);
  if (pairNo !== null) return { selected: null, mismatch: null, pairs: p.pairs.filter((_, i) => i !== pairNo - 1) };
  if (p.mismatch) {
    const { a, b } = p.mismatch;
    if (cardId === a || cardId === b) return { ...p, mismatch: null };
    return { ...p, mismatch: null, selected: cardId };
  }
  if (p.selected === null) return { ...p, selected: cardId };
  if (p.selected === cardId) return { ...p, selected: null };
  const first = cards.find((c) => c.cardId === p.selected);
  if (!first) return { ...p, selected: cardId };
  if (first.side === card.side) return { ...p, selected: null, mismatch: { a: first.cardId, b: cardId, until: now + mismatchMs } };
  const pair: [string, string] = first.side === 'ingredient' ? [first.cardId, cardId] : [cardId, first.cardId];
  return { selected: null, mismatch: null, pairs: [...p.pairs, pair] };
}

/** Trạng thái vẽ của một thẻ. */
export type MatchCardState = 'idle' | 'selected' | 'mismatch' | 'paired';

export function matchCardState(p: MatchProgress, cardId: string): MatchCardState {
  if (matchPairNo(p, cardId) !== null) return 'paired';
  if (p.mismatch && (p.mismatch.a === cardId || p.mismatch.b === cardId)) return 'mismatch';
  return p.selected === cardId ? 'selected' : 'idle';
}

/** Đáp án gửi máy chủ: các cặp đã ghép (thẻ đang chọn dở khi hết giờ không tính). */
export const matchAnswers = (p: MatchProgress): [string, string][] => p.pairs.map(([a, b]) => [a, b]);
