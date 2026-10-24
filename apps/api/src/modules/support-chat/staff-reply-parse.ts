const STAFF_CODE = /^\s*#([A-Za-z2-9]{4})(?![A-Za-z0-9])\s*/;

/** Tách mã hội thoại ở đầu câu nhân viên; không có mã thì trả nguyên văn (đã cắt khoảng trắng hai đầu). */
export function parseStaffReply(text: string | null): { code: string | null; body: string } {
  if (!text) return { code: null, body: '' };
  const m = STAFF_CODE.exec(text);
  if (!m) return { code: null, body: text.trim() };
  return { code: m[1]!.toUpperCase(), body: text.slice(m[0].length).trim() };
}
