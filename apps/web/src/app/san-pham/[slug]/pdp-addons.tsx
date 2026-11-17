'use client';

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProductCard as CoreProductCard } from '@tubutree/app-core/api/catalog';
import { pdpAddOnSource, type PdpAddOnSource } from '@tubutree/app-core/commerce/pdp-info';
import { pdpShelves } from '@tubutree/app-core/commerce/pdp-view';
import { boughtTogetherQuery } from '@tubutree/app-core/queries/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '@/lib/core-http';
import { PdpFbt } from './pdp-fbt';
import { Rail } from './pdp-feed';
import { pdpBand } from './pdp-sections';
import { useFbt, type FbtHostArgs } from './use-fbt';

const FIVE_MIN = 5 * 60_000;

export interface PdpAddOnState {
  /** Nguồn của khối mua kèm, chốt một lần (xem `PdpAddOnScope`); null = trang không có khối mua kèm. */
  source: PdpAddOnSource;
  /** Bộ "Gợi ý mua kèm hợp vị" hiện có (đổi theo phân loại đang chọn, giỏ): nguồn là `fbt` mà bộ rỗng thì khối không vẽ. */
  hasFbt: boolean;
  /** Hai món bổ trợ của bộ: các dải cuối trang không lặp lại chúng. */
  claimed: ReadonlySet<string>;
  /** Dải "Khách thường mua cùng" đã qua trần/sàn của kệ (`pdpShelves`). */
  bought: CoreProductCard[];
}

const AddOnContext = createContext<PdpAddOnState | null>(null);

/** Nguồn khối mua kèm của trang (null khi không nằm trong `PdpAddOnScope`, vd. dải gợi ý dựng riêng trong test). */
export function usePdpAddOnState(): PdpAddOnState | null {
  return useContext(AddOnContext);
}

/**
 * Chọn MỘT nguồn cho khối mua kèm của trang (`pdpAddOnSource`): combo/mua kèm giá tốt thật > "Gợi ý mua kèm hợp vị" > dải "Khách thường mua cùng".
 * `hasBundles` do máy chủ tính từ đúng dữ liệu và đúng hàm vẽ của `PdpBundles`; hai nguồn sau tính ở đây từ dải mua cùng (danh sách đầu do máy chủ dựng).
 * Combo thật chốt ngay lúc dựng ở máy chủ. Không có combo thì chốt khi đã biết giỏ (bộ gợi ý bỏ món đã có trong giỏ) và dải mua cùng đã về, như Mini App;
 * chưa có nguồn nào thì chưa chốt (chưa có khối để nhảy), dữ liệu về muộn vẫn hiện được. Đã chốt thì giữ nguyên: giỏ hay tồn kho về sau làm bộ gợi ý
 * đổi món hay mất đi thì khối không nhảy sang nguồn khác giữa trang. Bọc cả trang để dải cuối trang (`PdpRails`) đọc cùng nguồn mà bỏ món trùng.
 */
export function PdpAddOnScope({ hasBundles, children, ...host }: FbtHostArgs & { hasBundles: boolean; children: ReactNode }) {
  const { bundle, claimed, cartSettled } = useFbt(host);
  const together = useQuery({ ...boughtTogetherQuery(coreHttp, host.slug), initialData: host.initialBoughtTogether, staleTime: FIVE_MIN, retry: 0 });
  const bought = pdpShelves({ currentId: host.productId, boughtTogether: together.data ?? [], brand: [], feed: [], claimed }).boughtTogether;
  const latched = useRef<{ slug: string; source: PdpAddOnSource } | null>(null);
  if (latched.current && latched.current.slug !== host.slug) latched.current = null;
  if (!latched.current && (hasBundles || (cartSettled && !together.isPending))) {
    const source = pdpAddOnSource({ bundles: hasBundles, fbt: bundle !== null, bought: bought.length > 0 });
    if (source) latched.current = { slug: host.slug, source };
  }
  const value: PdpAddOnState = { source: latched.current?.source ?? null, hasFbt: bundle !== null, claimed, bought };
  return <AddOnContext.Provider value={value}>{children}</AddOnContext.Provider>;
}

/**
 * Khối mua kèm duy nhất (`data-pdp-block="addons"`) theo nguồn đã chốt: `bundles` là khối Combo/Mua kèm giá tốt do trang dựng sẵn, hoặc "Gợi ý mua kèm hợp vị",
 * hoặc dải "Khách thường mua cùng". Không có gì để vẽ thì không có khối.
 */
export function PdpAddOns({ bundles, fbt }: { bundles: ReactNode; fbt: FbtHostArgs }) {
  const state = usePdpAddOnState();
  if (!state?.source) return null;
  if (state.source === 'bundles') return <div data-pdp-block="addons">{bundles}</div>;
  if (state.source === 'fbt') {
    // Điện thoại: khối tự là dải trắng (`.tubu-fbt`). Từ md `.tubu-fbt` bỏ đệm ngang và kẻ viền trên vì được thiết kế cho chỗ cũ trong thẻ trắng của cột thông tin;
    // ở phần dưới trang khối đứng riêng nên bọc thẻ trắng có đệm, bỏ viền và lề trên của nó.
    return state.hasFbt ? (
      <div data-pdp-block="addons" className="md:mt-8 md:rounded-card md:bg-[var(--color-bg-surface)] md:px-6 md:[&_.tubu-fbt]:mt-0 md:[&_.tubu-fbt]:border-t-0">
        <PdpFbt {...fbt} />
      </div>
    ) : null;
  }
  return state.bought.length > 0 ? (
    <div data-pdp-block="addons" className={pdpBand}>
      <Rail title={fillCopy('pdp.boughtTogether')} icon products={state.bought} loading={false} shelf="pdpTogether" flush />
    </div>
  ) : null;
}
