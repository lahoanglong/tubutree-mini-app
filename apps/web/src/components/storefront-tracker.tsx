'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  clearPendingRef,
  confirmReferralTouch,
  ctvSlugFor,
  getStorefrontContext,
  readPendingRefs,
  rememberEntryLink,
  rememberStorefront,
  type PendingRef,
} from '@/lib/storefront-context';
import { recordReferralTouch } from '@/lib/shop-client';

type TouchDto = Parameters<typeof recordReferralTouch>[0];

/** Chạm giới thiệu xong thì nhớ máy chủ có ghi công mã đó không (mã khách thường bị bỏ qua) — quyết định ô mã ở thanh toán. */
function touchAndConfirm(dto: TouchDto) {
  return recordReferralTouch(dto).then((res) => {
    if (res && typeof res.ok === 'boolean') confirmReferralTouch(dto.referralCode, res.ok);
    return res;
  });
}

/** Link CTV không kèm ref thì mã giới thiệu chính là slug (như Mini App); link không có nguồn nào thì không chạm được. */
function touchFromPending(p: PendingRef): TouchDto | null {
  const referralCode = p.referralCode ?? (p.kind === 'CTV' ? p.slug : null);
  if (!referralCode) return null;
  return {
    referralCode,
    ...(p.kind === 'CTV' && p.slug ? { storefrontSlug: p.slug } : {}),
    kind: p.kind === null || p.kind === 'CTV' ? 'ctv' : 'brand',
  };
}

// Cùng mã là cùng người giới thiệu: bản trong phiên mới hơn và đủ thông tin hơn (slug gian hàng đang xem) nên thay bản chờ.
const sameTouch = (a: TouchDto, b: TouchDto) => a.referralCode.toUpperCase() === b.referralCode.toUpperCase();

/**
 * Chạm lúc đã đăng nhập, theo thứ tự cũ đến mới: các link khách mở khi chưa đăng nhập (bản chờ) trước, nguồn đang dùng trong
 * phiên sau cùng. Máy chủ giữ chạm hợp lệ gần nhất và bỏ qua mã khách thường, nên link CTV mở trước đó không mất công khi một
 * link mã khách thường được mở sau. Bản chờ chỉ xoá khi mọi chạm đều tới được máy chủ (kể cả ok:false, thử lại cũng vậy); lỗi
 * mạng thì giữ để lần sau thử lại. Best-effort: hỏng thì vẫn còn ngữ cảnh trong tab để gửi lúc đặt đơn.
 */
async function replayTouches(session: TouchDto | null): Promise<void> {
  const older = readPendingRefs()
    .map(touchFromPending)
    .filter((t): t is TouchDto => t !== null && !(session && sameTouch(t, session)));
  let delivered = true;
  for (const dto of older) {
    try {
      await recordReferralTouch(dto);
    } catch {
      delivered = false;
    }
  }
  if (session) {
    try {
      await touchAndConfirm(session);
    } catch {
      delivered = false;
    }
  }
  if (delivered) clearPendingRef();
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
    void replayTouches({
      referralCode,
      storefrontSlug: slug,
      kind: type === 'CTV' ? 'ctv' : 'brand',
    });
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
 * khi chưa đăng nhập còn được nhớ (3 link gần nhất, 7 ngày) ở localStorage để chạm bù ngay khi đăng nhập ở tab nào đó.
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
    const storefrontSlug = ctvSlugFor(ctx);
    const session: TouchDto | null = referralCode
      ? {
          referralCode,
          ...(storefrontSlug ? { storefrontSlug } : {}),
          kind: ctx.kind === null || ctx.kind === 'CTV' ? 'ctv' : 'brand',
        }
      : null;
    void replayTouches(session);
  }, [status]);

  return null;
}
