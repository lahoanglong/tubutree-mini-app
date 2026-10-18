/**
 * Che dữ liệu cá nhân trước khi ghi log máy chủ: log container được giữ và đọc qua GitHub Actions (logs.yml), nên
 * SĐT khách không được nằm nguyên văn ở đó. Cùng quy ước 3 số đầu + 3 số cuối với màn CTV/thành viên.
 */

/** 3 ký tự đầu + "****" + 3 ký tự cuối, KHÔNG chặn chuỗi ngắn (chuỗi <= 6 ký tự sẽ lộ gần hết). */
export function maskPhoneEnds(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

/** Như `maskPhoneEnds` nhưng chuỗi <= 6 ký tự ra "***"; SĐT trống trả `null` (dùng trong payload API). */
export function maskPhoneOrNull(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length <= 6) return '***';
  return maskPhoneEnds(phone);
}

export function maskPhone(phone: string | null | undefined): string {
  return maskPhoneOrNull(phone) ?? '(không có SĐT)';
}

/** Chỉ giữ 3 số cuối, giữ độ dài: `0912345123` → `*******123`. Trống trả chuỗi rỗng. */
export function maskPhoneKeepLast3(phone: string | null | undefined): string {
  if (!phone) return '';
  return `${'*'.repeat(Math.max(phone.length - 3, 0))}${phone.slice(-3)}`;
}

/**
 * Dãy từ 8 chữ số trở lên, giữa hai chữ số liền nhau có tối đa 2 ký tự cách (khoảng trắng . , - _ /): SĐT hay số tài khoản
 * viết tách (`0912-345-678`, `0912,345,678`, `1903 1234 5678`). Kiểm trên chuỗi đã chuẩn hoá NFKC.
 */
export const PHONE_LIKE_RUN = /\p{Nd}(?:[\s.,\-_/]{0,2}\p{Nd}){7,}/u;

const PHONE_LIKE_RUN_ALL = new RegExp(PHONE_LIKE_RUN.source, 'gu');

/** Chữ tự do (ghi chú đơn): mỗi dãy giống SĐT / số tài khoản chỉ giữ 3 chữ số cuối, ký tự cách giữ nguyên (`0912-345-678` → `****-***-678`). */
export function maskPhoneLikeRuns(text: string): string {
  return text.normalize('NFKC').replace(PHONE_LIKE_RUN_ALL, (run) => {
    let keep = 3;
    return [...run]
      .reverse()
      .map((ch) => (/\p{Nd}/u.test(ch) ? (keep-- > 0 ? ch : '*') : ch))
      .reverse()
      .join('');
  });
}
