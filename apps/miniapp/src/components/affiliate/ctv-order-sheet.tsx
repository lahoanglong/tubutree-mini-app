import { useState } from 'react';
import { Box, Text, Button, Input, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus, Minus } from 'lucide-react';
import { GeoPicker, EMPTY_GEO, type GeoValue } from '../geo-picker';
import {
  suggestProducts,
  fetchProduct,
  type ProductSuggestion,
  type VariationDetail,
} from '../../services/shop-api';
import { createCtvOrder, type CtvOrderResult } from '../../services/affiliate-api';
import { getErrorMessage } from '../../services/api';
import { useDebounced } from '../../utils/use-debounced';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';

/** SĐT Việt Nam: 0xxxxxxxxx hoặc +84xxxxxxxxx. */
const VN_PHONE = /^(0|\+84)\d{9}$/;

interface OrderLine {
  variationId: string;
  productName: string;
  variationName: string;
  unitPrice: number;
  quantity: number;
  /** Tồn kho tại thời điểm thêm — chặn tăng số lượng vượt tồn ngay trên form (BE vẫn chặn thật). */
  stock: number;
}

const t = vi.ctvOrder;

/** Form CTV lên đơn hộ khách — tạo đơn + hoa hồng cho CTV. */
export function CtvOrderSheet({ onClose }: { onClose: () => void }) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();

  const [recipient, setRecipient] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [geo, setGeo] = useState<GeoValue>(EMPTY_GEO);
  const [note, setNote] = useState('');
  const [payment, setPayment] = useState<'COD' | 'BANK_TRANSFER'>('COD');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [result, setResult] = useState<CtvOrderResult | null>(null);

  const addLine = (v: VariationDetail, productName: string) => {
    haptic('light');
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variationId === v.id);
      if (idx >= 0) {
        const next = [...prev];
        const cur = next[idx]!;
        next[idx] = { ...cur, quantity: Math.min(cur.quantity + 1, Math.max(v.stock, 1)) };
        return next;
      }
      return [
        ...prev,
        {
          variationId: v.id,
          productName,
          variationName: v.name,
          unitPrice: v.salePrice ?? v.retailPrice,
          quantity: 1,
          stock: v.stock,
        },
      ];
    });
  };

  // Giới hạn số lượng theo tồn kho của variation đã chọn — tránh CTV tăng vượt tồn ngay trên
  // form rồi mới bị BE chặn khi gửi (giữ cùng cách làm với add-to-cart.tsx bên apps/web).
  const setQty = (variationId: string, delta: number) => {
    setLines((prev) =>
      prev
        .map((l) =>
          l.variationId === variationId
            ? { ...l, quantity: Math.min(Math.max(l.quantity + delta, 0), Math.max(l.stock, 1)) }
            : l,
        )
        .filter((l) => l.quantity > 0),
    );
  };

  const removeLine = (variationId: string) => {
    haptic('light');
    setLines((prev) => prev.filter((l) => l.variationId !== variationId));
  };

  const goods = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  const phoneClean = phone.replace(/\s/g, '');
  const recipientOk = recipient.trim().length > 0;
  const phoneOk = VN_PHONE.test(phoneClean);
  const streetOk = street.trim().length > 0;
  const geoOk = !!geo.provinceCode && !!geo.wardCode;
  const itemsOk = lines.length > 0;
  const valid = recipientOk && phoneOk && streetOk && geoOk && itemsOk;

  const mut = useMutation({
    mutationFn: () =>
      createCtvOrder({
        items: lines.map((l) => ({ variationId: l.variationId, quantity: l.quantity })),
        customer: {
          recipient: recipient.trim(),
          phone: phoneClean,
          province: geo.province,
          district: '',
          ward: geo.ward,
          street: street.trim(),
          provinceCode: geo.provinceCode,
          districtCode: '',
          wardCode: geo.wardCode,
        },
        paymentMethod: payment,
        note: note.trim() || undefined,
      }),
    onSuccess: (r) => {
      haptic('medium');
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['affiliate-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['affiliate-commissions'] });
      void qc.invalidateQueries({ queryKey: ['affiliate-product-breakdown'] });
      void qc.invalidateQueries({ queryKey: ['affiliate-sf-analytics'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const submit = () => {
    setShowErrors(true);
    if (!valid) return;
    mut.mutate();
  };

  if (result) {
    return (
      <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
        <Text bold size="large" style={{ marginBottom: 12 }}>
          {t.successTitle}
        </Text>
        <Box p={4} style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-lg)' }}>
          <Row label={t.orderCode} value={result.code} />
          <Row label={t.orderTotal} value={formatVnd(result.total)} strong />
        </Box>
        <Box flex style={{ gap: 8, marginTop: 20 }}>
          <Button
            variant="secondary"
            onClick={() => {
              setResult(null);
              setLines([]);
              setNote('');
            }}
            style={{ flex: 1, minHeight: 44 }}
          >
            {t.createAnother}
          </Button>
          <Button
            onClick={onClose}
            style={{ flex: 1, minHeight: 44, background: 'var(--primary-600)' }}
          >
            {t.done}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))', maxHeight: '82vh', overflowY: 'auto' }}>
      <Text bold size="large" style={{ marginBottom: 12 }}>
        {t.title}
      </Text>

      {/* Người nhận */}
      <Text size="xSmall" bold style={{ color: 'var(--neutral-500)', marginBottom: 6 }}>
        {t.recipientHeading}
      </Text>
      <Box flex flexDirection="column" style={{ gap: 10 }}>
        <FieldInput label={t.recipient} value={recipient} onChange={setRecipient} error={showErrors && !recipientOk ? t.requiredField : undefined} />
        <FieldInput
          label={t.phone}
          value={phone}
          onChange={setPhone}
          error={showErrors && !phoneOk ? (phone.trim() ? t.phoneInvalid : t.requiredField) : undefined}
        />
        <GeoPicker
          value={geo}
          onChange={setGeo}
          errorProvince={showErrors && !geo.provinceCode ? t.requiredField : undefined}
          errorWard={showErrors && !geo.wardCode ? t.requiredField : undefined}
        />
        <FieldInput label={t.street} value={street} onChange={setStreet} error={showErrors && !streetOk ? t.requiredField : undefined} />
      </Box>

      {/* Sản phẩm */}
      <Text size="xSmall" bold style={{ color: 'var(--neutral-500)', marginTop: 16, marginBottom: 6 }}>
        {t.products}
      </Text>
      {lines.map((l) => (
        <Box
          key={l.variationId}
          flex
          alignItems="center"
          style={{ gap: 8, padding: '8px 0', borderBottom: '1px solid var(--neutral-100)' }}
        >
          <Box style={{ flex: 1, overflow: 'hidden' }}>
            <Text size="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.productName}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
              {l.variationName} · {formatVnd(l.unitPrice)}
            </Text>
          </Box>
          <Box flex alignItems="center" style={{ gap: 6 }}>
            <Stepper icon={<Minus size={14} />} label="Giảm số lượng" onClick={() => setQty(l.variationId, -1)} />
            <Text size="small" bold style={{ minWidth: 20, textAlign: 'center' }}>
              {l.quantity}
            </Text>
            <Stepper icon={<Plus size={14} />} label="Tăng số lượng" onClick={() => setQty(l.variationId, 1)} />
          </Box>
          <Box
            role="button"
            aria-label={t.removeItem}
            className="tubu-press"
            onClick={() => removeLine(l.variationId)}
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 auto',
            }}
          >
            <Trash2 size={16} color="var(--neutral-400)" />
          </Box>
        </Box>
      ))}
      {showErrors && !itemsOk && (
        <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 4 }}>
          ⚠ {t.emptyItems}
        </Text>
      )}

      <ProductVariationPicker onAdd={addLine} />

      {/* Thanh toán */}
      <Text size="xSmall" bold style={{ color: 'var(--neutral-500)', marginTop: 16, marginBottom: 6 }}>
        {t.paymentHeading}
      </Text>
      <Box flex style={{ gap: 8 }}>
        <PayChip active={payment === 'COD'} title={t.cod} sub={t.codHint} onClick={() => setPayment('COD')} />
        <PayChip active={payment === 'BANK_TRANSFER'} title={t.bankTransfer} sub={t.bankHint} onClick={() => setPayment('BANK_TRANSFER')} />
      </Box>

      <Box mt={3}>
        <Input.TextArea
          label={t.note}
          placeholder={t.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      </Box>

      {/* Tạm tính + submit */}
      <Box flex alignItems="center" justifyContent="space-between" style={{ marginTop: 16 }}>
        <Box>
          <Text size="small" style={{ color: 'var(--neutral-500)' }}>
            {t.goodsSubtotal}
          </Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {t.shipNote}
          </Text>
        </Box>
        <Text bold size="large" style={{ color: 'var(--primary-700)' }}>
          {formatVnd(goods)}
        </Text>
      </Box>
      <Button
        fullWidth
        loading={mut.isPending}
        disabled={showErrors && !valid}
        onClick={submit}
        style={{ marginTop: 12, background: 'var(--primary-600)' }}
      >
        {t.submit}
      </Button>
    </Box>
  );
}

/** Tìm sản phẩm → chọn phân loại → thêm dòng. */
function ProductVariationPicker({ onAdd }: { onAdd: (v: VariationDetail, productName: string) => void }) {
  const [q, setQ] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const dq = useDebounced(q, 300);

  const suggestQ = useQuery({
    queryKey: ['ctv-suggest', dq],
    queryFn: () => suggestProducts(dq),
    enabled: dq.trim().length >= 1 && !slug,
  });
  const detailQ = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(slug!),
    enabled: !!slug,
  });

  const reset = () => {
    setSlug(null);
    setQ('');
  };

  // Đang chọn phân loại của 1 sản phẩm.
  if (slug) {
    const p = detailQ.data;
    return (
      <Box mt={2} p={3} style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
        <Box flex alignItems="center" justifyContent="space-between" mb={2}>
          <Text size="small" bold>
            {p?.name ?? t.chooseVariation}
          </Text>
          <Text size="xSmall" bold style={{ color: 'var(--primary-700)', cursor: 'pointer' }} onClick={reset}>
            {vi.common.close}
          </Text>
        </Box>
        {detailQ.isLoading ? (
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {vi.common.loading}
          </Text>
        ) : detailQ.isError ? (
          <Text
            size="xSmall"
            onClick={() => void detailQ.refetch()}
            style={{ color: 'var(--danger)', cursor: 'pointer' }}
          >
            ⚠ {vi.errors.loadFailed} · {vi.common.retry}
          </Text>
        ) : (
          (p?.variations ?? []).map((v) => {
            const out = v.stock <= 0;
            return (
              <Box
                key={v.id}
                className={out ? undefined : 'tubu-press'}
                onClick={() => {
                  if (out) return;
                  onAdd(v, p!.name);
                  reset();
                }}
                flex
                alignItems="center"
                justifyContent="space-between"
                style={{ padding: '8px 0', opacity: out ? 0.5 : 1, cursor: out ? 'not-allowed' : 'pointer' }}
              >
                <Text size="small">{v.name}</Text>
                <Text size="xSmall" bold style={{ color: out ? 'var(--neutral-400)' : 'var(--primary-700)' }}>
                  {out ? t.outOfStock : formatVnd(v.salePrice ?? v.retailPrice)}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    );
  }

  const results: ProductSuggestion[] = suggestQ.data ?? [];
  return (
    <Box mt={2}>
      <Input.Search
        placeholder={t.searchProduct}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        clearable
      />
      {dq.trim().length >= 1 && (
        <Box mt={1}>
          {suggestQ.isError ? (
            <Text
              size="xSmall"
              onClick={() => void suggestQ.refetch()}
              style={{ color: 'var(--danger)', padding: '6px 0', cursor: 'pointer' }}
            >
              ⚠ {vi.errors.loadFailed} · {vi.common.retry}
            </Text>
          ) : (
            <>
              {results.map((p) => (
                <Box
                  key={p.slug}
                  className="tubu-press"
                  onClick={() => setSlug(p.slug)}
                  flex
                  alignItems="center"
                  style={{ gap: 8, padding: '6px 0', cursor: 'pointer' }}
                >
                  {p.thumbnail && (
                    <img src={p.thumbnail} alt="" width={32} height={32} style={{ borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }} />
                  )}
                  <Box style={{ flex: 1, overflow: 'hidden' }}>
                    <Text size="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </Text>
                    <Text size="xSmall" bold style={{ color: 'var(--primary-700)' }}>
                      {formatVnd(p.basePrice)}
                    </Text>
                  </Box>
                </Box>
              ))}
              {results.length === 0 && !suggestQ.isFetching && (
                <Text size="xSmall" style={{ color: 'var(--neutral-400)', padding: '6px 0' }}>
                  {t.noProductsFound}
                </Text>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Box>
      <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} status={error ? 'error' : undefined} />
      {error && (
        <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 2 }}>
          ⚠ {error}
        </Text>
      )}
    </Box>
  );
}

function Stepper({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Box
      role="button"
      aria-label={label}
      className="tubu-press"
      onClick={onClick}
      flex
      alignItems="center"
      justifyContent="center"
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: '1px solid var(--neutral-200)',
        color: 'var(--primary-700)',
        cursor: 'pointer',
      }}
    >
      {icon}
    </Box>
  );
}

function PayChip({
  active,
  title,
  sub,
  onClick,
}: {
  active: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <Box
      className="tubu-press"
      onClick={onClick}
      p={3}
      style={{
        flex: 1,
        borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
        background: active ? 'var(--primary-50)' : 'var(--neutral-0)',
        cursor: 'pointer',
      }}
    >
      <Text size="small" bold style={{ color: active ? 'var(--primary-700)' : 'var(--neutral-900)' }}>
        {title}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {sub}
      </Text>
    </Box>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Box flex alignItems="center" justifyContent="space-between" py={1}>
      <Text size="small" style={{ color: 'var(--neutral-500)' }}>
        {label}
      </Text>
      <Text size={strong ? 'large' : 'small'} bold style={{ color: strong ? 'var(--leaf-700)' : 'var(--neutral-900)' }}>
        {value}
      </Text>
    </Box>
  );
}
