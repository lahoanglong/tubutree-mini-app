import { useEffect } from 'react';
import { recordReferralTouch } from '../services/affiliate-api';
import { useStorefrontContext } from '../store/storefront-context';

/**
 * Attribution 3 ngày: khi đã đăng nhập và có ngữ cảnh giới thiệu (ref/slug từ link), ghi "chạm" lên máy chủ. Mọi đường vào
 * (/, /s/:slug, /brand/:slug) đều đặt storefront-context nên một effect tập trung ở đây phủ hết; upsert làm mới hạn.
 * Máy chủ trả ok:false khi mã không phải của CTV/đại lý (vd mã khách thường từ nút chia sẻ): kết quả đó quyết định
 * thanh toán có khoá ô mã giới thiệu hay không. Lỗi mạng thì chưa biết (null), không coi là mã sai.
 */
export function useReferralTouch(authed: boolean): void {
  const referralCode = useStorefrontContext((s) => s.referralCode);
  const slug = useStorefrontContext((s) => s.slug);
  const kind = useStorefrontContext((s) => s.kind);
  const confirmReferral = useStorefrontContext((s) => s.confirmReferral);

  useEffect(() => {
    if (!authed) return;
    const code = referralCode ?? slug;
    if (!code) return;
    recordReferralTouch({
      referralCode: code,
      storefrontSlug: kind === 'ctv' ? (slug ?? undefined) : undefined,
      kind: kind === 'ctv' ? 'ctv' : 'brand',
    })
      .then((res) => {
        if (res && typeof res.ok === 'boolean') confirmReferral(code, res.ok);
      })
      .catch(() => {});
  }, [authed, referralCode, slug, kind, confirmReferral]);
}
