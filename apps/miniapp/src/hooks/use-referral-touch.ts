import { useEffect } from 'react';
import { recordReferralTouch } from '../services/affiliate-api';
import { markCtvTouched, useStorefrontContext, wasCtvTouched } from '../store/storefront-context';

/**
 * Các lần chạm xếp hàng một chuỗi: lần chạm brand đợi lần chạm CTV đang bay xong rồi mới kiểm dấu "đã ghi công như CTV". Gửi song
 * song thì máy chủ có thể xử lý brand sau cùng và xoá slug gian hàng CTV khỏi dòng chạm.
 */
let queue: Promise<void> = Promise.resolve();
const enqueue = (job: () => Promise<void>) => {
  queue = queue.then(job).catch(() => {});
};

/**
 * Attribution 3 ngày: khi đã đăng nhập và có ngữ cảnh giới thiệu (ref/slug từ link), ghi "chạm" lên máy chủ. Mọi đường vào
 * (/, /s/:slug, /brand/:slug) đều đặt storefront-context nên một effect tập trung ở đây phủ hết; upsert làm mới hạn.
 * Máy chủ trả ok:false khi mã không phải của CTV/đại lý (vd mã khách thường từ nút chia sẻ): kết quả đó quyết định
 * thanh toán có khoá ô mã giới thiệu hay không. Lỗi mạng thì chưa biết (null), không coi là mã sai.
 * Mã đã được ghi công qua gian hàng CTV (dấu nằm ở sessionStorage, sống qua tải lại WebView) thì mở gian hàng đối tác/nhãn không
 * chạm lại kiểu brand: máy chủ upsert cả dòng chạm và sẽ xoá slug gian hàng CTV khỏi nó (đơn sau không còn gắn gian hàng CTV,
 * combo, storefrontSlug) dù hoa hồng không đổi.
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
    enqueue(async () => {
      if (kind !== 'ctv' && wasCtvTouched(code)) return;
      try {
        const res = await recordReferralTouch({
          referralCode: code,
          storefrontSlug: kind === 'ctv' ? (slug ?? undefined) : undefined,
          kind: kind === 'ctv' ? 'ctv' : 'brand',
        });
        if (res && typeof res.ok === 'boolean') confirmReferral(code, res.ok);
        if (res?.ok && kind === 'ctv') markCtvTouched(code);
      } catch {
        /* chạm là best-effort: ngữ cảnh trong phiên vẫn được gửi kèm lúc đặt đơn */
      }
    });
  }, [authed, referralCode, slug, kind, confirmReferral]);
}
