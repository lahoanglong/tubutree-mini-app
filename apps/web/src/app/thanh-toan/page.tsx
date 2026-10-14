'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { AddressForm } from '@/components/address-form';
import { addressToForm, isLegacyGeo } from '@/lib/address-form';
import {
  getCart,
  getAddresses,
  createAddress,
  updateAddress,
  checkoutQuote,
  placeOrder,
  getPublicConfig,
  formatVnd,
  type AddressDTO,
  type OrderDTO,
} from '@/lib/shop-client';
import { ctvSlugFor, getStorefrontContext } from '@/lib/storefront-context';
import { recyclingCheckoutFields } from '@/lib/recycling';
import { checkoutPointsOffer, zeroTotalNote } from '@/lib/checkout-points';
import { orderDetailHref } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { ApiError, NetworkError } from '@/lib/client-api';
import { RecyclingCheckoutSection } from '@/components/recycling-checkout';
import { RecyclingStatus } from '@/components/recycling-status';
import { CouponBox, COUPON_MUTATION_KEY } from '@/components/coupon-box';
import { AuthLoading, LoginRequired } from '@/components/login-required';
import { BankTransferPanel } from './bank-transfer-panel';

const NOTE_MAX = 300;
const OPTION_BASE = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-control border p-3 text-sm';
const optionClass = (selected: boolean) =>
  `${OPTION_BASE} ${selected ? 'border-forest-600 bg-forest-50' : 'border-stone-450 bg-stone-0'}`;

