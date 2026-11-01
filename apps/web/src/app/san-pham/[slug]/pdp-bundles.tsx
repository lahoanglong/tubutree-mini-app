'use client';

// Nguồn: apps/miniapp/src/components/product/pdp-bundles.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProductBundles } from '@tubutree/app-core/api/bundle';
import { addonLines, addonRows, addonSummary, comboView, PDP_COMBO_MAX, type AddonRow } from '@tubutree/app-core/commerce/bundle-view';
import { vnd } from '@tubutree/app-core/commerce/money';
import { productBundlesQuery } from '@tubutree/app-core/queries/bundle';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from '@/components/mini/badge';
import { Button } from '@/components/mini/button';
import { ComboCard } from '@/components/mini/combo-card';
import { PriceTag } from '@/components/mini/price-tag';
import { ProductThumb } from '@/components/mini/product-thumb';
import { CheckMark, miniCheckbox, miniCheckboxWrap } from '@/components/order-mobile/mobile-ui';
import { coreHttp } from '@/lib/core-http';
import { useBundleAdd, type BundleAddResult } from '@/lib/use-bundle-add';
import { useHydrated } from '@/lib/use-hydrated';
import { PdpBundleSlots } from './pdp-bundle-slots';
import { pdpSectionTitle } from './pdp-sections';

const STALE_MS = 30_000;
const ADDED_FLASH_MS = 1_200;
/** Cột thông tin của trang đã đệm 16px hai bên: khối không tự đệm thêm (Mini App đệm trong khối trắng tràn mép nên chữ vẫn thẳng hàng 16px). */
const SURFACE = 'py-2';

function AddonRowView({ row, on, onToggle }: { row: AddonRow; on: boolean; onToggle: () => void }) {
  return (
    <label data-testid="addon-row" className="flex min-h-16 cursor-pointer items-center gap-3 py-2">
      <span className="flex h-11 w-11 flex-none items-center">
        <span className={miniCheckboxWrap}>
          <input
            type="checkbox"
            aria-label={fillCopy('addon.pickSpoken', { name: row.name, price: vnd(row.addonPrice), pct: row.savingPct })}
            checked={on}
            onChange={onToggle}
            className={miniCheckbox}
          />
          <CheckMark />
        </span>
      </span>
      <ProductThumb src={row.thumbnail} alt="" size={48} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm text-stone-900">{row.name}</span>
        <PriceTag value={row.addonPrice} compareAt={row.listPrice} size="md" tone="deal" />
      </span>
      <span className="flex-none">
        <Badge tone="promo" size="sm">{`-${row.savingPct}%`}</Badge>
      </span>
    </label>
  );
}

/** Vùng thông báo luôn có mặt trong trang (đọc được khi nội dung đổi). Thành công của "Mua kèm" chỉ đọc cho trình đọc màn hình: nút đã đổi nhãn "Đã thêm vào giỏ". */
function Status({ result, quiet }: { result: BundleAddResult | null; quiet?: boolean }) {
  const tone = result?.ok ? 'text-success-fg' : 'text-danger-fg';
  return (
    <div role="status" className={result && !(quiet && result.ok) ? 'mt-2 text-sm' : 'sr-only'}>
      {result && <p className={tone}>{result.text}</p>}
    </div>
  );
}

/**
 * Danh sách cuối cùng đã hiện: khi dữ liệu sau đó rỗng (bộ hết hạn hay tắt) vẫn trả lại danh sách đó với `ended`, để khối không bị gỡ giữa
 * trang. Chưa từng hiện (ẩn từ đầu) thì rỗng và không `ended`.
 */
function useLatched<T>(live: T[]): { items: T[]; ended: boolean } {
  const last = useRef<T[] | null>(null);
  if (live.length > 0) last.current = live;
  const ended = live.length === 0 && last.current !== null;
  return { items: ended ? (last.current as T[]) : live, ended };
}

/** Khối đã kết thúc vẫn giữ nguyên chỗ (không đẩy phần dưới), mờ đi và không bấm được. */
function EndedBody({ ended, children }: { ended: boolean; children: ReactNode }) {
  if (!ended) return <>{children}</>;
  return (
    <div inert aria-hidden="true" data-testid="bundle-ended" className="opacity-60">
      {children}
    </div>
  );
}

/**
 * "Combo ưu đãi" (≤2 `ComboCard`) và "Mua kèm deal sốc" (≤3 dòng tích chọn) của trang sản phẩm, cùng dữ liệu và cùng quy tắc với Mini App.
 * Danh sách đầu do server dựng sẵn (`initialBundles`) nên khối nằm trong HTML ngay lần vẽ đầu, không chèn thêm vào trang sau khi tải; server
 * lỗi thì trình duyệt tự tải. Ẩn hẳn, không giữ chỗ, khi chưa có bộ nào, đã hết hạn theo giờ máy chủ hay tải lỗi. Giá cuối luôn do giỏ tính lại.
 * Khối đã hiện rồi mà bộ hết hạn/tắt (trang ISR cũ, tải lại ra rỗng) thì KHÔNG gỡ: gỡ giữa trang đẩy mọi thứ bên dưới đang nằm trong màn hình
 * (CLS). Khối giữ nguyên chỗ, mờ đi, không bấm được, tiêu đề ghi "Đã kết thúc"; bộ khác về sau thì hiện lại bình thường.
 */
