'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Zap } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { parseVnContactPhone, parseVnPhoneInput } from '@tubutree/app-core/phone-input';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { comboOnlyDiscount } from '@tubutree/app-core/commerce/green-box';
import { GeoPicker, type GeoValue } from '@/components/geo-picker';
import { GiftTrialRow } from '@/components/checkout/gift-rows';
import { GuestField } from '@/components/checkout/guest-field';
import { DesktopLines, MobileItems, NO_LINE_FIX, RECALC_DIM, Row, type CheckoutLineView } from '@/components/checkout/checkout-lines';
import { OrderConsent } from '@/components/order-consent';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { miniRadio, miniRadioGutter, mini } from '@/components/order-mobile/mobile-ui';
import { trackWebEvent } from '@/lib/analytics';
import { ApiError } from '@/lib/client-api';
import { actionErrorText } from '@/lib/error-text';
import { formatVnd } from '@/lib/format-vnd';
import { ui, uiBar } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';
import { createOrderKeyRing } from '@/lib/order-key-ring';
import { useGuestCartProducts } from '@/lib/guest-cart/products';
import { clearGuestCart } from '@/lib/guest-cart/store';
import { useGuestCartLines } from '@/lib/guest-cart/use-guest-cart';
import { guestCartView } from '@/lib/guest-cart/view';
import { useRunningFlash } from '@/lib/use-flash-sales';
import { guestPlaceOrder, guestQuote, type GuestAddressInput, type GuestLineInput, type GuestPlaceBody } from '@/lib/guest-checkout/api';
import { guestCopy } from '@/lib/guest-checkout/copy';
import { clearGuestDraft, readGuestDraft, saveGuestDraft } from '@/lib/guest-checkout/draft';
import { guestBankHref, guestTrackHref, newTrackingKey, rememberGuestOrder, savedGuestOrderKey } from '@/lib/guest-checkout/keys';

const NAME_MAX = 120;
const STREET_MAX = 255;
const NOTE_MAX = 500;
/** Chờ khách ngừng gõ rồi mới báo giá: mỗi lần báo giá chép giỏ lên máy chủ, và đường báo giá có trần 30 lần/phút mỗi IP. */
const QUOTE_DEBOUNCE_MS = 600;
const LOGIN_RETURN = loginHref('/thanh-toan');

type Pay = 'COD' | 'BANK_TRANSFER';
type Field = 'name' | 'phone' | 'province' | 'ward' | 'street';
const FIELD_ORDER: readonly Field[] = ['name', 'phone', 'province', 'ward', 'street'];

// Điện thoại: dòng phẳng không viền như Mini App; từ md: thẻ có viền như thanh toán của tài khoản.
const OPTION_BASE =
  'flex min-h-11 cursor-pointer items-center gap-3 py-3 text-sm md:rounded-control md:border md:p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--color-border-focus)]';
const payOptionClass = (selected: boolean) =>
  `${OPTION_BASE} ${selected ? 'md:border-[var(--color-border-selected)] md:bg-[var(--color-bg-subtle)]' : 'md:border-[var(--color-border-strong)] md:bg-[var(--color-bg-surface)]'}`;
const BAND = `mt-2 p-4 md:mt-3 ${ui.card} ${mini.band}`;
// Dòng chữ đứng ngoài thẻ: ở điện thoại nằm trên dải trắng tràn ngang như các khối khác.
const LOOSE_LINE = 'bg-[var(--color-bg-surface)] px-4 text-sm md:bg-transparent md:px-0';

function fieldErrors(v: { name: string; phone: string; geo: GeoValue; street: string }): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (!v.name.trim()) e.name = guestCopy('nameMissing');
  if (!parseVnContactPhone(v.phone)) e.phone = guestCopy('phoneInvalid');
  if (!v.geo.provinceCode) e.province = guestCopy('provinceMissing');
  if (!v.geo.wardCode) e.ward = guestCopy('wardMissing');
  if (!v.street.trim()) e.street = guestCopy('streetMissing');
  return e;
}

/** Lỗi đặt đơn có lời cho khách từ máy chủ (trần, COD trên mức, thiết bị đã gắn tài khoản): hiện nguyên câu và mời đăng nhập. */
const LOGIN_HINT_CODES = new Set(['GUEST_LIMIT', 'GUEST_LOGIN_REQUIRED']);

