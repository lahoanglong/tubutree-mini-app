import { useState } from 'react';
import { Box, Page, Text, Header, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchOrders } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { formatVnd } from '../utils/format';
import { STATUS_COLOR } from '../utils/order-status';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

// Tab theo nhóm trạng thái spec §6.4. CONFIRMED ("Chờ xác nhận") quan trọng nhất với đơn COD —
// trước đây bị thiếu khiến đơn COD chỉ hiện ở "Tất cả".
const TABS = [
  { key: undefined, label: vi.orders.tabAll },
  { key: 'CONFIRMED', label: vi.orderStatus.CONFIRMED! },
  { key: 'SHIPPING', label: vi.orderStatus.SHIPPING! },
  { key: 'DELIVERED', label: vi.orderStatus.DELIVERED! },
  { key: 'CANCELLED', label: vi.orderStatus.CANCELLED! },
] as const;

export default function OrdersPage() {
  const navigate = useNavigate();
  const { status: authStatus, login } = useAuthStore();
  const [tab, setTab] = useState<string | undefined>(undefined);

  const orders = useQuery({
    queryKey: ['orders', tab],
    queryFn: () => fetchOrders(tab),
    enabled: authStatus === 'authenticated',
  });

  const list = orders.data?.data ?? [];

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 72 }}>
      <Header title={vi.orders.title} showBackIcon={false} />

      <Box px={3} pb={2} style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Box
              key={t.label}
              role="tab"
              aria-selected={active}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                setTab(t.key);
              }}
              style={{
                whiteSpace: 'nowrap',
                padding: '10px 14px',
                borderRadius: 'var(--radius-full)',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                background: active ? 'var(--primary-600)' : 'var(--neutral-0)',
                border: `1px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
                color: active ? 'white' : 'var(--neutral-600)',
                minHeight: 40,
                boxSizing: 'border-box',
                flex: '0 0 auto',
              }}
            >
              {t.label}
            </Box>
          );
        })}
      </Box>

      {authStatus !== 'authenticated' && authStatus !== 'loading' ? (
        <EmptyState
          art="box"
          heading={vi.orders.emptyHeading}
          body={vi.auth.loginHint}
          ctaLabel={vi.auth.loginCta}
          onCta={() => void login()}
        />
      ) : orders.isLoading || authStatus === 'loading' ? (
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
        <Box p={3} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((o) => {
            const color = STATUS_COLOR[o.status] ?? STATUS_COLOR.CONFIRMED!;
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
                  background: 'var(--neutral-0)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-xs)',
                }}
              >
                <Box flex justifyContent="space-between" alignItems="center">
                  <Text size="small" bold style={{ letterSpacing: 0.4 }}>
                    {o.code}
                  </Text>
                  <Text
                    size="xSmall"
                    bold
                    style={{
                      background: color.bg,
                      color: color.fg,
                      padding: '3px 10px',
                      borderRadius: 'var(--radius-full)',
                    }}
                  >
                    {vi.orderStatus[o.status] ?? o.status}
                  </Text>
                </Box>
                {firstItem && (
                  <Text
                    size="xSmall"
                    style={{
                      color: 'var(--neutral-600)',
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
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                    {vi.orders.itemCount(o.items.length)} ·{' '}
                    {new Date(o.createdAt).toLocaleDateString('vi-VN')}
                  </Text>
                  <Text bold style={{ color: 'var(--primary-700)' }}>
                    {formatVnd(o.total)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Page>
  );
}
