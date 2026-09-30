import { useState } from 'react';
import { Box, Page, Text, useNavigate } from 'zmp-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchOrders } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { formatVnd } from '../utils/format';
import { STATUS_TONE } from '../utils/order-status';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';

// Tab theo nhóm trạng thái spec §6.4. CONFIRMED ("Chờ xác nhận") quan trọng nhất với đơn COD —
// trước đây bị thiếu khiến đơn COD chỉ hiện ở "Tất cả".
const TABS = [
  { key: undefined, label: vi.orders.tabAll },
  // PENDING_PAYMENT là nhóm CẦN HÀNH ĐỘNG GẤP NHẤT (khách chưa trả tiền, đơn đang giữ hàng)
  // nhưng trước đây không có tab riêng — phải lục trong "Tất cả" mới thấy.
  { key: 'PENDING_PAYMENT', label: vi.orderStatus.PENDING_PAYMENT! },
  { key: 'CONFIRMED', label: vi.orderStatus.CONFIRMED! },
  { key: 'SHIPPING', label: vi.orderStatus.SHIPPING! },
  { key: 'DELIVERED', label: vi.orderStatus.DELIVERED! },
  { key: 'CANCELLED', label: vi.orderStatus.CANCELLED! },
] as const;

// Sentinel string cho tab "Tất cả" (SegmentedTabs chỉ nhận key kiểu string) — tab state nội bộ
// (truyền cho fetchOrders/queryKey) vẫn giữ nguyên kiểu `string | undefined`, chỉ đổi ở biên hiển thị.
const ALL_TAB = 'ALL';

const PAGE_LIMIT = 20;

export default function OrdersPage() {
  const navigate = useNavigate();
  const authStatus = useAuthStore((s) => s.status);
  const [tab, setTab] = useState<string | undefined>(undefined);

  // Bug 1 fix: truoc day dung useQuery goi fetchOrders() 1 lan, khong truyen page/limit nen BE
  // mac dinh page=1 limit=20 -> khach co >20 don khong bao gio xem duoc don cu hon qua app.
  // Doi sang useInfiniteQuery (cung pattern voi apps/miniapp/src/pages/browse.tsx) + nut "Xem them".
  const orders = useInfiniteQuery({
    queryKey: ['orders', tab],
    queryFn: ({ pageParam }) => fetchOrders(tab ? { status: tab } : {}, pageParam, PAGE_LIMIT),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, limit, total } = lastPage.meta;
      return page * limit < total ? page + 1 : undefined;
    },
    enabled: authStatus === 'authenticated',
  });

  const list = orders.data?.pages.flatMap((pg) => pg.data) ?? [];

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 72 }}>
      <PageHeader title="Đơn hàng" />

      <Box px={3} pb={2}>
        <SegmentedTabs
          items={TABS.map((t) => ({ key: t.key ?? ALL_TAB, label: t.label }))}
          value={tab ?? ALL_TAB}
          onChange={(key) => {
            haptic('light');
            setTab(key === ALL_TAB ? undefined : key);
          }}
          scroll
        />
      </Box>

      {orders.isLoading || authStatus === 'loading' ? (
        <Box p={3} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
          <LineItemSkeleton />
        </Box>
      ) : orders.isError ? (
        <ErrorState message={getErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          art="box"
          heading={vi.orders.emptyHeading}
          body={vi.orders.emptyBody}
          ctaLabel={vi.orders.emptyCta}
          onCta={() => navigate('/browse')}
        />
      ) : (
        <>
        <Box p={3} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((o) => {
            const firstItem = o.items[0];
            return (
              <Box
                key={o.id}
                role="button"
                aria-label={`Đơn ${o.code}`}
                className="tubu-press"
                onClick={() => navigate(`/order/${o.code}`)}
                p={3}
                style={{
                  background: 'var(--color-bg-surface)',
                  borderRadius: 'var(--radius-card)',
                  boxShadow: 'var(--elevation-1)',
                }}
              >
                <Box flex justifyContent="space-between" alignItems="center">
                  <Text size="small" bold style={{ letterSpacing: 0.4 }}>
                    {o.code}
                  </Text>
                  <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>
                    {vi.orderStatus[o.status] ?? o.status}
                  </Badge>
                </Box>
                {firstItem && (
                  <Text
                    size="xSmall"
                    style={{
                      color: 'var(--color-text-tertiary)',
                      marginTop: 6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {firstItem.productName}
                    {o.items.length > 1 ? ` +${o.items.length - 1}` : ''}
                  </Text>
                )}
                <Box flex justifyContent="space-between" alignItems="baseline" style={{ marginTop: 4 }}>
                  <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                    {vi.orders.itemCount(o.items.length)} ·{' '}
                    {new Date(o.createdAt).toLocaleDateString('vi-VN')}
                  </Text>
                  <Text bold style={{ color: 'var(--color-text-brand)' }}>
                    {formatVnd(o.total)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
        {orders.hasNextPage && (
          <Box flex justifyContent="center" pb={4}>
            <Button
              variant="secondary"
              loading={orders.isFetchingNextPage}
              onPress={() => void orders.fetchNextPage()}
              style={{ minWidth: 160 }}
            >
              Xem thêm
            </Button>
          </Box>
        )}
        </>
      )}
    </Page>
  );
}
