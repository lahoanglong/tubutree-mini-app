import { Box, Page, Text, Button, Header, Spinner, useParams, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOrder, cancelOrder } from '../services/shop-api';
import { formatVnd, ORDER_STATUS_LABEL } from '../utils/format';

export default function OrderDetailPage() {
  const { code } = useParams<{ code: string }>();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', code],
    queryFn: () => fetchOrder(code!),
    enabled: !!code,
  });

  const cancel = useMutation({
    mutationFn: () => cancelOrder(code!),
    onSuccess: (o) => {
      queryClient.setQueryData(['order', code], o);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      openSnackbar({ text: 'Đã hủy đơn', type: 'success' });
    },
    onError: (e: unknown) =>
      openSnackbar({ text: e instanceof Error ? e.message : 'Không thể hủy', type: 'error' }),
  });

  if (isLoading || !order) {
    return (
      <Page>
        <Header title="Chi tiết đơn" />
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  const canCancel = order.status === 'PENDING_PAYMENT' || order.status === 'CONFIRMED';

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 90 }}>
      <Header title={order.code} />

      <Box p={4} style={{ background: 'var(--green-600)', color: 'white' }}>
        <Text size="small" style={{ color: 'var(--green-100)' }}>
          Trạng thái
        </Text>
        <Text.Title size="small" style={{ color: 'white' }}>
          {ORDER_STATUS_LABEL[order.status] ?? order.status}
        </Text.Title>
      </Box>

      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          Sản phẩm
        </Text>
        {order.items.map((it) => (
          <Box key={it.id} flex justifyContent="space-between" style={{ padding: '4px 0' }}>
            <Text size="small">
              {it.productName} · {it.variationName} ×{it.quantity}
            </Text>
            <Text size="small">{formatVnd(it.total)}</Text>
          </Box>
        ))}
      </Box>

      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Row label="Tạm tính" value={formatVnd(order.subtotal)} />
        {order.discount > 0 && <Row label="Giảm giá" value={`-${formatVnd(order.discount)}`} />}
        <Row label="Phí ship" value={order.shippingFee === 0 ? 'Miễn phí' : formatVnd(order.shippingFee)} />
        <Row label="Tổng cộng" value={formatVnd(order.total)} bold />
        <Row label="Thanh toán" value={order.paymentMethod} />
      </Box>

      {canCancel && (
        <Box
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'var(--neutral-0)',
            boxShadow: 'var(--shadow-lg)',
            padding: 12,
          }}
        >
          <Button fullWidth variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Hủy đơn
          </Button>
        </Box>
      )}
    </Page>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Box flex justifyContent="space-between" style={{ padding: '3px 0' }}>
      <Text size="small" style={{ color: 'var(--neutral-600)' }}>
        {label}
      </Text>
      <Text size="small" bold={bold} style={bold ? { color: 'var(--clay-700)' } : undefined}>
        {value}
      </Text>
    </Box>
  );
}