/**
 * Thanh toán không đăng nhập trên web (cờ `web.guest_checkout_enabled`): một biểu mẫu (họ tên, SĐT, địa chỉ, ghi chú, cách trả tiền) và đúng một
 * nút Đặt hàng. Giỏ nằm trong trình duyệt (giỏ khách); máy chủ tính tiền như tài khoản thường không mã, không Điểm Xanh. Giá Giờ vàng như mọi
 * khách, giới hạn mỗi suất đếm theo SĐT nhận hàng và IP: hết suất thì phần vượt tính giá thường và báo một dòng.
 * Đặt xong chuyển tới trang theo dõi `/don/<mã>#k=<khoá>` (COD) hoặc trang QR chuyển khoản mở bằng cùng khoá.
 */
export function GuestCheckout({ welcomeAmount }: { welcomeAmount: number | null }) {
  const router = useRouter();
  const lines = useGuestCartLines();
  const slugs = useMemo(() => [...new Set(lines.map((l) => l.slug))], [lines]);
  const products = useGuestCartProducts(slugs);
  const { flash } = useRunningFlash();
  const view = guestCartView(lines, products, flash);
  const buyable: GuestLineInput[] = view.rows.filter((r) => r.state === 'ok').map((r) => ({ variationId: r.variationId, quantity: r.quantity }));

  // Trang chỉ dựng ở trình duyệt (dynamic ssr:false) nên đọc nháp ngay lúc khởi tạo, không lệch với HTML máy chủ.
  const [draft] = useState(readGuestDraft);
  const [name, setName] = useState(draft.name);
  const [phone, setPhone] = useState(draft.phone);
  const [geo, setGeo] = useState<GeoValue>(draft.geo);
  const [street, setStreet] = useState(draft.street);
  const [note, setNote] = useState(draft.note);
  const [payment, setPayment] = useState<Pay>('COD');
  const [gift, setGift] = useState<string | null | undefined>(undefined);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLInputElement>(null);
  const openedAt = useRef(Date.now());
  const keyRing = useRef(createOrderKeyRing());
  const trackingKeys = useRef(new Map<string, string>());
  const ids = { name: useId(), phone: useId(), street: useId(), note: useId(), pay: useId() };

  const started = useRef(false);
  useEffect(() => {
    if (started.current || lines.length === 0) return;
    started.current = true;
    trackWebEvent('guest_checkout_start', { itemCount: Math.min(500, lines.reduce((s, l) => s + l.quantity, 0)) });
  }, [lines]);

  const placed = useRef(false);
  useEffect(() => {
    if (!placed.current) saveGuestDraft({ name, phone, geo, street, note });
  }, [name, phone, geo, street, note]);

  const errors = fieldErrors({ name, phone, geo, street });
  const shown = (f: Field) => (attempted || touched[f] ? errors[f] : undefined);
  const touch = (f: Field) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }));
  const formValid = Object.keys(errors).length === 0;
  const normalizedPhone = parseVnContactPhone(phone);

  const address: GuestAddressInput | null =
    formValid && normalizedPhone
      ? {
          recipient: name.trim(),
          phone: normalizedPhone,
          province: geo.province,
          district: '',
          ward: geo.ward,
          street: street.trim(),
          provinceCode: geo.provinceCode,
          districtCode: '',
          wardCode: geo.wardCode,
        }
      : null;
  const quoteInput = address && buyable.length > 0 && view.settled ? JSON.stringify({ lines: buyable, address }) : null;
  const [settledInput, setSettledInput] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSettledInput(quoteInput), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [quoteInput]);
  const quoteQ = useQuery({
    queryKey: ['guest-quote', settledInput],
    queryFn: () => guestQuote(JSON.parse(settledInput!) as { lines: GuestLineInput[]; address: GuestAddressInput }),
    enabled: settledInput !== null,
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const quote = settledInput !== null ? quoteQ.data : undefined;
  const quoteFresh = !!quote && settledInput === quoteInput && !quoteQ.isPlaceholderData && !quoteQ.isFetching;
  const blocked = quote?.blockedPaymentMethods ?? {};
  useEffect(() => {
    if (payment === 'COD' && blocked.COD && !blocked.BANK_TRANSFER) setPayment('BANK_TRANSFER');
  }, [payment, blocked.COD, blocked.BANK_TRANSFER]);

  const place = useMutation({
    mutationFn: async (vars: { body: Omit<GuestPlaceBody, 'trackingKey' | 'fillMs' | 'website'>; idem: string; trackingKey: string }) => {
      const res = await guestPlaceOrder(
        { ...vars.body, trackingKey: vars.trackingKey, website: trapRef.current?.value ?? '', fillMs: Date.now() - openedAt.current },
        vars.idem,
      );
      return { res, trackingKey: vars.trackingKey };
    },
    onSuccess: ({ res, trackingKey }) => {
      const key = res.keyAccepted ? trackingKey : (savedGuestOrderKey(res.code) ?? trackingKey);
      rememberGuestOrder(res.codes.length > 0 ? res.codes : [res.code], key);
      placed.current = true;
      clearGuestDraft();
      keyRing.current.reset();
      trackingKeys.current.clear();
      clearGuestCart();
      router.replace(res.paymentMethod === 'BANK_TRANSFER' ? guestBankHref(res.code, key) : guestTrackHref(res.code, key));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'TOTAL_CHANGED') void quoteQ.refetch();
    },
  });

  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const onPlace = () => {
    if (place.isPending || place.isSuccess) return;
    setAttempted(true);
    if (!formValid || !address) {
      setFocusTick((n) => n + 1);
      return;
    }
    if (!quoteFresh || !quote || blocked[payment]) return;
    const body = {
      lines: buyable,
      address,
      paymentMethod: payment,
      expectedTotal: quote.total,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(gift !== undefined ? { giftVariationId: gift } : {}),
    };
    const idem = keyRing.current.keyFor(body);
    let trackingKey = trackingKeys.current.get(idem);
    if (!trackingKey) {
      trackingKey = newTrackingKey();
      trackingKeys.current.set(idem, trackingKey);
    }
    place.mutate({ body, idem, trackingKey });
  };

  const items: CheckoutLineView[] = quote
    ? quote.items.map((it) => ({ ...it, variationName: it.variationName ?? '' }))
    : view.rows
        .filter((r) => r.state === 'ok')
        .map((r) => ({
          id: r.variationId,
          productName: r.productName ?? fillCopy('guestCart.itemFallback'),
          variationName: r.variationName ?? '',
          quantity: r.quantity,
          unitPrice: r.unitPrice ?? 0,
          total: r.total,
          thumbnail: r.thumbnail,
        }));
  const subtotal = quote?.subtotal ?? view.subtotal;
  const comboOnly = quote ? comboOnlyDiscount(quote) : 0;
  const greenBox = quote?.greenBoxDiscount ?? 0;
  const otherDiscount = quote?.discount ?? 0;
  const recalculating = quoteQ.isFetching || (quoteInput !== null && settledInput !== quoteInput);
  const totalText = quote ? formatVnd(quote.total) : fillCopy('checkout.totalPending');
  const shipText = quote ? (quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)) : fillCopy('checkout.shipNeedsAddress');
  const giftSummary = quote?.giftTrial
    ? { ...quote.giftTrial, ...(gift !== undefined ? { selectedVariationId: gift, declined: gift === null } : {}) }
    : undefined;

  const placeError = place.error;
  const placeErrorText = placeError
    ? placeError instanceof ApiError && placeError.code === 'TOTAL_CHANGED'
      ? fillCopy('checkout.priceUpdated', { price: quote ? formatVnd(quote.total) : '' })
      : actionErrorText(placeError)
    : null;
  const loginHint = placeError instanceof ApiError && !!placeError.code && LOGIN_HINT_CODES.has(placeError.code);
  const hint = !formValid && attempted
    ? guestCopy('fixForm')
    : formValid && quoteQ.isError && !recalculating
      ? guestCopy('quoteFailed')
      : null;
  const busy = place.isPending || place.isSuccess;
  const placeLabel = busy ? guestCopy('placing') : quote && quoteFresh ? fillCopy('checkout.placeWith', { price: formatVnd(quote.total) }) : guestCopy('place');
  const placeDisabled = busy || (formValid && (!quoteFresh || !!blocked[payment]));

  if (lines.length > 0 && view.settled && buyable.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[color:var(--color-text-secondary)]">{fillCopy('checkout.selectionLostBody')}</p>
        <Link href="/gio-hang" className={`mt-4 inline-block ${ui.btnPrimary}`}>
          {fillCopy('checkout.lineToCart')}
        </Link>
      </div>
    );
  }

  const placeButton = (className: string) => (
    <button
      type="button"
      onClick={onPlace}
      disabled={placeDisabled}
      aria-busy={place.isPending || undefined}
      data-testid="guest-place-order"
      className={className}
    >
      {placeLabel}
    </button>
  );

  return (
    <>
      <div className="grid gap-0 md:gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]" data-testid="guest-checkout">
        <div ref={formRef} className="min-w-0">
          {welcomeAmount !== null && (
            <p className={`${LOOSE_LINE} pt-3 md:pt-0`}>
              <Link href={LOGIN_RETURN} data-testid="guest-login-link" className="flex min-h-11 items-center font-semibold text-[color:var(--color-text-brand)] underline">
                {guestCopy('loginLine', { amount: formatVnd(welcomeAmount) })}
              </Link>
            </p>
          )}
          {/* Vùng báo luôn có mặt, chỉ đổi nội dung: vùng role=status gắn cùng lúc với chữ thì nhiều trình đọc màn hình không đọc. */}
          <div role="status">
            {quote?.flashNotice && (
              <p data-testid="guest-flash-limit" className={`${LOOSE_LINE} flex min-h-11 items-center gap-1.5 pb-1 md:mt-2 md:pb-0`}>
                <Zap size={14} aria-hidden="true" className="shrink-0 text-[color:var(--color-text-brand)]" />
                {guestCopy('flashLimit')}
              </p>
            )}
          </div>

          <section aria-labelledby={`${ids.name}-h`} className={BAND}>
            <h2 id={`${ids.name}-h`} className={`${ui.sectionTitle} ${mini.sectionLabel}`}>
              {guestCopy('contactTitle')}
            </h2>
            <div className="mt-2 space-y-3">
              <GuestField id={ids.name} label={guestCopy('name')} error={shown('name')}>
                <input
                  id={ids.name}
                  value={name}
                  maxLength={NAME_MAX}
                  autoComplete="name"
                  aria-required="true"
                  aria-invalid={shown('name') ? true : undefined}
                  aria-describedby={shown('name') ? `${ids.name}-err` : undefined}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => touch('name')}
                  disabled={busy}
                  className={`${shown('name') ? ui.fieldError : ui.field} mt-1`}
                />
              </GuestField>
              <GuestField id={ids.phone} label={guestCopy('phone')} error={shown('phone')} hint={guestCopy('phoneHint')}>
                <input
                  id={ids.phone}
                  value={phone}
                  maxLength={20}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-required="true"
                  aria-invalid={shown('phone') ? true : undefined}
                  aria-describedby={`${ids.phone}-hint${shown('phone') ? ` ${ids.phone}-err` : ''}`}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => {
                    touch('phone');
                    setPhone((p) => parseVnPhoneInput(p) ?? p);
                  }}
                  disabled={busy}
                  className={`${shown('phone') ? ui.fieldError : ui.field} mt-1 tabular-nums`}
                />
              </GuestField>
              <GeoPicker value={geo} onChange={setGeo} errorProvince={shown('province')} errorWard={shown('ward')} />
              <GuestField id={ids.street} label={guestCopy('street')} error={shown('street')}>
                <input
                  id={ids.street}
                  value={street}
                  maxLength={STREET_MAX}
                  autoComplete="street-address"
                  aria-required="true"
                  aria-invalid={shown('street') ? true : undefined}
                  aria-describedby={shown('street') ? `${ids.street}-err` : undefined}
                  onChange={(e) => setStreet(e.target.value)}
                  onBlur={() => touch('street')}
                  disabled={busy}
                  className={`${shown('street') ? ui.fieldError : ui.field} mt-1`}
                />
              </GuestField>
              <GuestField id={ids.note} label={guestCopy('note')}>
                <input
                  id={ids.note}
                  value={note}
                  maxLength={NOTE_MAX}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                  className={`${ui.field} mt-1`}
                />
              </GuestField>
              {/* Ô bẫy cho máy tự điền: ẩn khỏi người dùng và trình đọc màn hình, không nhận Tab. */}
              <div aria-hidden="true" className="sr-only">
                <label>
                  Website
                  <input ref={trapRef} name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
                </label>
              </div>
            </div>
          </section>

          <section className={BAND} aria-labelledby={`${ids.pay}-h`}>
            <h2 id={`${ids.pay}-h`} className={`${ui.sectionTitle} ${mini.sectionLabel}`}>
              {guestCopy('payTitle')}
            </h2>
            <div role="radiogroup" aria-labelledby={`${ids.pay}-h`} className="mt-2 space-y-2">
              {(['COD', 'BANK_TRANSFER'] as const).map((k) => {
                const reason = blocked[k];
                return (
                  <div key={k}>
                    <label className={`${payOptionClass(payment === k)} ${reason ? 'cursor-not-allowed' : ''}`}>
                      <input
                        type="radio"
                        name="guest-pay"
                        checked={payment === k}
                        onChange={() => setPayment(k)}
                        disabled={!!reason || busy}
                        aria-describedby={reason ? `${ids.pay}-${k}` : undefined}
                        className={`${miniRadio} ${miniRadioGutter} ${reason ? 'opacity-[0.45] md:opacity-60' : ''}`}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className={reason ? 'opacity-[0.45] md:opacity-60' : undefined}>
                          {guestCopy(k === 'COD' ? 'cod' : 'bank')}
                        </span>
                        {reason && (
                          <span id={`${ids.pay}-${k}`} data-testid={`guest-pay-blocked-${k}`} className="text-caption text-[color:var(--color-text-secondary)]">
                            {reason}
                          </span>
                        )}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className={`mt-2 h-fit p-4 md:mt-3 ${ui.card} ${mini.band} lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:self-start`}>
          <h2 className={`hidden md:block ${ui.sectionTitle}`}>Đơn hàng</h2>
          <MobileItems items={items} shipments={null} splitNote={null} fix={NO_LINE_FIX} />
          <DesktopLines items={items} shipments={null} fix={NO_LINE_FIX} />
          <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-2">
            <Row ds="checkout-summary-row" label="Tạm tính" value={formatVnd(subtotal)} />
            {comboOnly > 0 && <Row label="Ưu đãi combo" value={`-${formatVnd(comboOnly)}`} green />}
            {greenBox > 0 && <Row label={fillCopy('greenBox.name')} value={`-${formatVnd(greenBox)}`} green />}
            {otherDiscount > 0 && <Row label="Giảm giá" value={`-${formatVnd(otherDiscount)}`} green />}
            <Row label="Phí vận chuyển" value={shipText} valueGreen={quote?.shippingFee === 0} dim={recalculating} />
            {giftSummary && <GiftTrialRow summary={giftSummary} showLocked={false} onChoose={setGift} busy={busy} />}
          </div>
          <div className="mt-3 flex justify-between border-t border-[var(--color-border-subtle)] pt-3 font-bold text-[color:var(--color-text-primary)]">
            <span>Tổng cộng</span>
            <span data-testid="guest-total" className={`tabular-nums ${recalculating ? RECALC_DIM : ''}`}>
              {totalText}
            </span>
          </div>
          {quoteQ.isError && !recalculating && (
            <p className={`mt-2 ${ui.error}`}>
              {quoteQ.error instanceof ApiError && quoteQ.error.status === 400 ? actionErrorText(quoteQ.error) : guestCopy('quoteFailed')}{' '}
              <button type="button" onClick={() => void quoteQ.refetch()} className="font-semibold underline">
                {fillCopy('guestCart.retry')}
              </button>
            </p>
          )}
          <div className="hidden lg:block">
            <OrderConsent className="mt-3" />
            {placeButton(`${ui.btnPrimary} mt-3 w-full tabular-nums`)}
          </div>
          <p role="status" className={hint ? 'mt-2 hidden text-caption text-[color:var(--color-text-secondary)] lg:block' : 'sr-only'}>
            {hint}
          </p>
          {placeErrorText && (
            <div role="alert" data-testid="guest-place-error" className={`mt-2 flex items-start gap-1.5 ${ui.error}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {placeErrorText}
                {loginHint && (
                  <>
                    {' '}
                    <Link href={LOGIN_RETURN} className="font-semibold underline">
                      Đăng nhập Zalo
                    </Link>
                  </>
                )}
              </span>
            </div>
          )}
          <OrderConsent className="pt-3 lg:hidden" />
        </div>
      </div>

      <StickyActionBar label={guestCopy('place')} hideFrom="lg">
        <div className="md:mx-auto md:max-w-2xl">
          {hint && (
            <p aria-hidden="true" className="mb-2 text-caption text-[color:var(--color-text-secondary)]">
              {hint}
            </p>
          )}
          {placeButton(`${uiBar.primary} w-full`)}
        </div>
      </StickyActionBar>
    </>
  );
}
