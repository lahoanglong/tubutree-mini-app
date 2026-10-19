export const ONBOARDING_SNOOZE_KEY = 'tubu_onboarding_snooze_until';
export const ONBOARDING_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** `?s=` (gian hàng CTV), `?ref=` (mã giới thiệu) hoặc `?claim=` (thẻ QR hộp hàng, có sheet nhận ưu đãi riêng) ở search hay hash. */
export function hasPartnerLinkParams(...urlParts: string[]): boolean {
  return urlParts.some((part) => {
    const query = part.includes('?') ? part.slice(part.indexOf('?') + 1) : part.replace(/^[#?]/, '');
    const params = new URLSearchParams(query);
    return params.has('s') || params.has('ref') || params.has('claim');
  });
}

/**
 * Quiz chỉ hiện ở Trang chủ cho khách chưa làm, không hiện khi khách vào từ link sản phẩm/gian hàng/CTV
 * (phủ toàn màn hình sẽ chặn đúng lúc khách định mua), và không hiện lại trong thời gian đã bấm "Để sau".
 */
export function shouldShowOnboarding(opts: {
  onboarded: boolean;
  pathname: string;
  search: string;
  openedFromPartnerLink: boolean;
  snoozedUntil: number | null;
  now: number;
}): boolean {
  if (opts.onboarded) return false;
  if (opts.pathname !== '/') return false;
  if (opts.openedFromPartnerLink || hasPartnerLinkParams(opts.search)) return false;
  if (opts.snoozedUntil !== null && opts.snoozedUntil > opts.now) return false;
  return true;
}