export default function CheckoutPage() {
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [note, setNote] = useState('');
  const [placed, setPlaced] = useState<OrderDTO | null>(null);
  const [idemKey] = useState(() => (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random())));

  const cartQ = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: phase === 'authenticated' });
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: phase === 'authenticated' });

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
  const [pointsOffer, setPointsOffer] = useState<{ usable: number; lockNote: string | null; convertedNote: string | null }>({
    usable: 0,
    lockNote: null,
    convertedNote: null,
  });
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
    enabled: !!addressId && phase === 'authenticated',
  });
  useEffect(() => {
    // Giữ lại số điểm dùng được của lần quote gần nhất — khi bật "dùng điểm", BE tự kẹp theo trần
    // loyalty.max_redeem_pct nên gửi toàn bộ số dùng được là an toàn.
    if (quoteQ.data && !usePoints) setPointsOffer(checkoutPointsOffer(quoteQ.data));
  }, [quoteQ.data, usePoints]);

  const quoteStale = couponChanging || quoteQ.isFetching;
  // Refetch lỗi vẫn giữ `data` của lần trước (React Query v5): không coi đó là báo giá hiện hành, nếu không
  // khách thấy số cũ trong khi server đã tính theo mã mới và nút Đặt hàng vẫn bật.
  const quote = quoteQ.isError ? undefined : quoteQ.data;
  // Đơn 0đ: BE ép COD + xác nhận luôn (không thu tiền) nên ẩn lựa chọn phương thức và gửi COD cho khớp.
  const zeroNote = quote ? zeroTotalNote(quote) : null;

  const place = useMutation({
    mutationFn: () =>
      placeOrder(
        {
          addressId: addressId!,
          paymentMethod: zeroNote ? 'COD' : payment,
          ...(note.trim() ? { note: note.trim() } : {}),
          // Báo BE khách đã thấy đơn 0đ: nếu lúc đặt tổng > 0 (điểm vừa bị tiêu bớt) thì BE từ chối thay vì
          // tạo đơn COD có tiền phải trả mà khách không chọn.
          ...(zeroNote ? { quotedZeroTotal: true } : {}),
          // Giá/phí đổi giữa lúc báo giá và lúc bấm đặt → BE trả TOTAL_CHANGED thay vì thu số khách chưa thấy.
          ...(quote ? { expectedTotal: quote.total } : {}),
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
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'TOTAL_CHANGED') {
        void qc.invalidateQueries({ queryKey: ['quote'] });
        void qc.invalidateQueries({ queryKey: ['cart'] });
      }
    },
  });

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }

  if (phase === 'guest') {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để thanh toán đơn hàng." returnTo="/thanh-toan" />
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
              onUpdated={() => {
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                void qc.invalidateQueries({ queryKey: ['quote'] });
              }}
            />
          </section>

          <section className={`p-4 ${ui.card}`}>
            <h2 className={ui.sectionTitle}>Phương thức thanh toán</h2>
            {zeroNote ? (
              <p className="mt-2 text-sm text-forest-800">{zeroNote}</p>
            ) : (
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
            )}
          </section>

          <section className={`p-4 ${ui.card}`}>
            <h2 className={ui.sectionTitle}>Ghi chú cho đơn hàng</h2>
            <label className="mt-2 block">
              <span className="text-xs font-medium text-stone-700">Lời nhắn cho người giao hàng (không bắt buộc)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={NOTE_MAX}
                rows={3}
                placeholder="Ví dụ: giao giờ hành chính, gọi trước khi giao, gửi ở bảo vệ"
                disabled={place.isPending}
                aria-describedby="order-note-count"
                className={`${ui.field} mt-1 py-2`}
              />
            </label>
            <p id="order-note-count" className="mt-1 text-xs text-stone-600">
              {note.length}/{NOTE_MAX} ký tự
            </p>
          </section>

          {recyclingEnabled && (
            <RecyclingCheckoutSection
              selected={hasRecyclingPickup}
              onSelectedChange={setHasRecyclingPickup}
              note={recyclingNote}
              onNoteChange={setRecyclingNote}
              paymentMethod={zeroNote ? 'COD' : payment}
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
          <Row
            label="Phí vận chuyển"
            value={quote ? (quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)) : addressId ? '…' : 'Nhập địa chỉ để tính phí'}
          />
          {cart && (
            <CouponBox
              currentCode={cart.couponCode}
              subtotal={cart.subtotal}
              notice={quote?.couponNotice ?? cart.couponNotice}
              disabled={place.isPending}
            />
          )}
          {usablePoints > 0 && (
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-forest-200 bg-forest-50 p-3 text-sm">
              <input
                type="checkbox"
                checked={usePoints}
                onChange={(e) => setUsePoints(e.target.checked)}
                className="h-4 w-4 accent-forest-600"
              />
              {/* Số thật backend trừ (đã áp trần % giá trị hàng) nằm ở quote.pointsUsed, không phải số dư. */}
              <span className="text-forest-800">
                {usePoints && quote
                  ? `Dùng ${quote.pointsUsed.toLocaleString('vi-VN')} Điểm Xanh — giảm ${formatVnd(quote.pointsDiscount)}`
                  : `Bạn có ${usablePoints.toLocaleString('vi-VN')} Điểm Xanh`}
              </span>
            </label>
          )}
          {pointsOffer.convertedNote && <p className="mt-1 text-xs text-stone-600">{pointsOffer.convertedNote}</p>}
          {pointsOffer.lockNote && <p className="mt-1 text-xs text-stone-600">{pointsOffer.lockNote}</p>}
          <div className="mt-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900">
            <span>Tổng cộng</span>
            {/* Đang tải/đang lỗi thì hiện "…" thay vì 0đ: con số 0 đứng yên cạnh dòng báo lỗi
                trông như đơn không mất tiền. */}
            <span>{quote ? formatVnd(quote.total) : addressId ? '…' : 'Chưa tính'}</span>
          </div>
          {quote && quote.pointsEarned > 0 && (
            <p className="mt-1 text-xs text-success-fg">+{quote.pointsEarned} Điểm Xanh sau khi giao</p>
          )}
          {quoteQ.isError && (
            <p className={`mt-2 ${ui.error}`}>
              {quoteQ.error instanceof ApiError && quoteQ.error.code === 'ADDRESS_OUTDATED'
                ? `${quoteQ.error.message} Hãy bấm Sửa ở địa chỉ đó để chọn lại tỉnh/phường, hoặc thêm địa chỉ mới.`
                : 'Không tính được phí ship/tổng tiền.'}{' '}
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
            <div role="alert" className={`mt-2 ${ui.error}`}>
              <p>{place.error instanceof Error ? place.error.message : 'Đặt hàng thất bại.'}</p>
              {place.error instanceof NetworkError && (
                <p className="mt-1 text-stone-700">
                  Đơn có thể đã được ghi nhận. Bấm Đặt hàng lần nữa để thử lại — hệ thống nhận ra yêu cầu trùng nên không tạo thêm đơn. Hoặc xem{' '}
                  <Link href="/tai-khoan" className="font-semibold text-forest-700 underline">
                    Đơn của tôi
                  </Link>
                  .
                </p>
              )}
            </div>
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
  onUpdated,
}: {
  addresses: AddressDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (a: AddressDTO) => void;
  onUpdated: (a: AddressDTO) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="mt-2 space-y-2">
      {addresses.map((a) =>
        editingId === a.id ? (
          <AddressForm
            key={a.id}
            title="Sửa địa chỉ"
            submitLabel="Lưu thay đổi"
            initial={addressToForm(a)}
            onSubmit={async (payload) => {
              const saved = await updateAddress(a.id, payload);
              setEditingId(null);
              onUpdated(saved);
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div key={a.id} className="flex items-start gap-1">
            <label className={`${optionClass(selectedId === a.id)} min-w-0 flex-1 items-start`}>
              <input
                type="radio"
                name="addr"
                checked={selectedId === a.id}
                onChange={() => onSelect(a.id)}
                className="mt-1 h-4 w-4 accent-forest-600"
              />
              <span className="min-w-0 break-words">
                <span className="font-medium text-stone-900">{a.recipient} · {a.phone}</span>
                <br />
                <span className="text-stone-600">{[a.street, a.ward, a.district, a.province].filter(Boolean).join(', ')}</span>
                {isLegacyGeo(a) && (
                  <>
                    <br />
                    <span className="text-xs font-medium text-warning-fg">
                      Địa giới cũ (trước khi sắp xếp tỉnh/phường 2025) — chưa giao được, bấm Sửa để chọn lại tỉnh/phường.
                    </span>
                  </>
                )}
              </span>
            </label>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setEditingId(a.id);
              }}
              aria-label={`Sửa địa chỉ của ${a.recipient}`}
              className={ui.btnText}
            >
              Sửa
            </button>
          </div>
        ),
      )}

      {adding ? (
        <AddressForm
          title="Thêm địa chỉ mới"
          submitLabel="Lưu địa chỉ"
          onSubmit={async (payload) => {
            const created = await createAddress(payload);
            setAdding(false);
            onCreated(created);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-4">
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-forest-700 hover:underline"
          >
            + Thêm địa chỉ mới
          </button>
          {addresses.length > 0 && (
            <Link href="/tai-khoan/dia-chi" className="inline-flex min-h-11 items-center text-sm text-stone-700 hover:underline">
              Quản lý sổ địa chỉ
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

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
