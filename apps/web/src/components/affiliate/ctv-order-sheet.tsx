'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Trash2, TriangleAlert, UserPlus } from 'lucide-react';
import { createCtvOrder, type CtvOrderInput, type CtvOrderResult } from '@tubutree/app-core/api/affiliate';
import type { ProductSuggestion, VariationDetail } from '@tubutree/app-core/api/catalog';
import { isSuggestable, parseTypedVnPhone } from '@tubutree/app-core/affiliate-rules';
import { createOrderKeyRing } from '@tubutree/app-core/order-key-ring';
import {
  affiliateCommissionsQuery,
  affiliateDashboardQuery,
  affiliateProductBreakdownQuery,
  affiliateStorefrontAnalyticsQuery,
  ctvOrderQuoteQuery,
} from '@tubutree/app-core/queries/affiliate';
import { productQuery, suggestQuery } from '@tubutree/app-core/queries/catalog';
import { ApiError, NetworkError } from '@/lib/client-api';
import { useAuth } from '@/lib/auth-context';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { bankPaymentHref } from '@/lib/order-view';
import { isWebRouteReady } from '@/lib/route-map';
import { EMPTY_GEO, GeoPicker, type GeoValue } from '@/components/geo-picker';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { ChoiceCard } from './choice-card';
import { CTV_ORDER_COPY as t } from './ctv-order-copy';
import { loadRecentCustomers, normalizeCustomerPhone, recentCustomerLabel, saveRecentCustomer, type RecentCustomer } from './recent-customers';
import { ProductThumb } from '@/components/mini';

interface OrderLine {
  variationId: string;
  productName: string;
  variationName: string;
  unitPrice: number;
  quantity: number;
  /** Tồn kho tại thời điểm thêm: chặn tăng số lượng vượt tồn ngay trên form (máy chủ vẫn chặn thật). */
  stock: number;
}

/** Giá hoặc tổng lúc tạo đơn đã khác báo giá CTV đang xem (giờ vàng hết giờ/hết suất, phí giao đổi). */
const PRICE_MOVED = new Set(['TOTAL_CHANGED', 'PRICE_CHANGED']);
/** Tên người nhận tối thiểu, cùng luật máy chủ (PlaceOrderForCustomerDto). */
const RECIPIENT_MIN = 2;
/** Chờ trước khi tự gửi lại đúng đơn đó (cùng key) sau quá thời gian/mất kết nối: một lần, rồi để CTV tự bấm "Gửi lại đơn". */
export const RECHECK_DELAY_MS = 1_500;
const SUGGEST_DEBOUNCE_MS = 300;
const QUOTE_DEBOUNCE_MS = 300;

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');
const errCode = (e: unknown) => (e instanceof ApiError ? e.code : null);
/** Không có phản hồi hoặc 5xx: máy chủ có thể đã ghi đơn, nên gửi lại phải dùng đúng Idempotency-Key cũ; 4xx là đã từ chối. */
const isOutcomeUnknown = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && e.status >= 500);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

interface Submission {
  body: CtvOrderInput;
  key: string;
}

export function CtvOrderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mount khi mở để form và các khoá Idempotency-Key bắt đầu mới mỗi lần lên đơn.
  return open ? <CtvOrderForm onClose={onClose} /> : null;
}

