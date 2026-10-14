import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Input, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Trash2, Plus, Minus, UserPlus, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { EmptyState, ErrorState } from '../ui/empty-state';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { KeyValueRow } from '../ui/key-value-row';
import { ListRow } from '../ui/list-row';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';
import { ChoiceCard } from './choice-card';
import { GeoPicker, EMPTY_GEO, type GeoValue } from '../geo-picker';
import {
  loadRecentCustomers,
  normalizeCustomerPhone,
  recentCustomerLabel,
  saveRecentCustomer,
  type RecentCustomer,
} from './recent-customers';
import { useAuthStore } from '../../store/auth';
import {
  suggestProducts,
  fetchProduct,
  type ProductSuggestion,
  type VariationDetail,
} from '../../services/shop-api';
import { createCtvOrder, quoteCtvOrder, type CtvOrderItemInput, type CtvOrderResult } from '../../services/affiliate-api';
import { getErrorCode, getErrorMessage } from '../../services/api';
import { isSuggestable } from '../../hooks/use-suggest';
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

/** Giá hoặc tổng lúc tạo đơn đã khác báo giá CTV đang xem (giờ vàng hết giờ/hết suất, phí giao đổi). */
const PRICE_MOVED = new Set(['TOTAL_CHANGED', 'PRICE_CHANGED']);

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
  const [priceMoved, setPriceMoved] = useState<{ message: string; itemsKey: string } | null>(null);
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const [recents, setRecents] = useState<RecentCustomer[]>(() => loadRecentCustomers(userId));

  const applyCustomer = (c: RecentCustomer) => {
    haptic('light');
    setRecipient(c.recipient);
    setPhone(c.phone);
    setStreet(c.street);
    setGeo({ province: c.province, provinceCode: c.provinceCode, ward: c.ward, wardCode: c.wardCode });
    setShowErrors(false);
  };
  const clearCustomer = () => {
    haptic('light');
    setRecipient('');
    setPhone('');
    setStreet('');
    setGeo(EMPTY_GEO);
    setShowErrors(false);
  };

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

  // Giá trên form theo báo giá máy chủ (giờ vàng như khách tự đặt, phí giao): đúng số sẽ ghi vào đơn. Báo giá chỉ dùng khi
  // khớp đúng các dòng đang có; chưa có hoặc lỗi thì tạm tính theo giá niêm yết như trước.
  const itemsKey = JSON.stringify(lines.map((l) => ({ variationId: l.variationId, quantity: l.quantity })));
  const quotedKey = useDebounced(itemsKey, 300);
  const quoteQ = useQuery({
    queryKey: ['ctv-order-quote', quotedKey],
    queryFn: () => quoteCtvOrder(JSON.parse(quotedKey) as CtvOrderItemInput[]),
    enabled: quotedKey !== '[]',
    staleTime: 30_000,
  });
  const quoteFresh = quotedKey === itemsKey;
  const quote = quoteFresh ? quoteQ.data : undefined;
  const quoteFailed = quoteFresh && quoteQ.isError;
  // Máy chủ từ chối báo giá vì chính các dòng hàng (vd hàng gian hàng đối tác tự giao): bước tạo đơn cũng sẽ từ chối như vậy.
  const quoteProblem =
    quoteFailed && isAxiosError(quoteQ.error) && quoteQ.error.response?.status === 400 ? getErrorMessage(quoteQ.error) : null;
  const priceMovedMessage = priceMoved?.itemsKey === itemsKey ? priceMoved.message : null;
  const quotedLines = new Map((quote?.items ?? []).map((i) => [i.variationId, i]));
  const goods = quote?.goods ?? lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

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
        ...(quote ? { expectedTotal: quote.total } : {}),
      }),
    onSuccess: (r) => {
      haptic('medium');
      setPriceMoved(null);
      setResult(r);
      saveRecentCustomer(userId, {
        recipient: recipient.trim(),
        phone: phoneClean,
        street: street.trim(),
        province: geo.province,
        provinceCode: geo.provinceCode,
        ward: geo.ward,
        wardCode: geo.wardCode,
        usedAt: Date.now(),
      });
      setRecents(loadRecentCustomers(userId));
      void qc.invalidateQueries({ queryKey: ['affiliate-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['affiliate-commissions'] });
      void qc.invalidateQueries({ queryKey: ['affiliate-product-breakdown'] });
      void qc.invalidateQueries({ queryKey: ['affiliate-sf-analytics'] });
    },
    onError: (e) => {
      const code = getErrorCode(e);
      if (code && PRICE_MOVED.has(code)) {
        setPriceMoved({ message: getErrorMessage(e), itemsKey });
        void qc.invalidateQueries({ queryKey: ['ctv-order-quote'] });
        return;
      }
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

  const submit = () => {
    setShowErrors(true);
    if (!valid) return;
    mut.mutate();
  };

  // Sheet ZaUI đã tự đệm safe-area đáy (xem ui/bottom-sheet.tsx) nên chỉ đệm 16px, không cộng thêm.
  if (result) {
    return (
      <div style={{ padding: 16 }}>
        <Heading variant="title-md" as="h2" style={{ marginBottom: 12 }}>
          {t.successTitle}
        </Heading>
        <div style={{ padding: 16, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-card)' }}>
          <KeyValueRow label={t.orderCode} value={result.code} />
          <KeyValueRow label={t.orderTotal} value={formatVnd(result.total)} emphasis tone="success" />
        </div>
        {/* Đơn chuyển khoản: CTV cần QR/số tài khoản để gửi khách. Trước đây màn này chỉ báo
            "đã tạo đơn" rồi hết — không QR, không nút mở đơn — nên đơn nằm chờ thanh toán tới
            khi bị huỷ, CTV mất cả đơn lẫn hoa hồng. */}
        {payment === 'BANK_TRANSFER' && (
          <Button
            fullWidth
            onPress={() => {
              onClose();
              navigate(`/bank-payment/${result.code}`);
            }}
            style={{ marginTop: 16 }}
          >
            {t.openPayment}
          </Button>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: payment === 'BANK_TRANSFER' ? 8 : 20 }}>
          <Button
            variant="secondary"
            onPress={() => {
              setResult(null);
              setLines([]);
              setNote('');
            }}
            style={{ flex: 1 }}
          >
            {t.createAnother}
          </Button>
          <Button
            variant={payment === 'BANK_TRANSFER' ? 'secondary' : 'primary'}
            onPress={() => {
              onClose();
              navigate(`/order/${result.code}`);
            }}
            style={{ flex: 1 }}
          >
            {t.viewOrder}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxHeight: '82vh', overflowY: 'auto' }}>
      <Heading variant="title-md" as="h2" style={{ marginBottom: 12 }}>
        {t.title}
      </Heading>

      {/* Khách gần đây: chạm một lần điền sẵn tên, SĐT và địa chỉ (thay cho ~5 lần nhập tay). */}
      {recents.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <GroupLabel style={{ marginBottom: 2 }}>{t.recentHeading}</GroupLabel>
          <div className="scroll-x" style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
            <Chip variant="choice" icon={UserPlus} onPress={clearCustomer}>
              {t.newCustomer}
            </Chip>
            {recents.map((c) => (
              <Chip
                key={normalizeCustomerPhone(c.phone)}
                selected={normalizeCustomerPhone(c.phone) === phoneClean}
                onPress={() => applyCustomer(c)}
              >
                {recentCustomerLabel(c)}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {/* Người nhận */}
      <GroupLabel>{t.recipientHeading}</GroupLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
      </div>

      {/* Sản phẩm */}
      <GroupLabel style={{ marginTop: 16 }}>{t.products}</GroupLabel>
      {lines.map((l) => (
        <div
          key={l.variationId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}
        >
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Text variant="body-sm" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.productName}
            </Text>
            <Text variant="caption" tone="tertiary" as="div">
              {l.variationName} · {formatVnd(quotedLines.get(l.variationId)?.unitPrice ?? l.unitPrice)}
            </Text>
            {quotedLines.get(l.variationId)?.isFlash && (
              <Text variant="caption" tone="brand" as="div">
                {t.flashPrice}
              </Text>
            )}
            {quotedLines.get(l.variationId)?.flashLimitNotice && (
              <Text variant="caption" tone="warning" as="div">
                {quotedLines.get(l.variationId)!.flashLimitNotice}
              </Text>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Stepper icon={Minus} label="Giảm số lượng" onClick={() => setQty(l.variationId, -1)} />
            <Text variant="body-sm" style={{ fontWeight: 600, minWidth: 20, textAlign: 'center' }}>
              {l.quantity}
            </Text>
            <Stepper icon={Plus} label="Tăng số lượng" onClick={() => setQty(l.variationId, 1)} />
          </div>
          <IconButton
            icon={Trash2}
            label={t.removeItem}
            size="sm"
            onPress={() => removeLine(l.variationId)}
            style={{ width: 44, height: 44, flex: '0 0 auto' }}
          />
        </div>
      ))}
      {showErrors && !itemsOk && <InlineError style={{ marginTop: 4 }}>{t.emptyItems}</InlineError>}
      {quoteProblem && <InlineError style={{ marginTop: 4 }}>{quoteProblem}</InlineError>}

      <ProductVariationPicker onAdd={addLine} />

      {/* Thanh toán */}
      <GroupLabel style={{ marginTop: 16 }}>{t.paymentHeading}</GroupLabel>
      <div style={{ display: 'flex', gap: 8 }}>
        <ChoiceCard active={payment === 'COD'} title={t.cod} sub={t.codHint} onPress={() => setPayment('COD')} />
        <ChoiceCard
          active={payment === 'BANK_TRANSFER'}
          title={t.bankTransfer}
          sub={t.bankHint}
          onPress={() => setPayment('BANK_TRANSFER')}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <Input.TextArea
          label={t.note}
          placeholder={t.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      </div>

      {priceMovedMessage && (
        <div role="alert" style={{ marginTop: 16 }}>
          <InlineError>
            {priceMovedMessage} {t.totalChangedHint}
          </InlineError>
        </div>
      )}

      {/* Tạm tính + submit */}
      {lines.length > 0 && !quoteFailed ? (
        <div style={{ marginTop: 16 }}>
          <KeyValueRow label={t.goodsSubtotal} value={<span data-testid="ctv-order-goods">{formatVnd(goods)}</span>} />
          <KeyValueRow
            label={t.shippingFee}
            value={<span data-testid="ctv-order-shipping">{quote ? formatVnd(quote.shippingFee) : t.calculating}</span>}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 6 }}>
            <Text variant="body-sm" tone="secondary">
              {t.customerTotal}
            </Text>
            <Text variant="price-lg" tone="brand" data-testid="ctv-order-total">
              {quote ? formatVnd(quote.total) : t.calculating}
            </Text>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <Text variant="body-sm" tone="tertiary" as="div">
              {t.goodsSubtotal}
            </Text>
            <Text variant="caption" tone="tertiary" as="div">
              {t.shipNote}
            </Text>
          </div>
          <Text variant="price-lg" tone="brand" data-testid="ctv-order-goods">
            {formatVnd(goods)}
          </Text>
        </div>
      )}
      <Button
        fullWidth
        loading={mut.isPending}
        disabled={showErrors && !valid}
        onPress={submit}
        style={{ marginTop: 12 }}
      >
        {t.submit}
      </Button>
    </div>
  );
}

/** Tìm sản phẩm → chọn phân loại → thêm dòng. */
function ProductVariationPicker({ onAdd }: { onAdd: (v: VariationDetail, productName: string) => void }) {
  const [q, setQ] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const dq = useDebounced(q, 300);

  // Cổng xét cả từ khoá đang gõ (chưa debounce): xoá bớt xuống dưới 2 ký tự thì ẩn gợi ý ngay.
  const canSuggest = isSuggestable(q) && isSuggestable(dq);
  const tooShort = q.trim() !== '' && !isSuggestable(q);

  const suggestQ = useQuery({
    queryKey: ['ctv-suggest', dq],
    queryFn: () => suggestProducts(dq),
    enabled: canSuggest && !slug,
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
      <div style={{ marginTop: 8, padding: 12, background: 'var(--color-bg-canvas)', borderRadius: 'var(--radius-control)' }}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="body-sm" style={{ fontWeight: 600 }}>
            {p?.name ?? t.chooseVariation}
          </Text>
          <Button variant="ghost" onPress={reset}>
            {vi.common.close}
          </Button>
        </div>
        {detailQ.isLoading ? (
          <Skeleton height={16} width="50%" />
        ) : detailQ.isError ? (
          <ErrorState variant="inline" message={vi.errors.loadFailed} onRetry={() => void detailQ.refetch()} />
        ) : (
          (p?.variations ?? []).map((v) => {
            const out = v.stock <= 0;
            return (
              <ListRow
                key={v.id}
                title={v.name}
                trailing={
                  <Text variant="caption" tone={out ? 'tertiary' : 'brand'} style={{ fontWeight: 600 }}>
                    {out ? t.outOfStock : formatVnd(v.salePrice ?? v.retailPrice)}
                  </Text>
                }
                onPress={
                  out
                    ? undefined
                    : () => {
                        onAdd(v, p!.name);
                        reset();
                      }
                }
                style={{ opacity: out ? 0.5 : 1 }}
              />
            );
          })
        )}
      </div>
    );
  }

  const results: ProductSuggestion[] = suggestQ.data ?? [];
  return (
    <div style={{ marginTop: 8 }}>
      <Input.Search
        placeholder={t.searchProduct}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        clearable
      />
      {tooShort && (
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>
          {vi.common.suggestMinChars}
        </Text>
      )}
      {canSuggest && (
        <div style={{ marginTop: 4 }}>
          {suggestQ.isError ? (
            <ErrorState variant="inline" message={vi.errors.loadFailed} onRetry={() => void suggestQ.refetch()} />
          ) : (
            <>
              {results.map((p) => (
                <ListRow
                  key={p.slug}
                  icon={
                    p.thumbnail ? (
                      <img src={p.thumbnail} alt="" width={32} height={32} style={{ borderRadius: 'var(--radius-media)', objectFit: 'cover', flex: '0 0 auto' }} />
                    ) : undefined
                  }
                  title={p.name}
                  subtitle={
                    <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
                      {formatVnd(p.basePrice)}
                    </Text>
                  }
                  onPress={() => setSlug(p.slug)}
                />
              ))}
              {results.length === 0 && !suggestQ.isFetching && (
                <EmptyState variant="inline" art="search" heading={t.noProductsFound} />
              )}
            </>
          )}
        </div>
      )}
    </div>
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
    <div>
      <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} status={error ? 'error' : undefined} />
      {error && <InlineError style={{ marginTop: 2 }}>{error}</InlineError>}
    </div>
  );
}

function GroupLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <Text variant="caption" tone="tertiary" as="div" style={{ fontWeight: 600, marginBottom: 6, ...style }}>
      {children}
    </Text>
  );
}

function InlineError({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...style }}>
      <Icon icon={TriangleAlert} size="sm" tone="danger" />
      <Text variant="caption" tone="danger">
        {children}
      </Text>
    </div>
  );
}

function Stepper({ icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <IconButton
      icon={icon}
      label={label}
      size="sm"
      onPress={onClick}
      style={{ width: 44, height: 44, border: '1px solid var(--color-border-subtle)' }}
    />
  );
}
