import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, TrendingUp } from 'lucide-react';
import { BUILDER_COPY } from '@tubutree/app-core/commerce/storefront-builder';
import { getStorefrontStats } from '../../services/storefront-api';
import { formatVnd } from '../../utils/format';
import { vi } from '../../i18n/vi';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { Heading, Text } from '../ui/text';
import { CARD_MARGIN } from './shared';

function StatBox({ value, label, tone }: { value: string; label: string; tone?: 'brand' }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)', padding: 10, textAlign: 'center' }}>
      <Text variant="body-md" tone={tone} as="div" style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{value}</Text>
      <Text variant="caption" tone="tertiary" as="div">{label}</Text>
    </div>
  );
}

function StatLine({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
      <Text variant="body-sm" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Text>
      <Text variant="caption" tone="tertiary" style={{ whiteSpace: 'nowrap', marginLeft: 8 }}>{value}</Text>
    </div>
  );
}

/**
 * Thống kê 30 ngày ở đầu màn dựng khi gian hàng đã có khách thấy: ba ô số, còn bảng theo sản phẩm gập lại sau nút "Theo sản phẩm".
 * Chỉ gắn vào cây khi LIVE nên gian hàng nháp không gọi API thống kê.
 */
export function StatsSection() {
  const statsQ = useQuery({ queryKey: ['storefront-stats'], queryFn: getStorefrontStats });
  const [open, setOpen] = useState(false);
  const data = statsQ.data;
  if (!data) return null;
  // Các dòng dưới cộng đúng ô Doanh thu: top 5 sản phẩm, phần còn lại gộp một dòng, phần cấp đơn (ship, giảm giá, chênh lệch
  // giữa tiền hoàn thực tế và phần trừ theo tỷ lệ dòng) một dòng.
  const lines = data.byProduct.filter((p) => p.qty > 0);
  const rest = lines.slice(5);
  const orderLevel = data.shippingAndOrderDiscount30d ?? 0;
  const hasLines = lines.length > 0 || orderLevel !== 0;

  return (
    <Card padding={16} style={CARD_MARGIN}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon icon={TrendingUp} size="md" tone="brand" />
        <Heading variant="title-sm" as="h2">{BUILDER_COPY.stats30}</Heading>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <StatBox value={String(data.orders30d)} label="Đơn 30 ngày" />
        <StatBox value={formatVnd(data.revenue30d)} label="Doanh thu" />
        <StatBox value={formatVnd(data.commission30d)} label="Hoa hồng" tone="brand" />
      </div>
      {!hasLines ? (
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 12 }}>Chưa có đơn nào qua gian hàng — chia sẻ link để bắt đầu bán nhé.</Text>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            className="tubu-press"
            onClick={() => setOpen((v) => !v)}
            style={{
              width: '100%', minHeight: 44, marginTop: 4, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'var(--color-text-brand)',
            }}
          >
            <Text variant="body-sm" tone="brand">{BUILDER_COPY.statsByProduct}</Text>
            <Icon icon={ChevronDown} size="sm" tone="brand" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms ease-out' }} />
          </button>
          {open && (
            <div>
              {lines.slice(0, 5).map((p) => (
                <StatLine key={p.productSlug || p.productName} name={p.productName} value={`${p.qty} món · ${formatVnd(p.revenue)}`} />
              ))}
              {rest.length > 0 && (
                <StatLine
                  name={vi.storefront.statsOtherProducts(rest.length)}
                  value={`${rest.reduce((t, p) => t + p.qty, 0)} món · ${formatVnd(rest.reduce((t, p) => t + p.revenue, 0))}`}
                />
              )}
              {orderLevel !== 0 && <StatLine name={vi.storefront.statsOrderLevel} value={formatVnd(orderLevel)} />}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
