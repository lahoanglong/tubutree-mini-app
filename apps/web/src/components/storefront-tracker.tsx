'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  clearPendingRef,
  confirmReferralTouch,
  ctvSlugFor,
  getStorefrontContext,
  readPendingRef,
  rememberEntryLink,
  rememberStorefront,
} from '@/lib/storefront-context';
import { recordReferralTouch } from '@/lib/shop-client';

/** Chạm giới thiệu xong thì nhớ máy chủ có ghi công mã đó không (mã khách thường bị bỏ qua) — quyết định ô mã ở thanh toán. */
function touchAndConfirm(dto: Parameters<typeof recordReferralTouch>[0]) {
  return recordReferralTouch(dto).then((res) => {
    if (res && typeof res.ok === 'boolean') confirmReferralTouch(dto.referralCode, res.ok);
    return res;
  });
}

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
    void touchAndConfirm({
      referralCode,
      storefrontSlug: slug,
      kind: type === 'CTV' ? 'ctv' : 'brand',
    })
      .then(() => clearPendingRef())
      .catch(() => undefined);
  }, [slug, type, referralCode, status]);

  return null;
}

/**
 * Bắt `?ref=` và `?s=` trên BẤT KỲ trang nào (link CTV chia sẻ trỏ thẳng tới trang chủ/trang sản phẩm,
 * không qua /s/), và ghi "chạm giới thiệu" lên server.
 *
 * Chỉ nhớ vào sessionStorage là chưa đủ: khách mở link, xem rồi đóng tab, hôm sau mở tab mới và
 * mua thì sessionStorage đã mất — đơn về `referralCode = null` và CTV mất hoa hồng. "Chạm" phía
 * server sống 3 ngày, đó mới là lớp giữ attribution thật; nhưng chạm cần đăng nhập, nên khách mở link
 * khi chưa đăng nhập còn một bản chờ ở localStorage (7 ngày) để chạm bù ngay khi đăng nhập ở tab nào đó.
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
    if (referralCode) {
      const storefrontSlug = ctvSlugFor(ctx);
      void touchAndConfirm({
        referralCode,
        ...(storefrontSlug ? { storefrontSlug } : {}),
        kind: ctx.kind === null || ctx.kind === 'CTV' ? 'ctv' : 'brand',
      })
        .then(() => clearPendingRef())
        .catch(() => undefined);
      return;
    }
    // Tab này chưa có nguồn nào (tab mới sau khi đóng tab cũ): chạm bù theo link khách đã mở khi chưa đăng nhập. Xoá bản chờ
    // cả khi máy chủ trả ok:false (mã không phải CTV, thử lại cũng vậy); lỗi mạng thì giữ để lần sau thử lại.
    const pending = readPendingRef();
    if (!pending) return;
    const pendingCode = pending.referralCode ?? (pending.kind === 'CTV' ? pending.slug : null);
    if (!pendingCode) {
      clearPendingRef();
      return;
    }
    void recordReferralTouch({
      referralCode: pendingCode,
      ...(pending.kind === 'CTV' && pending.slug ? { storefrontSlug: pending.slug } : {}),
      kind: pending.kind === null || pending.kind === 'CTV' ? 'ctv' : 'brand',
    })
      .then(() => clearPendingRef())
      .catch(() => undefined);
  }, [status]);

  return null;
}
