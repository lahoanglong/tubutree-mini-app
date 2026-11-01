import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addonLines, addonRows, addonSummary, comboView, PDP_COMBO_MAX, type AddonRow } from '@tubutree/app-core/commerce/bundle-view';
import { vnd } from '@tubutree/app-core/commerce/money';
import { bundleKeys } from '@tubutree/app-core/queries/bundle';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { getProductBundles } from '../../services/bundle-api';
import { haptic } from '../../utils/haptic';
import { serverNow } from '../../utils/server-clock';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ComboCard } from '../ui/combo-card';
import { Checkbox } from '../ui/form';
import { PriceTag } from '../ui/price-tag';
import { ProductThumb } from '../ui/product-thumb';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { SectionTitle } from '../ui/section-title';
import { Text } from '../ui/text';
import { PdpBundleSlots } from './pdp-bundle-slots';
import { useBundleAdd } from './use-bundle-add';

const ADDED_FLASH_MS = 1_200;
const SURFACE = { background: 'var(--color-bg-surface)', padding: 16 } as const;

function AddonRowView({ row, on, onToggle }: { row: AddonRow; on: boolean; onToggle: () => void }) {
  return (
    <div
      role="checkbox"
      aria-checked={on}
      aria-label={fillCopy('addon.pickSpoken', { name: row.name, price: vnd(row.addonPrice), pct: row.savingPct })}
      data-testid="addon-row"
      {...rowKeyboardProps()}
      className="tubu-press"
      onClick={() => {
        haptic('light');
        onToggle();
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: '8px 0', boxSizing: 'border-box' }}
    >
      <Checkbox checked={on} onChange={() => {}} />
      <ProductThumb src={row.thumbnail} alt="" size={48} />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text variant="body-sm" as="span" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {row.name}
        </Text>
        <PriceTag value={row.addonPrice} compareAt={row.listPrice} size="md" tone="deal" />
      </div>
      <span style={{ flex: '0 0 auto' }}>
        <Badge tone="promo" size="sm">{`-${row.savingPct}%`}</Badge>
      </span>
    </div>
  );
}

/**
 * "Combo ưu đãi" (≤2 `ComboCard`) và "Mua kèm deal sốc" (≤3 dòng tích chọn) của trang sản phẩm. Ẩn hẳn, không giữ chỗ, khi chưa có bộ nào
 * hoặc API lỗi: khối nằm dưới màn đầu và chỉ hiện khi đã có dữ liệu nên không đẩy nội dung đang xem. Giá cuối luôn do giỏ tính lại; ở đây chỉ
 * là lời mời. Mua kèm chỉ thêm các món đã chọn (không gồm món chính, khách tự mua bằng nút của trang) và giá kèm chỉ áp khi món chính có trong giỏ.
 */
export function PdpBundles({ slug, productName }: { slug: string; productName?: string }) {
  const { add, busyId } = useBundleAdd();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [justAdded, setJustAdded] = useState(false);
  const query = useQuery({ queryKey: bundleKeys.product(slug), queryFn: () => getProductBundles(slug), staleTime: 30_000, retry: false });

  const addCombo = (id: string, lines: { variationId: string; quantity: number }[]) =>
    add({ id, lines, errorKey: 'shop.comboError', successText: fillCopy('shop.comboAdded') });
  const addAddons = (lines: { variationId: string; quantity: number }[]) =>
    add({
      id: 'addons',
      lines,
      errorKey: 'addon.error',
      onDone: () => {
        setPicked(new Set());
        setJustAdded(true);
        setTimeout(() => setJustAdded(false), ADDED_FLASH_MS);
      },
    });

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

  return (
    <PdpBundleSlots
      combos={
        combos.length > 0 ? (
          <section aria-label={fillCopy('combo.pdpTitle')} data-testid="pdp-combos" style={SURFACE}>
            <SectionTitle>{fillCopy('combo.pdpTitle')}</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              {combos.map((v) => (
                <ComboCard
                  key={v.id}
                  title={v.title}
                  items={v.items}
                  pct={v.pct}
                  total={v.total}
                  comboTotal={v.comboTotal}
                  busy={busyId === v.id}
                  onAddAll={() => addCombo(v.id, v.lines)}
                />
              ))}
            </div>
          </section>
        ) : undefined
      }
      addons={
        rows.length > 0 ? (
          <section aria-label={fillCopy('addon.title')} data-testid="pdp-addons" style={SURFACE}>
            <SectionTitle>{fillCopy('addon.title')}</SectionTitle>
            {productName && (
              <Text variant="caption" tone="tertiary" as="p" style={{ margin: '2px 0 0' }}>
                {fillCopy('addon.condition', { name: productName })}
              </Text>
            )}
            <div role="group" aria-label={fillCopy('addon.title')} style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
              {rows.map((r) => (
                <AddonRowView key={r.key} row={r} on={picked.has(r.key)} onToggle={() => toggle(r.key)} />
              ))}
            </div>
            {summary.count > 0 && (
              <div data-testid="addon-save" style={{ margin: '4px 0 8px', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', fontWeight: 600, color: 'var(--color-text-price-deal)', fontVariantNumeric: 'tabular-nums' }}>
                {fillCopy('combo.save', { save: vnd(summary.save) })}
              </div>
            )}
            <div style={{ marginTop: summary.count > 0 ? 0 : 8 }}>
              <Button
                fullWidth
                variant={justAdded ? 'secondary' : 'primary'}
                loading={busyId === 'addons'}
                disabled={summary.count === 0 && !justAdded}
                onPress={() => addAddons(addonLines(rows, picked))}
              >
                {justAdded ? fillCopy('addon.added') : summary.count > 0 ? fillCopy('addon.add', { n: summary.count }) : fillCopy('addon.pickHint')}
              </Button>
            </div>
          </section>
        ) : undefined
      }
    />
  );
}
