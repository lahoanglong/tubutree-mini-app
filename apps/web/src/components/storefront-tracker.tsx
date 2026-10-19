'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { rememberEntryLink, rememberStorefront, getStorefrontContext, ctvSlugFor } from '@/lib/storefront-context';
import { recordReferralTouch } from '@/lib/shop-client';

/**
 * Ghi nhớ khách đang mua qua gian hàng nào, và báo "chạm giới thiệu" lên server.
 *
 * Trang /s/[slug] là server component nên phần này phải là client component đặt trong đó. Không
 * có nó thì đơn đặt từ link gian hàng CTV về `storefrontSlug = null`: CTV không được ghi nhận
 * đơn, và combo giảm giá của gian hàng cũng không được áp (khách trả cao hơn giá quảng cáo).
 */
export function StorefrontTracker({ slug, type, referralCode }: { slug: string; type?: string; referralCode?: string | null }) {
  const { status } = useAuth();

  useEffect(() => {
    rememberStorefront(slug, type, referralCode);
  }, [slug, type, referralCode]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const { referralCode } = getStorefrontContext();
    if (!referralCode) return;
    // Best-effort: hỏng thì vẫn còn ngữ cảnh trong tab để gửi lúc đặt đơn.
    void recordReferralTouch({
      referralCode,
      storefrontSlug: slug,
      kind: type === 'CTV' ? 'ctv' : 'brand',
    }).catch(() => undefined);
  }, [slug, type, referralCode, status]);

  return null;
}

/**
 * Bắt `?ref=` và `?s=` trên BẤT KỲ trang nào (link CTV chia sẻ trỏ thẳng tới trang chủ/trang sản phẩm,
 * không qua /s/), và ghi "chạm giới thiệu" lên server.
 *
 * Chỉ nhớ vào sessionStorage là chưa đủ: khách mở link, xem rồi đóng tab, hôm sau mở tab mới và
 * mua thì sessionStorage đã mất — đơn về `referralCode = null` và CTV mất hoa hồng. "Chạm" phía
 * server sống 3 ngày, đó mới là lớp giữ attribution thật.
 */
export function ReferralCapture() {
  const { status } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    rememberEntryLink(params.get('s'), params.get('ref'));
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const ctx = getStorefrontContext();
    // Link gian hàng CTV không kèm ref thì mã giới thiệu chính là slug (như Mini App); gian hàng nhãn thì không.
    const referralCode = ctx.referralCode ?? (ctx.kind === 'CTV' ? ctx.slug : null);
    if (!referralCode) return;
    const storefrontSlug = ctvSlugFor(ctx);
    void recordReferralTouch({
      referralCode,
      ...(storefrontSlug ? { storefrontSlug } : {}),
      kind: ctx.kind === null || ctx.kind === 'CTV' ? 'ctv' : 'brand',
    }).catch(() => undefined);
  }, [status]);

  return null;
}
