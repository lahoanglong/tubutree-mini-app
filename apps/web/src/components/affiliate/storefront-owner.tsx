'use client';

import Link from 'next/link';
import { Leaf, Plus, ShoppingBag } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ui } from '@/lib/guest-ui';

/** Chủ gian hàng CTV nhận ra qua mã giới thiệu (API chỉ trả mã ở gian hàng CTV), không phân biệt hoa thường. */
export function useIsStorefrontOwner(referralCode: string | null | undefined): boolean {
  const { user } = useAuth();
  const mine = user?.referralCode;
  return Boolean(mine && referralCode && mine.toUpperCase() === referralCode.toUpperCase());
}

/** Chủ thấy lối vào trình dựng; khách thấy lối xem sản phẩm. */
export function StorefrontAction({ referralCode, guestLabel = 'Xem sản phẩm' }: { referralCode?: string | null; guestLabel?: string }) {
  const owner = useIsStorefrontOwner(referralCode);
  return owner ? (
    <Link href="/ctv/gian-hang" className={ui.btnPrimary}>
      <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
      Thêm sản phẩm
    </Link>
  ) : (
    <Link href="/" className={ui.btnSecondary}>
      <ShoppingBag className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {guestLabel}
    </Link>
  );
}

/** Gian hàng chưa có sản phẩm nào khách xem được: chủ được nhắc thêm sản phẩm, khách được chỉ đường sang sản phẩm khác. */
export function StorefrontEmpty({ referralCode }: { referralCode?: string | null }) {
  const owner = useIsStorefrontOwner(referralCode);
  const title = 'Gian hàng chưa có sản phẩm nào để xem';
  return (
    <section aria-label={title} className="mt-8 rounded-card border border-stone-200 bg-stone-0 p-8 text-center shadow-card">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-forest-50 text-forest-600">
        <Leaf className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-3 font-display text-base font-semibold text-stone-900">{title}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">
        {owner
          ? 'Gian hàng của bạn chưa có sản phẩm nào khách xem được. Thêm sản phẩm để khách có gì mà mua.'
          : 'Chủ gian hàng đang bổ sung sản phẩm. Bạn xem thử các sản phẩm đang bán trên Tubu Tree nhé.'}
      </p>
      <div className="mt-4">
        <StorefrontAction referralCode={referralCode} guestLabel="Xem sản phẩm trên Tubu Tree" />
      </div>
    </section>
  );
}
