/**
 * Lời báo của "Gửi lại như lần trước" (phần lần trước đã bị bỏ: loại rác nay không nhận, cách gửi hoặc điểm nhận nay đóng). Mini App gửi kèm nháp trong
 * navigation state; web giữ nháp ở sessionStorage (`lib/recycle-wizard`) mà bộ đọc nháp chỉ giữ các trường đã biết, nên lời báo đi riêng một khoá.
 */
export type RepeatNotes = { items: string | null; method: string | null };

const KEY = 'tubu_recycle_repeat_notes';

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function saveRepeatNotes(notes: RepeatNotes): void {
  try {
    if (notes.items || notes.method) window.sessionStorage.setItem(KEY, JSON.stringify(notes));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* không có storage thì khách chỉ không thấy lời báo; nháp vẫn đã bỏ phần không hợp lệ */
  }
}

export function readRepeatNotes(): RepeatNotes | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    const notes = { items: text(v?.items), method: text(v?.method) };
    return notes.items || notes.method ? notes : null;
  } catch {
    return null;
  }
}

export function clearRepeatNotes(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* như trên */
  }
}
