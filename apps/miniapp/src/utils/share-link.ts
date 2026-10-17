const REF_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Gắn mã giới thiệu của NGƯỜI CHIA SẺ vào link: người nhận mở link thì app đọc `?ref=` (components/app.tsx) và ghi nhận
 * người mời lúc tạo tài khoản. Link đã mang `ref` (gian hàng CTV) giữ nguyên, không ghi đè mã của người khác; mã sai khuôn
 * (người dùng không nhập được, nhưng đây là chuỗi đưa vào URL) bị bỏ.
 */
export function withReferral(path: string, referralCode: string | null | undefined): string {
  if (!referralCode || !REF_CODE_PATTERN.test(referralCode)) return path;
  const hashAt = path.indexOf('#');
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const queryAt = base.indexOf('?');
  if (queryAt >= 0 && new URLSearchParams(base.slice(queryAt + 1)).has('ref')) return path;
  return `${base}${queryAt >= 0 ? '&' : '?'}ref=${referralCode}${hash}`;
}