/** Form CTV lên đơn hộ khách: tạo đơn và hoa hồng cho CTV. */
function CtvOrderForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const userId = useAuth().user?.id;

  const [recipient, setRecipient] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [geo, setGeo] = useState<GeoValue>(EMPTY_GEO);
  const [note, setNote] = useState('');
  const [payment, setPayment] = useState<'COD' | 'BANK_TRANSFER'>('COD');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [result, setResult] = useState<{ order: CtvOrderResult; payment: 'COD' | 'BANK_TRANSFER' } | null>(null);
  const [priceMoved, setPriceMoved] = useState<{ message: string; itemsKey: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Mỗi lần điền form một key (như checkout): gửi lại cùng nội dung sau quá thời gian/mất mạng là cùng key, máy chủ trả lại
  // đơn đã tạo. Đổi món/khách/cách trả là đơn khác nên key khác; tạo đơn xong thì reset.
  const orderKeys = useRef(createOrderKeyRing(newIdempotencyKey));
  // Key của lần gửi chưa biết kết quả (quá thời gian, mất kết nối, 5xx sau khi đã tự kiểm tra lại một lần).
  const [unconfirmedKey, setUnconfirmedKey] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentCustomer[]>(() => loadRecentCustomers(userId));
  const busy = useRef(false);

  const applyCustomer = (c: RecentCustomer) => {
    setRecipient(c.recipient);
    setPhone(c.phone);
    setStreet(c.street);
    setGeo({ province: c.province, provinceCode: c.provinceCode, ward: c.ward, wardCode: c.wardCode });
    setShowErrors(false);
  };
  const clearCustomer = () => {
    setRecipient('');
    setPhone('');
    setStreet('');
    setGeo(EMPTY_GEO);
    setShowErrors(false);
  };

  const addLine = (v: VariationDetail, productName: string) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variationId === v.id);
      if (idx >= 0) {
        const next = [...prev];
        const cur = next[idx]!;
        next[idx] = { ...cur, quantity: Math.min(cur.quantity + 1, Math.max(v.stock, 1)) };
        return next;
      }
      return [...prev, { variationId: v.id, productName, variationName: v.name, unitPrice: v.salePrice ?? v.retailPrice, quantity: 1, stock: v.stock }];
    });
  };

  // Giới hạn số lượng theo tồn kho của phân loại đã chọn: tránh CTV tăng vượt tồn rồi mới bị máy chủ chặn khi gửi.
  const setQty = (variationId: string, delta: number) => {
    setLines((prev) =>
      prev
        .map((l) => (l.variationId === variationId ? { ...l, quantity: Math.min(Math.max(l.quantity + delta, 0), Math.max(l.stock, 1)) } : l))
        .filter((l) => l.quantity > 0),
    );
  };
  const removeLine = (variationId: string) => setLines((prev) => prev.filter((l) => l.variationId !== variationId));

  // Giá trên form theo báo giá máy chủ (giờ vàng như khách tự đặt, phí giao): đúng số sẽ ghi vào đơn. Báo giá chỉ dùng khi
  // khớp đúng các dòng đang có; chưa có hoặc lỗi thì tạm tính theo giá niêm yết.
  const itemsKey = JSON.stringify(lines.map((l) => ({ variationId: l.variationId, quantity: l.quantity })));
  const quotedKey = useDebounced(itemsKey, QUOTE_DEBOUNCE_MS);
  const quoteQ = useQuery({ ...ctvOrderQuoteQuery(coreHttp, quotedKey), enabled: quotedKey !== '[]', staleTime: 30_000 });
  const quoteFresh = quotedKey === itemsKey;
  const quote = quoteFresh ? quoteQ.data : undefined;
  const quoteFailed = quoteFresh && quoteQ.isError;
  // Máy chủ từ chối báo giá vì chính các dòng hàng (vd hàng gian hàng đối tác tự giao): bước tạo đơn cũng sẽ từ chối như vậy.
  const quoteProblem = quoteFailed && quoteQ.error instanceof ApiError && quoteQ.error.status === 400 ? quoteQ.error.message : null;
  const priceMovedMessage = priceMoved?.itemsKey === itemsKey ? priceMoved.message : null;
  const quotedLines = new Map((quote?.items ?? []).map((i) => [i.variationId, i]));
  const goods = quote?.goods ?? lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  const phoneLocal = parseTypedVnPhone(phone);
  const recipientOk = recipient.trim().length >= RECIPIENT_MIN;
  const phoneOk = phoneLocal !== null;
  const streetOk = street.trim().length > 0;
  const geoOk = !!geo.provinceCode && !!geo.wardCode;
  const itemsOk = lines.length > 0;
  const valid = recipientOk && phoneOk && streetOk && geoOk && itemsOk;
  // Báo giá đang tính: gửi đơn lúc này không kèm tổng đã báo cho khách nên máy chủ không bắt được giá đổi. Báo giá lỗi hẳn thì vẫn cho đặt.
  const quotePending = itemsOk && !quote && !quoteFailed;
  // Trần COD mỗi đơn (máy chủ trả lý do trong báo giá, cùng câu nó từ chối lúc tạo đơn): khoá COD, tự chuyển sang chuyển khoản.
  const codBlocked = quote?.blockedPaymentMethods?.COD ?? null;
  useEffect(() => {
    if (codBlocked && payment === 'COD') setPayment('BANK_TRANSFER');
  }, [codBlocked, payment]);

  const body: CtvOrderInput = {
    items: lines.map((l) => ({ variationId: l.variationId, quantity: l.quantity })),
    customer: {
      recipient: recipient.trim(),
      phone: phoneLocal ?? phone.trim(),
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
  };
  const resendSameOrder = unconfirmedKey !== null && orderKeys.current.peek(body) === unconfirmedKey;

  const mut = useMutation({
    mutationFn: (s: Submission) => createCtvOrder(coreHttp, s.body, s.key),
    // Quá thời gian/mất kết nối: máy chủ có thể đã ghi đơn. Tự gửi lại đúng đơn đó (cùng key, máy chủ trả lại đơn đã có) thay
    // vì để CTV bấm lại; lỗi nghiệp vụ 4xx thì không.
    retry: (failureCount, error) => failureCount < 1 && isOutcomeUnknown(error),
    retryDelay: RECHECK_DELAY_MS,
    onSuccess: (order, s) => {
      orderKeys.current.reset();
      setUnconfirmedKey(null);
      setPriceMoved(null);
      setSubmitError(null);
      setResult({ order, payment: s.body.paymentMethod });
      const c = s.body.customer;
      saveRecentCustomer(userId, {
        recipient: c.recipient,
        phone: c.phone,
        street: c.street,
        province: c.province,
        provinceCode: c.provinceCode,
        ward: c.ward,
        wardCode: c.wardCode,
        usedAt: Date.now(),
      });
      setRecents(loadRecentCustomers(userId));
      void qc.invalidateQueries({ queryKey: ['orders'] });
      for (const q of [affiliateDashboardQuery, affiliateCommissionsQuery, affiliateProductBreakdownQuery, affiliateStorefrontAnalyticsQuery]) {
        void qc.invalidateQueries({ queryKey: q(coreHttp).queryKey });
      }
    },
    onError: (e, s) => {
      if (isOutcomeUnknown(e)) {
        setUnconfirmedKey(s.key);
        return;
      }
      setUnconfirmedKey(null);
      const code = errCode(e);
      if (code && PRICE_MOVED.has(code)) {
        setPriceMoved({ message: errText(e), itemsKey });
        void qc.invalidateQueries({ queryKey: ['ctv-order-quote'] });
        return;
      }
      // Báo giá đang cache còn cho COD mà máy chủ từ chối (đơn vượt trần): tải lại để khoá COD và tự chuyển sang chuyển khoản.
      if (code === 'PAYMENT_METHOD_NOT_ALLOWED') void qc.invalidateQueries({ queryKey: ['ctv-order-quote'] });
      setSubmitError(errText(e));
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const checking = mut.isPending && mut.failureCount > 0;

  const submit = () => {
    setShowErrors(true);
    // `disabled` chỉ có hiệu lực sau lần render kế: hai cú bấm trong cùng khung hình vẫn gọi mutate hai lần.
    if (busy.current || !valid || quotePending || (payment === 'COD' && codBlocked)) return;
    busy.current = true;
    setSubmitError(null);
    mut.mutate({ body, key: orderKeys.current.keyFor(body) });
  };

  if (result) {
    const code = result.order.code;
    const bank = result.payment === 'BANK_TRANSFER';
    const payReady = isWebRouteReady('/thanh-toan/chuyen-khoan/x');
    const orderReady = isWebRouteReady('/tai-khoan/don-hang/x');
    return (
      <Sheet open onClose={onClose} title={t.successTitle}>
        <dl className="rounded-card bg-stone-50 p-4 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-stone-700">{t.orderCode}</dt>
            <dd className="font-semibold text-stone-900">{code}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <dt className="text-stone-700">{t.orderTotal}</dt>
            <dd className="font-semibold tabular-nums text-success-fg">{formatVnd(result.order.total)}</dd>
          </div>
        </dl>
        {/* Đơn chuyển khoản: CTV cần QR/số tài khoản để gửi khách, không thì đơn nằm chờ thanh toán tới khi bị huỷ; trang đơn đã có QR nên dùng làm lối thay khi trang chuyển khoản riêng chưa mở. */}
        {bank && (payReady || orderReady) && (
          <Link
            href={payReady ? bankPaymentHref(code) : `/tai-khoan/don-hang/${encodeURIComponent(code)}`}
            onClick={onClose}
            className={`${ui.btnPrimary} mt-4 w-full`}
          >
            {t.openPayment}
          </Link>
        )}
        <div className={`mt-${bank ? 2 : 5} flex gap-2`}>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setLines([]);
              setNote('');
            }}
            className={`${ui.btnSecondary} flex-1`}
          >
            {t.createAnother}
          </button>
          {orderReady && !(bank && !payReady) && (
            <Link href={`/tai-khoan/don-hang/${encodeURIComponent(code)}`} onClick={onClose} className={`${bank ? ui.btnSecondary : ui.btnPrimary} flex-1`}>
              {t.viewOrder}
            </Link>
          )}
        </div>
      </Sheet>
    );
  }

  const ordersHref = isWebRouteReady('/tai-khoan/don-hang') ? '/tai-khoan/don-hang' : '/tai-khoan';

  return (
    <Sheet open onClose={onClose} title={t.title} size="full">
      {/* Khách gần đây: chạm một lần điền sẵn tên, SĐT và địa chỉ. */}
      {recents.length > 0 && (
        <div className="mb-3">
          <GroupLabel>{t.recentHeading}</GroupLabel>
          <div className="flex gap-2 overflow-x-auto py-1">
            <button type="button" onClick={clearCustomer} className={chip(false)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t.newCustomer}
            </button>
            {recents.map((c) => (
              <button
                key={normalizeCustomerPhone(c.phone)}
                type="button"
                aria-pressed={normalizeCustomerPhone(c.phone) === phoneLocal}
                onClick={() => applyCustomer(c)}
                className={chip(normalizeCustomerPhone(c.phone) === phoneLocal)}
              >
                {recentCustomerLabel(c)}
              </button>
            ))}
          </div>
        </div>
      )}

      <GroupLabel>{t.recipientHeading}</GroupLabel>
      <div className="space-y-2.5">
        <Field label={t.recipient} error={showErrors && !recipientOk ? (recipient.trim() ? t.recipientTooShort : t.requiredField) : undefined}>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className={showErrors && !recipientOk ? ui.fieldError : ui.field} />
        </Field>
        <Field label={t.phone} error={showErrors && !phoneOk ? (phone.trim() ? t.phoneInvalid : t.requiredField) : undefined}>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={showErrors && !phoneOk ? ui.fieldError : ui.field} />
        </Field>
        <GeoPicker
          value={geo}
          onChange={setGeo}
          errorProvince={showErrors && !geo.provinceCode ? t.requiredField : undefined}
          errorWard={showErrors && !geo.wardCode ? t.requiredField : undefined}
        />
        <Field label={t.street} error={showErrors && !streetOk ? t.requiredField : undefined}>
          <input value={street} onChange={(e) => setStreet(e.target.value)} className={showErrors && !streetOk ? ui.fieldError : ui.field} />
        </Field>
      </div>

      <GroupLabel className="mt-4">{t.products}</GroupLabel>
      <ul>
        {lines.map((l) => {
          const q = quotedLines.get(l.variationId);
          return (
            <li key={l.variationId} className="flex items-center gap-2 border-b border-stone-200 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-stone-900">{l.productName}</div>
                <div className="text-xs text-stone-600">
                  {l.variationName} · {formatVnd(q?.unitPrice ?? l.unitPrice)}
                </div>
                {q?.isFlash && <div className="text-xs text-promo-fg">{t.flashPrice}</div>}
                {q?.flashLimitNotice && <div className="text-xs text-warning-fg">{q.flashLimitNotice}</div>}
              </div>
              <div className="flex items-center gap-1.5">
                <StepButton label="Giảm số lượng" onClick={() => setQty(l.variationId, -1)}>
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </StepButton>
                <span className="min-w-5 text-center text-sm font-semibold">{l.quantity}</span>
                <StepButton label="Tăng số lượng" onClick={() => setQty(l.variationId, 1)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </StepButton>
              </div>
              <button
                type="button"
                aria-label={t.removeItem}
                onClick={() => removeLine(l.variationId)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-stone-700 hover:bg-stone-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {showErrors && !itemsOk && <InlineError>{t.emptyItems}</InlineError>}
      {quoteProblem && <InlineError>{quoteProblem}</InlineError>}

      <ProductVariationPicker onAdd={addLine} />

      <GroupLabel className="mt-4">{t.paymentHeading}</GroupLabel>
      <div role="group" aria-label={t.paymentHeading} className="flex gap-2">
        <ChoiceCard
          active={payment === 'COD'}
          title={t.cod}
          sub={t.codHint}
          onPress={() => setPayment('COD')}
          disabled={!!codBlocked}
          describedBy={codBlocked ? 'ctv-cod-blocked' : undefined}
        />
        <ChoiceCard active={payment === 'BANK_TRANSFER'} title={t.bankTransfer} sub={t.bankHint} onPress={() => setPayment('BANK_TRANSFER')} />
      </div>
      {codBlocked && (
        <div id="ctv-cod-blocked" className="mt-1.5 text-xs text-stone-700">
          {codBlocked}
        </div>
      )}

      <div className="mt-3">
        <Field label={t.note}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} rows={2} className={`${ui.field} py-2`} />
        </Field>
      </div>

      {priceMovedMessage && (
        <div role="alert" className="mt-4">
          <InlineError>
            {priceMovedMessage} {t.totalChangedHint}
          </InlineError>
        </div>
      )}

      {lines.length > 0 && !quoteFailed ? (
        <dl className="mt-4 text-sm">
          <div className="flex justify-between gap-2 py-0.5">
            <dt className="text-stone-700">{t.goodsSubtotal}</dt>
            <dd data-testid="ctv-order-goods" className="tabular-nums text-stone-900">
              {formatVnd(goods)}
            </dd>
          </div>
          <div className="flex justify-between gap-2 py-0.5">
            <dt className="text-stone-700">{t.shippingFee}</dt>
            <dd data-testid="ctv-order-shipping" className="tabular-nums text-stone-900">
              {quote ? formatVnd(quote.shippingFee) : t.calculating}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1.5">
            <dt className="text-stone-700">{t.customerTotal}</dt>
            <dd data-testid="ctv-order-total" className="font-display text-lg font-bold tabular-nums text-forest-700">
              {quote ? formatVnd(quote.total) : t.calculating}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm text-stone-600">{t.goodsSubtotal}</div>
            <div className="text-xs text-stone-600">{t.shipNote}</div>
          </div>
          <span data-testid="ctv-order-goods" className="font-display text-lg font-bold tabular-nums text-forest-700">
            {formatVnd(goods)}
          </span>
        </div>
      )}

      {checking && (
        <div role="status" className="mt-3 text-xs text-stone-700">
          {t.checking}
        </div>
      )}
      {unconfirmedKey && !mut.isPending && (
        <div role="alert" className="mt-3">
          <div className="text-xs text-warning-fg">{resendSameOrder ? t.unconfirmed : t.unconfirmedChanged}</div>
          {!resendSameOrder && (
            <Link href={ordersHref} onClick={onClose} className={ui.btnText}>
              {t.viewOrders}
            </Link>
          )}
        </div>
      )}
      <div role="alert">{submitError && <p className={`mt-3 ${ui.error}`}>{submitError}</p>}</div>
      <button
        type="button"
        onClick={submit}
        aria-busy={mut.isPending}
        disabled={(showErrors && !valid) || quotePending || mut.isPending}
        className={`${ui.btnPrimary} mt-3 w-full`}
      >
        {mut.isPending ? 'Đang tạo đơn…' : resendSameOrder ? t.resend : t.submit}
      </button>
    </Sheet>
  );
}

const chip = (selected: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-sm ${
    selected ? 'border-forest-600 bg-forest-50 font-semibold text-forest-700' : 'border-stone-450 bg-stone-0 text-stone-800'
  }`;

function GroupLabel({ children, className = '' }: { children: string; className?: string }) {
  return <div className={`mb-1.5 text-xs font-semibold text-stone-600 ${className}`}>{children}</div>;
}

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 flex items-center gap-1 text-xs text-danger-fg">
      <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="inline-flex h-11 w-11 items-center justify-center rounded-control border border-stone-200 text-stone-800 hover:bg-stone-50">
      {children}
    </button>
  );
}

/** Tìm sản phẩm → chọn phân loại → thêm dòng. */
function ProductVariationPicker({ onAdd }: { onAdd: (v: VariationDetail, productName: string) => void }) {
  const [q, setQ] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const dq = useDebounced(q, SUGGEST_DEBOUNCE_MS);

  // Cổng xét cả từ khoá đang gõ (chưa debounce): xoá bớt xuống dưới 2 ký tự thì ẩn gợi ý ngay.
  const canSuggest = isSuggestable(q) && isSuggestable(dq);
  const tooShort = q.trim() !== '' && !isSuggestable(q);

  const suggestQ = useQuery({ ...suggestQuery(coreHttp, dq), queryKey: ['ctv-suggest', dq], enabled: canSuggest && !slug });
  const detailQ = useQuery({ ...productQuery(coreHttp, slug ?? ''), enabled: !!slug });

  const reset = () => {
    setSlug(null);
    setQ('');
  };

  if (slug) {
    const p = detailQ.data;
    return (
      <div className="mt-2 rounded-control bg-stone-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-stone-900">{p?.name ?? t.chooseVariation}</span>
          <button type="button" onClick={reset} className={ui.btnText}>
            {t.close}
          </button>
        </div>
        {detailQ.isLoading ? (
          <p className="text-xs text-stone-600">Đang tải…</p>
        ) : detailQ.isError ? (
          <div role="alert" className="text-xs text-danger-fg">
            Không tải được dữ liệu.{' '}
            <button type="button" onClick={() => void detailQ.refetch()} className={ui.btnText}>
              Thử lại
            </button>
          </div>
        ) : (
          <ul>
            {(p?.variations ?? []).map((v) => {
              const out = v.stock <= 0;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    disabled={out}
                    onClick={() => {
                      onAdd(v, p!.name);
                      reset();
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-2 text-left disabled:opacity-50"
                  >
                    <span className="text-sm text-stone-900">{v.name}</span>
                    <span className={`text-xs font-semibold ${out ? 'text-stone-600' : 'text-forest-700'}`}>{out ? t.outOfStock : formatVnd(v.salePrice ?? v.retailPrice)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  const results: ProductSuggestion[] = suggestQ.data ?? [];
  return (
    <div className="mt-2">
      <input type="search" aria-label={t.searchProduct} placeholder={t.searchProduct} value={q} onChange={(e) => setQ(e.target.value)} className={ui.field} />
      {tooShort && <div className="mt-1 text-xs text-stone-600">{t.suggestMinChars}</div>}
      {canSuggest && (
        <div className="mt-1">
          {suggestQ.isError ? (
            <div role="alert" className="text-xs text-danger-fg">
              Không tải được dữ liệu.{' '}
              <button type="button" onClick={() => void suggestQ.refetch()} className={ui.btnText}>
                Thử lại
              </button>
            </div>
          ) : (
            <>
              <ul>
                {results.map((p) => (
                  <li key={p.slug}>
                    <button type="button" onClick={() => setSlug(p.slug)} className="flex min-h-11 w-full items-center gap-2 text-left">
                      <ProductThumb src={p.thumbnail} alt="" size={32} />
                      <span className="min-w-0 flex-1 text-sm text-stone-900">{p.name}</span>
                      <span className="text-xs font-semibold text-forest-700">{formatVnd(p.basePrice)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {results.length === 0 && !suggestQ.isFetching && <div className="py-2 text-center text-xs text-stone-600">{t.noProductsFound}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
