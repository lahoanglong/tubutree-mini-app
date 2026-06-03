import { useEffect, useState } from 'react';
import { Box, Page, Text, Button, Header, Spinner, Input, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAddresses,
  createAddress,
  checkoutQuote,
  placeOrder,
  type AddressDTO,
} from '../services/shop-api';
import { formatVnd } from '../utils/format';

const PAYMENT_METHODS = [
  { value: 'COD', label: 'Thanh toán khi nhận hàng (COD)' },
  { value: 'ZALOPAY', label: 'ZaloPay' },
  { value: 'BANK_TRANSFER', label: 'Chuyển khoản ngân hàng' },
];

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [adding, setAdding] = useState(false);

  const { data: addresses, isLoading } = useQuery({ queryKey: ['addresses'], queryFn: getAddresses });

  useEffect(() => {
    if (addresses && addresses.length > 0 && !addressId) {
      const first = addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id;
      if (first) setAddressId(first);
    }
  }, [addresses, addressId]);

  const { data: quote } = useQuery({
    queryKey: ['quote', addressId],
    queryFn: () => checkoutQuote(addressId!),
    enabled: !!addressId,
  });

  const order = useMutation({
    mutationFn: () => placeOrder({ addressId: addressId!, paymentMethod: payment }),
    onSuccess: (o) => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      openSnackbar({ text: `Đặt hàng thành công: ${o.code}`, type: 'success' });
      navigate(`/order/${o.code}`, { replace: true });
    },
    onError: (e: unknown) =>
      openSnackbar({ text: e instanceof Error ? e.message : 'Đặt hàng lỗi', type: 'error' }),
  });

  if (isLoading) {
    return (
      <Page>
        <Header title="Thanh toán" />
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 100 }}>
      <Header title="Thanh toán" />

      {/* Address */}
      <Section title="Địa chỉ giao hàng">
        {addresses && addresses.length > 0 ? (
          addresses.map((a) => <AddressRow key={a.id} a={a} active={addressId === a.id} onClick={() => setAddressId(a.id)} />)
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có địa chỉ.
          </Text>
        )}
        {adding ? (
          <NewAddressForm
            onCancel={() => setAdding(false)}
            onCreated={(a) => {
              void queryClient.invalidateQueries({ queryKey: ['addresses'] });
              setAddressId(a.id);
              setAdding(false);
            }}
          />
        ) : (
          <Text
            size="small"
            onClick={() => setAdding(true)}
            style={{ color: 'var(--green-600)', marginTop: 8 }}
          >
            + Thêm địa chỉ mới
          </Text>
        )}
      </Section>

      {/* Payment */}
      <Section title="Phương thức thanh toán">
        {PAYMENT_METHODS.map((m) => (
          <Box
            key={m.value}
            flex
            alignItems="center"
            onClick={() => setPayment(m.value)}
            style={{ gap: 10, padding: '8px 0' }}
          >
            <Box
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: `2px solid ${payment === m.value ? 'var(--green-600)' : 'var(--neutral-200)'}`,
                background: payment === m.value ? 'var(--green-600)' : 'transparent',
              }}
            />
            <Text size="small">{m.label}</Text>
          </Box>
        ))}
      </Section>

      {/* Summary */}
      {quote && (
        <Section title="Tóm tắt">
          <Row label="Tạm tính" value={formatVnd(quote.subtotal)} />
          {quote.discount > 0 && <Row label="Giảm giá" value={`-${formatVnd(quote.discount)}`} />}
          <Row
            label="Phí vận chuyển"
            value={quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)}
          />
          <Row label="Tổng cộng" value={formatVnd(quote.total)} bold />
          <Text size="xSmall" style={{ color: 'var(--green-600)', marginTop: 4 }}>
            +{quote.pointsEarned} điểm Xanh khi giao thành công
          </Text>
        </Section>
      )}

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
        <Button
          fullWidth
          loading={order.isPending}
          disabled={!addressId || !quote}
          onClick={() => order.mutate()}
          style={{ background: 'var(--green-600)' }}
        >
          {quote ? `Đặt hàng · ${formatVnd(quote.total)}` : 'Đặt hàng'}
        </Button>
      </Box>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
      <Text bold size="small" style={{ marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </Box>
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

function AddressRow({ a, active, onClick }: { a: AddressDTO; active: boolean; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      p={2}
      style={{
        border: `1px solid ${active ? 'var(--green-600)' : 'var(--neutral-200)'}`,
        borderRadius: 'var(--radius-md)',
        marginBottom: 8,
      }}
    >
      <Text size="small" bold>
        {a.recipient} · {a.phone}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
        {a.street}, {a.ward}, {a.district}, {a.province}
      </Text>
    </Box>
  );
}

function NewAddressForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (a: AddressDTO) => void;
}) {
  const [form, setForm] = useState({ recipient: '', phone: '', province: '', district: '', ward: '', street: '' });
  const { openSnackbar } = useSnackbar();
  const create = useMutation({
    mutationFn: () =>
      createAddress({
        ...form,
        provinceCode: '00',
        districtCode: '00',
        wardCode: '00',
      }),
    onSuccess: onCreated,
    onError: () => openSnackbar({ text: 'Tạo địa chỉ lỗi', type: 'error' }),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Box style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Input placeholder="Người nhận" value={form.recipient} onChange={set('recipient')} />
      <Input placeholder="Số điện thoại" value={form.phone} onChange={set('phone')} />
      <Input placeholder="Tỉnh/Thành" value={form.province} onChange={set('province')} />
      <Input placeholder="Quận/Huyện" value={form.district} onChange={set('district')} />
      <Input placeholder="Phường/Xã" value={form.ward} onChange={set('ward')} />
      <Input placeholder="Số nhà, đường" value={form.street} onChange={set('street')} />
      <Box flex style={{ gap: 8 }}>
        <Button size="small" variant="secondary" onClick={onCancel}>
          Hủy
        </Button>
        <Button
          size="small"
          loading={create.isPending}
          onClick={() => create.mutate()}
          style={{ background: 'var(--green-600)' }}
        >
          Lưu
        </Button>
      </Box>
    </Box>
  );
}
