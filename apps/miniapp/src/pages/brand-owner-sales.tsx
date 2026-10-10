import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, ShoppingBag, Wallet } from 'lucide-react';
import { getOwnedBrandSales, type BrandSalesPeriod } from '../services/brand-owner-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { StatTile } from '../components/ui/tiles';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Heading, Text } from '../components/ui/text';

const PERIODS: { key: BrandSalesPeriod; label: string }[] = [
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: '90d', label: '90 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: 'prev_month', label: 'Tháng trước' },
];

/** Tab chỉ-đọc "Doanh thu" của chủ nhãn (Q-18): số đơn, doanh thu, SP bán chạy theo kỳ. Máy chủ không trả thông tin khách nên màn này không có gì để lộ. */
export function BrandSalesTab() {
  const [period, setPeriod] = useState<BrandSalesPeriod>('30d');
  const q = useQuery({ queryKey: ['owned-brand-sales', period], queryFn: () => getOwnedBrandSales(period), staleTime: 30_000 });

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <SegmentedTabs scroll items={PERIODS} value={period} onChange={(k) => setPeriod(k as BrandSalesPeriod)} />

      <div style={{ marginTop: 12 }}>
        {q.isLoading ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <Skeleton height={84} radius="var(--radius-card)" />
            <Skeleton height={84} radius="var(--radius-card)" />
          </div>
        ) : q.isError || !q.data ? (
          <ErrorState variant="inline" message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.orderCount === 0 ? (
          <EmptyState
            variant="inline"
            art="box"
            heading="Chưa có đơn nào trong kỳ này"
            body="Khi khách đặt sản phẩm của nhãn, số liệu sẽ hiện ở đây."
          />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <StatTile icon={Wallet} label="Doanh thu" value={formatVnd(q.data.revenue)} />
              </div>
              <StatTile icon={ShoppingBag} label="Số đơn" value={String(q.data.orderCount)} />
              <StatTile icon={Package} label="Sản phẩm đã bán" value={String(q.data.unitsSold)} />
            </div>
            <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 8 }}>
              {q.data.delivered.orderCount} đơn đã giao · {formatVnd(q.data.delivered.revenue)}
            </Text>

            <Heading variant="title-sm" as="h2" style={{ margin: '16px 0 8px' }}>Sản phẩm bán chạy</Heading>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {q.data.topProducts.map((p, i) => (
                <li
                  key={p.productId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '8px 0',
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <Text variant="label" tone="tertiary" style={{ width: 20, textAlign: 'center' }}>{i + 1}</Text>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body-sm" as="div" style={{ overflowWrap: 'anywhere' }}>{p.name}</Text>
                    <Text variant="caption" tone="tertiary" as="div">Đã bán {p.quantity}</Text>
                  </div>
                  <Text variant="price-sm">{formatVnd(p.revenue)}</Text>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 16 }}>
        Doanh thu là giá bán sản phẩm của nhãn trong các đơn đã xác nhận (chưa trừ mã giảm giá của đơn, chưa gồm phí
        vận chuyển; không tính đơn chờ thanh toán, đã huỷ, đã trả hoặc đã hoàn tiền). Số liệu tổng hợp, không hiện
        thông tin khách.
      </Text>
    </div>
  );
}
