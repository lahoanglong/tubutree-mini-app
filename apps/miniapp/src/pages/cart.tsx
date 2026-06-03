import { Box, Page, Text, Button, Header, Spinner, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCart, updateCartItem, removeCartItem, type CartSummary } from '../services/shop-api';
import { formatVnd } from '../utils/format';

export default function CartPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: cart, isLoading } = useQuery({ queryKey: ['cart'], queryFn: getCart });

  const update = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) => updateCartItem(id, qty),
    onSuccess: (c) => queryClient.setQueryData(['cart'], c),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeCartItem(id),
    onSuccess: (c) => queryClient.setQueryData(['cart'], c),
  });

  if (isLoading) {
    return (
      <Page>
        <Header title="Giỏ hàng" showBackIcon={false} />
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  const summary: CartSummary = cart ?? {
    items: [],
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    itemCount: 0,
  };
  const empty = summary.items.length === 0;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 90 }}>
      <Header title="Giỏ hàng" showBackIcon={false} />

      {empty ? (
        <Box flex flexDirection="column" alignItems="center" p={8} style={{ gap: 12 }}>
          <Text style={{ fontSize: 48 }}>🛒</Text>
          <Text style={{ color: 'var(--neutral-600)' }}>Giỏ hàng trống</Text>
          <Button onClick={() => navigate('/browse')} style={{ background: 'var(--green-600)' }}>
            Mua sắm ngay
          </Button>
        </Box>
      ) : (
        <Box p={3} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {summary.items.map((it) => (
            <Box
              key={it.id}
              p={3}
              style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', display: 'flex', gap: 12 }}
            >
              <Box
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--green-50)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: '0 0 auto',
                }}
              >
                🌿
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="small" bold>
                  {it.productName}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  {it.variationName}
                </Text>
                <Text bold style={{ color: 'var(--clay-700)', marginTop: 4 }}>
                  {formatVnd(it.unitPrice)}
                </Text>
                <Box flex alignItems="center" style={{ gap: 12, marginTop: 6 }}>
                  <Stepper
                    value={it.quantity}
                    onDec={() => update.mutate({ id: it.id, qty: it.quantity - 1 })}
                    onInc={() => update.mutate({ id: it.id, qty: it.quantity + 1 })}
                  />
                  <Text
                    size="xSmall"
                    onClick={() => remove.mutate(it.id)}
                    style={{ color: 'var(--danger)', marginLeft: 'auto' }}
                  >
                    Xóa
                  </Text>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {!empty && (
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
          <Box flex justifyContent="space-between">
            <Text size="small" style={{ color: 'var(--neutral-600)' }}>
              Tạm tính
            </Text>
            <Text bold>{formatVnd(summary.subtotal)}</Text>
          </Box>
          <Button
            fullWidth
            onClick={() => navigate('/checkout')}
            style={{ background: 'var(--green-600)', marginTop: 8 }}
          >
            Thanh toán ({summary.itemCount})
          </Button>
        </Box>
      )}
    </Page>
  );
}

function Stepper({ value, onDec, onInc }: { value: number; onDec: () => void; onInc: () => void }) {
  const btn = {
    width: 28,
    height: 28,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--neutral-100)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  } as const;
  return (
    <Box flex alignItems="center" style={{ gap: 10 }}>
      <Box style={btn} onClick={onDec}>
        −
      </Box>
      <Text size="small">{value}</Text>
      <Box style={btn} onClick={onInc}>
        +
      </Box>
    </Box>
  );
}
