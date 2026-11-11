import { useCallback, useState } from 'react';

type Primitive = string | number | boolean | null | undefined;
/** Giá trị ô của một form trong tấm: chỉ kiểu nguyên thuỷ (so sánh bằng `Object.is`). */
export type DraftValues = Record<string, Primitive>;

interface DraftState<T extends DraftValues> {
  /** `openKey` của lần vẽ trước, để biết tấm vừa mở/đổi đích/đóng. */
  key: unknown;
  /** Dữ liệu máy chủ mà các ô chưa chạm đang bám theo (null: lúc mở chưa có dữ liệu). */
  base: T | null;
  values: T;
  touched: Partial<Record<keyof T, true>>;
}

export interface SyncedDraft<T extends DraftValues> {
  /** Giá trị đang hiện trong form: ô đã chạm giữ chữ khách sửa, ô chưa chạm bám theo dữ liệu máy chủ mới nhất. */
  values: T;
  /** Khách sửa một ô. Ô đó thành "đã chạm": dữ liệu máy chủ về sau không ghi đè nữa. Giá trị trùng giá trị đang hiện thì không tính là chạm. */
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  isTouched: (key: keyof T) => boolean;
  /** Có ít nhất một ô khách đã sửa. */
  dirty: boolean;
}

function seed<T extends DraftValues>(empty: T, source: T | null | undefined): T {
  const out = { ...empty };
  for (const k of Object.keys(empty) as (keyof T)[]) {
    const v = source?.[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function sameSeed<T extends DraftValues>(empty: T, a: T | null, b: T): boolean {
  if (!a) return false;
  return (Object.keys(empty) as (keyof T)[]).every((k) => Object.is(a[k] ?? empty[k], b[k] ?? empty[k]));
}

/**
 * Form của tấm nạp từ dữ liệu máy chủ lúc MỞ, rồi bám theo dữ liệu mới về trong lúc tấm còn mở (tải lại sau khi máy chủ từ chối, thông báo,
 * người khác sửa cùng bản ghi...): ô khách CHƯA chạm đổi theo giá trị mới, ô khách ĐÃ sửa giữ nguyên chữ đang gõ. Không có hook này, ô chưa chạm
 * giữ giá trị cũ rồi bấm Lưu gửi giá trị cũ đè lên thay đổi mới trên máy chủ.
 *
 * - `empty`: hình dạng form + giá trị rỗng của từng ô (hằng ở ngoài component). Chỉ các khoá của `empty` được đồng bộ.
 * - `source`: dữ liệu máy chủ HIỆN TẠI của bản ghi đang sửa (đọc từ query sống, không phải bản chụp lúc mở); null/undefined nếu chưa có.
 *   Đang mở mà `source` về null (bản ghi bị gỡ, lịch đang tải lại) thì mọi ô GIỮ NGUYÊN, không xoá về rỗng; có lại dữ liệu thì ô chưa chạm bám theo.
 * - `openKey`: thứ cho biết tấm đang mở, cùng giá trị đưa cho `useSheetSeq` (boolean `open` hoặc mã đích, null khi đóng). Phải là giá trị nguyên thuỷ
 *   ổn định giữa các lần vẽ (chuỗi/boolean/null): đối tượng mới mỗi lần vẽ làm hook nạp lại mãi. Mỗi lần mở mới hoặc đổi đích là một lần nạp lại từ đầu,
 *   bỏ hết dấu "đã chạm"; đóng thì giữ nguyên chữ (nội dung còn hiện lúc tấm trượt xuống) và không bám nữa.
 *
 * Kết hợp `useSheetSeq`: lệnh gửi mang số lần mở (`seq.mark()` ở `onMutate`) và chỉ đóng tấm khi `seq.isCurrent(sent)`, nên phản hồi muộn của lần mở trước
 * không đóng tấm vừa mở lại cùng chữ khách đang gõ; còn dữ liệu mới về giữa chừng thì chỉ làm mới ô chưa chạm. Hook cố ý không có `reset()/clear()`:
 * form được nạp lại bằng cách đóng rồi mở lại (đổi `openKey`).
 */
export function useSyncedDraft<T extends DraftValues>(empty: T, source: T | null | undefined, openKey: unknown): SyncedDraft<T> {
  const src = source ?? null;
  const [state, setState] = useState<DraftState<T>>(() => ({ key: openKey, base: src, values: seed(empty, src), touched: {} }));

  // Chỉnh state ngay lúc vẽ (cách React cho phép) để lần vẽ đầu tiên của tấm mới mở đã có giá trị đúng, không nháy giá trị cũ.
  let cur = state;
  if (!Object.is(state.key, openKey)) {
    cur = openKey ? { key: openKey, base: src, values: seed(empty, src), touched: {} } : { ...state, key: openKey };
    setState(cur);
  } else if (openKey && src !== null && !sameSeed(empty, state.base, src)) {
    const fresh = seed(empty, src);
    const values = { ...state.values };
    for (const k of Object.keys(empty) as (keyof T)[]) if (!state.touched[k]) values[k] = fresh[k];
    cur = { ...state, base: src, values };
    setState(cur);
  }

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setState((p) => (Object.is(p.values[key], value) ? p : { ...p, values: { ...p.values, [key]: value }, touched: { ...p.touched, [key]: true } }));
  }, []);

  return {
    values: cur.values,
    set,
    isTouched: (key) => Boolean(cur.touched[key]),
    dirty: Object.keys(cur.touched).length > 0,
  };
}
