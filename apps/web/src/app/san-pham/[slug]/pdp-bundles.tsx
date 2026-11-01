'use client';

// Nguồn: apps/miniapp/src/components/product/pdp-bundles.tsx
import { useEffect, useRef, useState } from 'react';
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
import { coreHttp } from '@/lib/core-http';
import { useBundleAdd, type BundleAddResult } from '@/lib/use-bundle-add';
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
        <input
          type="checkbox"
          aria-label={fillCopy('addon.pickSpoken', { name: row.name, price: vnd(row.addonPrice), pct: row.savingPct })}
          checked={on}
          onChange={onToggle}
          className="h-6 w-6 accent-forest-600"
        />
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
 * "Combo ưu đãi" (≤2 `ComboCard`) và "Mua kèm deal sốc" (≤3 dòng tích chọn) của trang sản phẩm, cùng dữ liệu và cùng quy tắc với Mini App.
 * Danh sách đầu do server dựng sẵn (`initialBundles`) nên khối nằm trong HTML ngay lần vẽ đầu, không chèn thêm vào trang sau khi tải; server
 * lỗi thì trình duyệt tự tải. Ẩn hẳn, không giữ chỗ, khi chưa có bộ nào, đã hết hạn theo giờ máy chủ hay tải lỗi. Giá cuối luôn do giỏ tính lại.
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

  const now = serverNow();
  const combos = (query.data?.combos ?? []).flatMap((b) => comboView(b, now) ?? []).slice(0, PDP_COMBO_MAX);
  const rows = addonRows(query.data?.addons ?? [], now);
  if (combos.length === 0 && rows.length === 0) return null;

  const summary = addonSummary(rows, picked);
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
          <section aria-label={fillCopy('combo.pdpTitle')} data-testid="pdp-combos" className={SURFACE}>
            <h2 className={pdpSectionTitle}>{fillCopy('combo.pdpTitle')}</h2>
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
                  onAddAll={() => add({ id: v.id, lines: v.lines, errorKey: 'shop.comboError', successText: fillCopy('shop.comboAdded') })}
                />
              ))}
            </div>
            <Status result={result && result.id !== 'addons' ? result : null} />
          </section>
        ) : undefined
      }
      addons={
        rows.length > 0 ? (
          <section aria-label={fillCopy('addon.title')} data-testid="pdp-addons" className={SURFACE}>
            <h2 className={pdpSectionTitle}>{fillCopy('addon.title')}</h2>
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
                disabled={summary.count === 0 && !justAdded}
                onPress={addAddons}
              >
                {justAdded ? fillCopy('addon.added') : summary.count > 0 ? fillCopy('addon.add', { n: summary.count }) : fillCopy('addon.pickHint')}
              </Button>
            </div>
            <Status result={result?.id === 'addons' ? result : null} quiet />
          </section>
        ) : undefined
      }
    />
  );
}
