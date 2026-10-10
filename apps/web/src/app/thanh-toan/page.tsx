'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { GeoPicker, EMPTY_GEO, type GeoValue } from '@/components/geo-picker';
import {
  getCart,
  getAddresses,
  createAddress,
  checkoutQuote,
  placeOrder,
  getPublicConfig,
  formatVnd,
  type AddressDTO,
  type OrderDTO,
} from '@/lib/shop-client';
import { ctvSlugFor, getStorefrontContext } from '@/lib/storefront-context';
import { recyclingCheckoutFields } from '@/lib/recycling';
import { checkoutPointsOffer } from '@/lib/checkout-points';
import { orderDetailHref } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { RecyclingCheckoutSection } from '@/components/recycling-checkout';
import { RecyclingStatus } from '@/components/recycling-status';
import { CouponBox, COUPON_MUTATION_KEY } from '@/components/coupon-box';
import { BankTransferPanel } from './bank-transfer-panel';

const VN_PHONE = /^(0|\+84)\d{9}$/;
// Tỉnh/phường chọn qua GeoPicker (mã Pancake thật, hệ 2 cấp — không còn quận/huyện);
// chỉ 3 field text còn lại (mirror miniapp address-section.tsx).
const EMPTY = { recipient: '', phone: '', street: '' };
type Form = typeof EMPTY;

const OPTION_BASE = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-control border p-3 text-sm';
const optionClass = (selected: boolean) =>
  `${OPTION_BASE} ${selected ? 'border-forest-600 bg-forest-50' : 'border-stone-450 bg-stone-0'}`;

