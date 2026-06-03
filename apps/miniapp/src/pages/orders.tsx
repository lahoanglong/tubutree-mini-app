import { useState } from 'react';
import { Box, Page, Text, Header, Spinner, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchOrders } from '../services/shop-api';
import { formatVnd, ORDER_STATUS_LABEL } from '../utils/format';

const TABS = [
  { key: undefined, label: 'Tất cả' },
  { key: 'PENDING_PAYMENT', label: 'Chờ TT' },
  { key: 'SHIPPING', label: 'Đang giao' },
  { key: 'DELIVERED', label: 'Đã giao' },
  { key: 'CANCELLED', label: 'Đã hủy' },
] as const;

export default function OrdersPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<string | undefined>(undefined);
  const { data, isLoading } = useQuery({
    queryKey: ['orders', tab],
    queryFn: () => fetchOrders(tab),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Đơn hàng của tôi" showBackIcon={false} />
      <Box px={3} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
        {TABS.map((t) => (
          <Box
            key={t.label}
            onClick={() => setTab(t.key)}
            style={{
              whiteSpace: 'nowrap',
              padding: '6px 14px',
              borderRadius: 'var(--radius-full)',
              fontSize: 13,
              background: tab === t.key ? 'var(--green-600)' : 'var(--neutral-100)',
              color: tab === t.key ? 'white' : 'var(--neutral-600)',
            }}
          >
            {t.label}
          </Box>
        ))}
      </Box>

      {isLoading ? (
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      ) : (
        <Box p={3} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data?.data.length === 0 && (
            <Text size="small" style={{ color: 'var(--neutral-400)', textAlign: 'center', marginTop: 24 }}>
              Chưa có đơn hàng nào.
            </Text>
          )}
          {data?.data.map((o) => (
            <Box
              key={o.id}
              onClick={() => navigate(`/order/${o.code}`)}
              p={3}
              style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}
            >
              <Box flex justifyContent="space-between">
                <Text size="small" bold>
                  {o.code}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--green-700)' }}>
                  {ORDER_STATUS_LABEL[o.status] ?? o.status}
                </Text>
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
                {o.items.length} sản phẩm
              </Text>
              <Text bold style={{ color: 'var(--clay-700)', marginTop: 4 }}>
                {formatVnd(o.total)}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Page>
  );
}