export function PdpBundles({
  slug,
  productName,
  initialBundles,
  initialFetchedAt,
}: {
  slug: string;
  productName?: string;
  initialBundles?: ProductBundles;
  /** Lúc server lấy `initialBundles` (ms): trang ISR sống tới 5 phút, quá `STALE_MS` thì trình duyệt tải lại ngay sau khi hiển thị, bộ vừa tắt không treo ở trang. */
  initialFetchedAt?: number;
}) {
  const { add, busyId, result } = useBundleAdd();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [justAdded, setJustAdded] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const query = useQuery({ ...productBundlesQuery(coreHttp, slug), initialData: initialBundles, initialDataUpdatedAt: initialFetchedAt, staleTime: STALE_MS, retry: 0 });

  // Trang ISR có thể cũ hàng giờ: trước khi hydrate vẽ đúng như máy chủ đã vẽ (giờ lúc lấy dữ liệu, mọi bộ còn hạn), nếu không lần vẽ đầu
  // của trình duyệt lệch HTML ("Hydration failed") và khối biến mất. Sau hydrate mới lọc theo giờ đã đồng bộ với máy chủ.
  const hydrated = useHydrated();
  const now = hydrated ? serverNow() : (initialFetchedAt ?? serverNow());
  const liveCombos = (query.data?.combos ?? []).flatMap((b) => comboView(b, now) ?? []).slice(0, PDP_COMBO_MAX);
  const liveRows = addonRows(query.data?.addons ?? [], now);
  const comboSide = useLatched(liveCombos);
  const addonSide = useLatched(liveRows);
  if (comboSide.items.length === 0 && addonSide.items.length === 0) return null;
  const { items: combos, ended: combosEnded } = comboSide;
  const { items: rows, ended: addonsEnded } = addonSide;

  const summary = addonSummary(rows, picked);
  const title = (key: 'combo.pdpTitle' | 'addon.title', ended: boolean) => (ended ? `${fillCopy(key)} · ${fillCopy('bundle.ended')}` : fillCopy(key));
  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const addAddons = () =>
    add({
      id: 'addons',
      lines: addonLines(rows, picked),
      errorKey: 'addon.error',
      successText: fillCopy('addon.added'),
      onDone: () => {
        setPicked(new Set());
        setJustAdded(true);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setJustAdded(false), ADDED_FLASH_MS);
      },
    });

  return (
    <PdpBundleSlots
      combos={
        combos.length > 0 ? (
          <section aria-label={title('combo.pdpTitle', combosEnded)} data-testid="pdp-combos" className={SURFACE}>
            <h2 className={pdpSectionTitle}>{title('combo.pdpTitle', combosEnded)}</h2>
            <EndedBody ended={combosEnded}>
              <div className="mt-3 flex flex-col gap-3">
                {combos.map((v) => (
                  <ComboCard
                    key={v.id}
                    title={v.title}
                    items={v.items}
                    pct={v.pct}
                    total={v.total}
                    comboTotal={v.comboTotal}
                    busy={busyId === v.id}
                    onAddAll={() => {
                      if (!combosEnded) add({ id: v.id, lines: v.lines, errorKey: 'shop.comboError', successText: fillCopy('shop.comboAdded') });
                    }}
                  />
                ))}
              </div>
            </EndedBody>
            <Status result={result && result.id !== 'addons' ? result : null} />
          </section>
        ) : undefined
      }
      addons={
        rows.length > 0 ? (
          <section aria-label={title('addon.title', addonsEnded)} data-testid="pdp-addons" className={SURFACE}>
            <h2 className={pdpSectionTitle}>{title('addon.title', addonsEnded)}</h2>
            <EndedBody ended={addonsEnded}>
              {productName && <p className="mt-0.5 text-xs text-stone-500">{fillCopy('addon.condition', { name: productName })}</p>}
              <div role="group" aria-label={fillCopy('addon.title')} className="mt-1 flex flex-col">
                {rows.map((r) => (
                  <AddonRowView key={r.key} row={r} on={picked.has(r.key)} onToggle={() => toggle(r.key)} />
                ))}
              </div>
              {summary.count > 0 && (
                <div data-testid="addon-save" className="mb-2 mt-1 text-xs font-semibold tabular-nums text-[var(--color-text-price-deal)]">
                  {fillCopy('combo.save', { save: vnd(summary.save) })}
                </div>
              )}
              <div className={summary.count > 0 ? '' : 'mt-2'}>
                <Button
                  fullWidth
                  variant={justAdded ? 'secondary' : 'primary'}
                  loading={busyId === 'addons'}
                  disabled={addonsEnded || (summary.count === 0 && !justAdded)}
                  onPress={addAddons}
                >
                  {justAdded ? fillCopy('addon.added') : summary.count > 0 ? fillCopy('addon.add', { n: summary.count }) : fillCopy('addon.pickHint')}
                </Button>
              </div>
            </EndedBody>
            <Status result={result?.id === 'addons' ? result : null} quiet />
          </section>
        ) : undefined
      }
    />
  );
}