export default function CheckoutPage() {
  const { status } = useAuth();
  const qc = useQueryClient();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [placed, setPlaced] = useState<OrderDTO | null>(null);
  const [idemKey] = useState(() => (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random())));

  const cartQ = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: status === 'authenticated' });
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: status === 'authenticated' });

  useEffect(() => {
    if (addrQ.data && addressId === null) {
      const def = addrQ.data.find((a) => a.isDefault) ?? addrQ.data[0];
      if (def) setAddressId(def.id);
    }
  }, [addrQ.data, addressId]);

  // Gian hàng đang mua qua — quyết định combo giảm giá và việc CTV có được ghi nhận đơn hay
  // không. Đọc một lần khi mount: sessionStorage không phải state phản ứng, và giá trị chỉ đổi
  // khi khách đi qua một gian hàng khác (tức là đã rời trang này).
  const [sfCtx] = useState(() => getStorefrontContext());
  // CHỈ gian hàng CTV mới gắn vào đơn — xem ghi chú ở StorefrontContext.kind.
  const ctvSlug = ctvSlugFor(sfCtx);
  // Điểm Xanh: Mini App cho tiêu, web thì không — cùng một giỏ mà mua trên web đắt hơn.
  const [usePoints, setUsePoints] = useState(false);
  // Quote đầu tiên (pointsToUse = 0) trả về số điểm DÙNG ĐƯỢC (redeemablePoints = số dư − điểm đơn còn
  // trong hạn/đang chờ xử lý đổi-trả; backend kẹp đúng theo số này) để biết khách dùng được bao nhiêu.
  // PHẢI là state: dùng useRef thì lần ghi trong effect không kích hoạt render nào nữa, mà render
  // có quote chính là render cuối của luồng khởi động (refetchOnWindowFocus đang tắt) — ô "Dùng
  // Điểm Xanh" sẽ KHÔNG BAO GIỜ hiện, tức tính năng vừa thêm không dùng được.
  const [pointsOffer, setPointsOffer] = useState<{ usable: number; lockNote: string | null }>({ usable: 0, lockNote: null });
  const usablePoints = pointsOffer.usable;
  // Thu gom vật liệu tái chế: CHỈ hiện khi BE xác nhận tính năng đang chạy (Gomdon đã cấu hình + admin
  // bật). Chưa tải xong / lỗi / API cũ không có field → coi như tắt: không hứa thu gom khi không ai đi thu.
  const publicQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
  const recyclingEnabled = publicQ.data?.recyclingEnabled === true;
  const [hasRecyclingPickup, setHasRecyclingPickup] = useState(false);
  const [recyclingNote, setRecyclingNote] = useState('');

  // Mã giảm giá đổi trên giỏ nên báo giá đang hiện đã cũ cho tới khi tính lại xong: khoá nút đặt hàng
  // trong lúc đó để khách không bấm đặt khi con số trên màn hình chưa phải con số sẽ bị tính.
  const couponChanging = useIsMutating({ mutationKey: COUPON_MUTATION_KEY }) > 0;
  const quoteQ = useQuery({
    queryKey: ['quote', addressId, ctvSlug, usePoints],
    queryFn: () =>
      checkoutQuote(addressId!, usePoints ? usablePoints : 0, ctvSlug),
    enabled: !!addressId && status === 'authenticated',
  });
  useEffect(() => {
    // Giữ lại số điểm dùng được của lần quote gần nhất — khi bật "dùng điểm", BE tự kẹp theo trần
    // loyalty.max_redeem_pct nên gửi toàn bộ số dùng được là an toàn.
    if (quoteQ.data && !usePoints) setPointsOffer(checkoutPointsOffer(quoteQ.data));
  }, [quoteQ.data, usePoints]);

  const quoteStale = couponChanging || quoteQ.isFetching;

  const place = useMutation({
    mutationFn: () =>
      placeOrder(
        {
          addressId: addressId!,
          paymentMethod: payment,
          pointsToUse: usePoints ? usablePoints : 0,
          storefrontSlug: ctvSlug,
          referralCode: sfCtx.referralCode ?? undefined,
          // Chỉ có khoá khi bật + chọn (API forbidNonWhitelisted; tắt thì body y hệt bản cũ).
          ...recyclingCheckoutFields(recyclingEnabled, hasRecyclingPickup, recyclingNote),
        },
        idemKey,
      ),
    onSuccess: (order) => {
      setPlaced(order);
      void qc.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  if (status === 'idle' || status === 'loading') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <p className="text-stone-600">Đang tải…</p>
        </div>
      </Shell>
    );
  }

  if (status !== 'authenticated') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <p className="text-stone-700">Vui lòng đăng nhập để thanh toán.</p>
          <Link href="/dang-nhap" className={`${ui.btnPrimary} mt-4`}>
            Đăng nhập với Zalo
          </Link>
        </div>
      </Shell>
    );
  }

  if (placed) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
            <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
          </div>
          <h2 className="mt-5 font-display text-2xl font-semibold text-stone-900">Đặt hàng thành công!</h2>
          <p className="mt-2 text-stone-700">
            Mã đơn <span className="font-semibold text-forest-700">{placed.code}</span> · {formatVnd(placed.total)}
          </p>
          {placed.hasRecyclingPickup && (
            <div className="mx-auto mt-3 max-w-md text-left">
              <RecyclingStatus order={placed} />
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={orderDetailHref(placed.code)} className={ui.btnPrimary}>
              Xem chi tiết đơn
            </Link>
            <Link href="/tai-khoan" className={ui.btnSecondary}>
              Đơn của tôi
            </Link>
            <Link href="/" className={ui.btnSecondary}>
              Tiếp tục mua sắm
            </Link>
          </div>
        </div>
        {/* A2-02 = A6-01: đơn CHUYỂN KHOẢN hiện QR/STK/nội dung CK ngay sau khi đặt để khách trả liền;
            nếu đóng tab, trang chi tiết đơn (`/tai-khoan/don-hang/[code]`) dựng lại đúng khung này. */}
        <div className="mx-auto max-w-md">
          <BankTransferPanel order={placed} />
        </div>
      </Shell>
    );
  }

  const cart = cartQ.data;
  // Refetch lỗi vẫn giữ `data` của lần trước (React Query v5): không coi đó là báo giá hiện hành, nếu không
  // khách thấy số cũ trong khi server đã tính theo mã mới và nút Đặt hàng vẫn bật.
  const quote = quoteQ.isError ? undefined : quoteQ.data;

  return (
    <Shell>
      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <section className={`p-4 ${ui.card}`}>
            <h2 className={ui.sectionTitle}>Địa chỉ giao hàng</h2>
            {addrQ.isError && (
              <p className={`mt-2 ${ui.error}`}>
                Không tải được danh sách địa chỉ.{' '}
                <button type="button" onClick={() => void addrQ.refetch()} className={ui.btnText}>
                  Thử lại
                </button>
              </p>
            )}
            <AddressPicker
              addresses={addrQ.data ?? []}
              selectedId={addressId}
              onSelect={setAddressId}
              onCreated={(a) => {
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                setAddressId(a.id);
              }}
            />
          </section>

          <section className={`p-4 ${ui.card}`}>
            <h2 className={ui.sectionTitle}>Phương thức thanh toán</h2>
            <div className="mt-2 space-y-2">
              {[
                { k: 'COD', label: 'Thanh toán khi nhận hàng (COD)' },
                { k: 'BANK_TRANSFER', label: 'Chuyển khoản ngân hàng' },
              ].map((p) => (
                <label key={p.k} className={optionClass(payment === p.k)}>
                  <input
                    type="radio"
                    name="pay"
                    checked={payment === p.k}
                    onChange={() => setPayment(p.k)}
                    className="h-4 w-4 accent-forest-600"
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </section>

          {recyclingEnabled && (
            <RecyclingCheckoutSection
              selected={hasRecyclingPickup}
              onSelectedChange={setHasRecyclingPickup}
              note={recyclingNote}
              onNoteChange={setRecyclingNote}
              paymentMethod={payment}
              disabled={place.isPending}
            />
          )}
        </div>

        <div className={`h-fit p-4 ${ui.card}`}>
          <h2 className={ui.sectionTitle}>Đơn hàng</h2>
          {/* Vùng cuộn phải focus được bằng bàn phím (axe scrollable-region-focusable). */}
          <div
            role="region"
            aria-label="Sản phẩm trong đơn"
            tabIndex={0}
            className="mt-2 max-h-40 space-y-1 overflow-auto text-sm"
          >
            {cart?.items.map((it) => (
              <div key={it.id} className="flex justify-between gap-2">
                <span className="text-stone-600">{it.productName} ×{it.quantity}</span>
                <span className="text-stone-900">{formatVnd(it.total)}</span>
              </div>
            ))}
          </div>
          <Row label="Tạm tính" value={formatVnd(quote?.subtotal ?? cart?.subtotal ?? 0)} />
          {(quote?.discount ?? 0) > 0 && (
            <Row label={`Giảm giá${cart?.couponCode ? ` (${cart.couponCode})` : ''}`} value={`-${formatVnd(quote!.discount)}`} green />
          )}
          {(quote?.pointsDiscount ?? 0) > 0 && (
            <Row label={`Điểm Xanh (${quote!.pointsUsed})`} value={`-${formatVnd(quote!.pointsDiscount)}`} green />
          )}
          <Row label="Phí vận chuyển" value={quote ? (quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)) : '…'} />
          {cart && <CouponBox currentCode={cart.couponCode} subtotal={cart.subtotal} disabled={place.isPending} />}
          {usablePoints > 0 && (
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-forest-200 bg-forest-50 p-3 text-sm">
              <input
                type="checkbox"
                checked={usePoints}
                onChange={(e) => setUsePoints(e.target.checked)}
                className="h-4 w-4 accent-forest-600"
              />
              <span className="text-forest-800">
                Dùng {usablePoints} Điểm Xanh
              </span>
            </label>
          )}
          {pointsOffer.lockNote && <p className="mt-1 text-xs text-stone-600">{pointsOffer.lockNote}</p>}
          <div className="mt-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900">
            <span>Tổng cộng</span>
            {/* Đang tải/đang lỗi thì hiện "…" thay vì 0đ: con số 0 đứng yên cạnh dòng báo lỗi
                trông như đơn không mất tiền. */}
            <span>{quote ? formatVnd(quote.total) : '…'}</span>
          </div>
          {quote && quote.pointsEarned > 0 && (
            <p className="mt-1 text-xs text-success-fg">+{quote.pointsEarned} Điểm Xanh sau khi giao</p>
          )}
          {quoteQ.isError && (
            <p className={`mt-2 ${ui.error}`}>
              Không tính được phí ship/tổng tiền.{' '}
              <button type="button" onClick={() => void quoteQ.refetch()} className={ui.btnText}>
                Thử lại
              </button>
            </p>
          )}
          {cartQ.isError && (
            <p className={`mt-2 ${ui.error}`}>
              Không tải được giỏ hàng.{' '}
              <button type="button" onClick={() => void cartQ.refetch()} className={ui.btnText}>
                Thử lại
              </button>
            </p>
          )}

          <button
            type="button"
            onClick={() => place.mutate()}
            disabled={!addressId || !quote || quoteStale || place.isPending}
            className={`${ui.btnPrimary} mt-4 w-full`}
          >
            {place.isPending ? 'Đang đặt hàng…' : 'Đặt hàng'}
          </button>
          {place.isError && (
            <p role="alert" className={`mt-2 ${ui.error}`}>
              {place.error instanceof Error ? place.error.message : 'Đặt hàng thất bại.'}
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className={`mt-1 flex justify-between text-sm ${green ? 'text-success-fg' : 'text-stone-900'}`}>
      <span className={green ? '' : 'text-stone-600'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AddressPicker({
  addresses,
  selectedId,
  onSelect,
  onCreated,
}: {
  addresses: AddressDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (a: AddressDTO) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [geo, setGeo] = useState<GeoValue>(EMPTY_GEO);
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createAddress({
        recipient: form.recipient.trim(),
        phone: form.phone.replace(/\s/g, ''),
        street: form.street.trim(),
        province: geo.province,
        ward: geo.ward,
        district: '', // hệ 2 cấp (Pancake) — không còn quận/huyện
        provinceCode: geo.provinceCode,
        wardCode: geo.wardCode,
        districtCode: '',
      }),
    onSuccess: (a) => {
      setAdding(false);
      setForm(EMPTY);
      setGeo(EMPTY_GEO);
      onCreated(a);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  });

  const valid = useMemo(
    () =>
      Object.values(form).every((v) => v.trim()) &&
      VN_PHONE.test(form.phone.replace(/\s/g, '')) &&
      !!geo.provinceCode &&
      !!geo.wardCode,
    [form, geo],
  );

  return (
    <div className="mt-2 space-y-2">
      {addresses.map((a) => (
        <label key={a.id} className={`${optionClass(selectedId === a.id)} items-start`}>
          <input
            type="radio"
            name="addr"
            checked={selectedId === a.id}
            onChange={() => onSelect(a.id)}
            className="mt-1 h-4 w-4 accent-forest-600"
          />
          <span>
            <span className="font-medium text-stone-900">{a.recipient} · {a.phone}</span>
            <br />
            <span className="text-stone-600">{[a.street, a.ward, a.district, a.province].filter(Boolean).join(', ')}</span>
          </span>
        </label>
      ))}

      {adding ? (
        <div className="space-y-2 rounded-control border border-stone-300 p-3">
          <TextField
            label={LABEL.recipient}
            autoComplete="name"
            value={form.recipient}
            onChange={(v) => setForm((f) => ({ ...f, recipient: v }))}
          />
          <TextField
            label={LABEL.phone}
            autoComplete="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
          />
          <GeoPicker value={geo} onChange={setGeo} />
          <TextField
            label={LABEL.street}
            autoComplete="street-address"
            value={form.street}
            onChange={(v) => setForm((f) => ({ ...f, street: v }))}
          />
          {err && (
            <p role="alert" className="text-xs text-danger-fg">
              {err}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className={ui.btnSecondary}>
              Hủy
            </button>
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={!valid || create.isPending}
              className={`${ui.btnPrimary} flex-1`}
            >
              Lưu địa chỉ
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-forest-700 hover:underline"
        >
          + Thêm địa chỉ mới
        </button>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  inputMode?: 'tel';
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-stone-700">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className={`${ui.field} mt-1`}
      />
    </label>
  );
}

const LABEL: Record<keyof Form, string> = {
  recipient: 'Người nhận',
  phone: 'Số điện thoại',
  street: 'Số nhà, đường',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/gio-hang" className={ui.backLink}>
        ← Về giỏ hàng
      </Link>
      <h1 className={`mt-1 ${ui.pageTitle}`}>Thanh toán</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}
