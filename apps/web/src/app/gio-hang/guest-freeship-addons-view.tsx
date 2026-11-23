'use client';

import { useEffect, useState } from 'react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { FreeshipAddonRail, type FreeshipAddonItem } from '@/components/mini';
import { GUEST_CART_MAX_LINES, addGuestLine } from '@/lib/guest-cart/store';
import { FreeshipAddonsPending } from './freeship-addons';
import { pickFreeshipAddonItems } from './freeship-addons-pick';
import type { FreeshipAddonsViewProps } from './freeship-addons-view';

/**
 * Dải mua thêm của giỏ khách chưa đăng nhập (chunk tải sau): cùng nguồn món (`GET /upsell/freeship` công khai, hay kệ Bán chạy nhất) và cùng luật chọn
 * với giỏ tài khoản, "+ Thêm" ghi thẳng vào giỏ khách trong máy (`addGuestLine`, đồng bộ nên không có trạng thái bận). Món vừa thêm rời dải vì đã có trong giỏ,
 * thanh Miễn phí giao hàng đổi theo ngay khi giá dòng mới về. Giỏ khách đầy hay món đã tới trần thì báo bằng đúng câu của nút "Thêm vào giỏ".
 */
export function GuestFreeshipAddonsView({ goal, lines, exclude, onShownChange, source, pricing }: FreeshipAddonsViewProps) {
  const [error, setError] = useState<string | null>(null);
  const picked = pickFreeshipAddonItems({ goal, lines, exclude }, source, pricing);
  const railGone = picked.length === 0;
  const shown = !railGone ? true : source.pending ? null : false;
  useEffect(() => {
    if (!railGone) setError(null);
  }, [railGone]);
  useEffect(() => {
    if (!onShownChange) return undefined;
    onShownChange(shown);
    return () => onShownChange(false);
  }, [shown, onShownChange]);

  const add = (item: FreeshipAddonItem) => {
    const res = addGuestLine({ variationId: item.variationId, slug: item.slug, quantity: 1 });
    setError(res.ok ? null : res.reason === 'full' ? fillCopy('guestCart.full', { n: GUEST_CART_MAX_LINES }) : fillCopy('guestCart.atMax'));
  };

  if (railGone && !error) return source.pending ? <FreeshipAddonsPending title={goal.headline} /> : null;
  return (
    <>
      <FreeshipAddonRail title={goal.headline} stage={goal.stage} items={picked} onAdd={add} />
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger-fg">
          {error}
        </p>
      )}
    </>
  );
}
