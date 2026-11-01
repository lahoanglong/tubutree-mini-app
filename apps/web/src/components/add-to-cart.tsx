'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Zap } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { addToCart, applyCoupon, formatVnd, getCart } from '@/lib/shop-client';
import { couponUseCopy, couponUseOutcome } from '@tubutree/app-core/coupon-use';
import { loginHref, rememberPendingAdd, takePendingAdd } from '@/lib/return-to';
import { rememberCheckoutSelection } from '@/lib/checkout-selection';
import { ui, uiBar } from '@/lib/guest-ui';
import { phoneBand, phoneBandPad, phoneSecondary } from '@/lib/phone-ui';
import { CountBadge } from '@/components/mini/badge';
import { useFlashListExpiry } from '@/lib/use-flash-expiry';
import { defaultVariationFor, pickDefaultVariation, runningFlash, variationPricing } from '@/lib/flash-price';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { needsVariationPicker } from '@tubutree/app-core/variation-picker';
import dynamic from 'next/dynamic';
import type { VariationSheetMode } from './variation-sheet';
import { useActiveFlashSales, useFlashSalesLoaded } from '@/lib/use-flash-sales';
import { usePdpSelection } from './pdp-selection';
import { LOW_STOCK_NOTICE, useProductStock } from './pdp-stock';
import { cartKey, useCartKey } from '@/lib/cart-key';
import { StickyActionBar } from './sticky-action-bar';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { actionErrorText } from '@/lib/error-text';

// Bảng chỉ dùng ở khổ điện thoại khi khách bấm mua: tách khỏi First Load của trang sản phẩm.
const VariationSheet = dynamic(() => import('./variation-sheet').then((m) => m.VariationSheet), { ssr: false });

interface Variation {
  id: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

function isPhoneWidth(): boolean {
  try {
    return window.matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}

/** Mã của nhóm mua chung (`GBUY-<nhóm>-<người>`), đúng dạng máy chủ cấp. */
const GROUP_COUPON_CODE = /^GBUY-[A-Z0-9-]+$/;
/** Thời gian giữ câu báo trên màn trước khi sang thanh toán: đủ đọc một câu ngắn (cùng mức với "Dùng ngay" ở thẻ mã). */
const NOTICE_HOLD_MS = 1800;

/** Gỡ `?ma=` khỏi mục lịch sử hiện tại sau khi đã thử áp: cùng cách với `?danh-gia=` ở khối đánh giá, không dựng lại trang. */
function forgetCouponParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('ma')) return;
  url.searchParams.delete('ma');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function AddToCart({
  slug,
  variations: isrVariations,
  blockedReason = null,
  productName = '',
  thumbnail = null,
}: {
  slug: string;
  productName?: string;
  thumbnail?: string | null;
  variations: Variation[];
  /** Gian hàng tạm nghỉ/ngừng bán (R3-MERCHANT-3): khách xem được trang nhưng chưa mua được. */
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  // Tồn kho trong HTML là bản ISR (tối đa 5 phút tuổi). Khi mở trang hỏi lại tồn kho thật; lỗi/chưa xong thì dùng bản ISR.
  const stockQ = useProductStock(slug);
  const variations = useMemo(
    () => isrVariations.map((v) => ({ ...v, stock: stockQ.data?.[v.id] ?? v.stock })),
    [isrVariations, stockQ.data],
  );
  const shared = usePdpSelection();
  const [localId, setLocalId] = useState<string>(pickDefaultVariation(isrVariations)?.id ?? '');
  const selectedId = shared?.selectedId ?? localId;
  const setSelectedId = shared?.setSelectedId ?? setLocalId;
  const [localQty, setLocalQty] = useState(1);
  const qty = shared?.quantity ?? localQty;
  const setQty = shared?.setQuantity ?? setLocalQty;
  const [busy, setBusy] = useState(false);
  // Đang làm "Mua ngay" (thêm giỏ rồi đi tiếp) hay chỉ "Thêm vào giỏ": quyết định chữ trên nút nào đang quay.
  const [buying, setBuying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Câu về mã nhóm chưa áp được: màu cảnh báo, tách khỏi câu "Đã thêm vào giỏ!" (đã thành công) kẻo hai ý trái nhau chung một màu.
  const [warn, setWarn] = useState<string | null>(null);
  const userPicked = useRef(false);
  const [sheetMode, setSheetMode] = useState<VariationSheetMode | null>(null);
  const [sheetOpened, setSheetOpened] = useState(false);

  // Số món ở nút giỏ của thanh dính (như Mini App); cùng khoá và cùng GET /cart với giỏ ở thanh đầu.
  const cartCount = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' }).data?.itemCount ?? 0;
  const flash = runningFlash(useActiveFlashSales());
  // Hết giờ khi khách đang xem: vẽ lại đúng mốc để chip và nút về giá thường, không chờ lần tải lại danh sách.
  useFlashListExpiry(flash);
  const selected = variations.find((v) => v.id === selectedId);
  const selectedPricing = selected ? variationPricing(selected, flash) : null;
  const price = selectedPricing?.price ?? 0;
  const available = (selected?.stock ?? 0) > 0;
  // Số lượng luôn giới hạn theo tồn kho của phân loại đang chọn (tối thiểu 1) — tránh
  // trường hợp chuyển sang phân loại còn ít/hết hàng nhưng vẫn giữ số lượng của phân loại cũ,
  // dẫn đến gửi lên giỏ hàng số lượng vượt tồn kho (hoặc bằng 0 nếu hết hàng).
  const maxQty = Math.max(selected?.stock ?? 1, 1);

  // Đổi phân loại → reset số lượng về 1 thay vì giữ số lượng cũ (có thể vượt tồn kho mới).
  // Chọn từ bảng phân loại thì giữ số lượng khách vừa chọn trong bảng.
  const keepQtyOnce = useRef(false);
  useEffect(() => {
    if (keepQtyOnce.current) {
      keepQtyOnce.current = false;
      return;
    }
    setQty(1);
  }, [selectedId, setQty]);

  // Tồn kho thật vừa về thấp hơn số đang chọn → kéo số lượng xuống cho khớp.
  useEffect(() => {
    setQty((q) => Math.min(q, maxQty));
  }, [maxQty, setQty]);

  // Phân loại mở sẵn chốt một lần khi danh sách Giờ vàng về (để giá không đổi hai lần). `?v=<variationId>` (thẻ, dải Giờ vàng) thắng
  // khi phân loại đó còn hàng và còn Giờ vàng (`?pv=` của món gian hàng CTV ghim phân loại chỉ cần còn hàng); không thì cùng luật với thẻ (`defaultVariationFor`), nên gợi ý tìm, bài cộng đồng,
  // Đã xem gần đây, liên kết trực tiếp đều mở đúng phân loại có giá đã hiện. Khách đã tự chọn thì không tự đổi.
  const flashLoaded = useFlashSalesLoaded();
  const autoPicked = useRef(false);
  const autoTarget = () => {
    const search = new URLSearchParams(window.location.search);
    const wanted = search.get('v');
    const pinned = search.get('pv');
    const entry = wanted ? variations.find((v) => v.id === wanted && v.stock > 0 && variationPricing(v, flash).isFlash) : undefined;
    const pinnedEntry = pinned ? variations.find((v) => v.id === pinned && v.stock > 0) : undefined;
    return entry ?? pinnedEntry ?? defaultVariationFor({ slug }, variations, flash);
  };
  useEffect(() => {
    if (!flashLoaded || autoPicked.current) return;
    autoPicked.current = true;
    if (userPicked.current) return;
    const target = autoTarget();
    if (target && target.id !== selectedId) setSelectedId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chốt một lần khi Giờ vàng vừa về
  }, [flashLoaded]);

  // Tồn kho thật vừa về (bản ISR tối đa 5 phút tuổi): khách chưa tự chọn thì chọn lại theo luật mặc định trên tồn kho thật, để phân loại
  // rẻ nhất vừa có hàng lại không bị bỏ qua và hết hàng thật rồi thì chuyển sang phân loại còn hàng. Chờ Giờ vàng về trước (nó chốt cùng luật).
  useEffect(() => {
    if (userPicked.current || !stockQ.data || !flashLoaded) return;
    const target = autoTarget();
    if (target && target.id !== selectedId) setSelectedId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi tồn kho thật vừa về
  }, [stockQ.data]);

  // Tải trước bảng chọn lúc rảnh (điện thoại, từ 2 phân loại): mạng chậm thì khách bấm xong không phải nhìn nút im lặng chờ chunk.
  useEffect(() => {
    if (!needsVariationPicker(variations) || !isPhoneWidth()) return;
    const id = window.setTimeout(() => setSheetOpened(true), 800);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- một lần sau khi trang hiện
  }, []);

  // Mã của nhóm mua chung đủ người (`?ma=` do nút "Mua ngay với mã" ở trang Mua chung đặt). Mã gắn riêng sản phẩm và có đơn tối thiểu nên
  // chỉ áp được khi món đã nằm trong giỏ: thử một lần ngay sau lần thêm giỏ đầu tiên thành công, rồi gỡ `ma` khỏi URL để tải lại hay
  // quay lại trang không áp lại một mã khách có thể đã bỏ chọn ở giỏ. Chỉ nhận mã nhóm (`GBUY-`): một đường dẫn soạn sẵn mang mã khác
  // không được thay mã khách đang chọn. Lỗi không chặn việc mua, chỉ nói lý do; `hold` báo có điều khách cần đọc trước khi rời trang, `ok` là mã đã nằm ở giỏ (kể cả khi thay mã cũ).
  const groupCouponTried = useRef(false);
  const applyGroupCoupon = async (cart: Awaited<ReturnType<typeof addToCart>>) => {
    const code = new URLSearchParams(window.location.search).get('ma')?.trim().toUpperCase();
    if (!code || !GROUP_COUPON_CODE.test(code) || groupCouponTried.current) return { cart, note: null, hold: false, ok: true };
    groupCouponTried.current = true;
    forgetCouponParam();
    try {
      const next = await applyCoupon(code);
      void qc.invalidateQueries({ queryKey: ['quote'] });
      const outcome = couponUseOutcome(cart.couponCode, code, next);
      return { cart: next, note: outcome.kind === 'ok' ? `Đã áp mã ${code}.` : outcome.text, hold: outcome.kind !== 'ok', ok: outcome.kind !== 'notApplied' };
    } catch (e) {
      return { cart, note: couponUseCopy.notApplied(actionErrorText(e)), hold: true, ok: false };
    }
  };

  const add = async (variationId: string, quantity: number, buyNow = false) => {
    setBusy(true);
    setBuying(buyNow);
    setMsg(null);
    setWarn(null);
    let leaving = false;
    try {
      const { cart, note, hold, ok } = await applyGroupCoupon(await addToCart(variationId, quantity));
      // Badge giỏ ở header đọc cùng queryKey ['cart'] nhưng nằm trong layout nên không bao giờ
      // remount, và providers tắt refetchOnWindowFocus — không cập nhật thì khách thêm 3 món
      // vẫn thấy số cũ, tưởng chưa thêm được rồi thêm lại thành trùng số lượng.
      qc.setQueryData(cartKey(), cart);
      if (buyNow) {
        // "Mua ngay" chỉ thanh toán món vừa chọn: xoá lựa chọn thì trang thanh toán hiểu là TOÀN GIỎ và tính tiền cả các món
        // khách thêm từ trước. Không thấy dòng của món này (API trả giỏ thiếu) thì null = toàn giỏ, như trước khi có lựa chọn.
        const bought = (cart.items ?? []).filter((l) => l.variationId === variationId).map((l) => l.id);
        rememberCheckoutSelection(bought.length > 0 ? bought : null);
        // Không bỏ khoá `busy`: trang sắp chuyển đi, bấm thêm lúc này là cộng đôi số lượng vào giỏ.
        leaving = true;
        if (hold && note) {
          // Trang thanh toán không biết mã vừa áp hụt: giữ câu báo trên màn một lúc (như "Dùng ngay" ở thẻ mã) rồi mới sang.
          setSuccess(ok);
          setMsg(ok ? note : null);
          setWarn(ok ? null : note);
          await new Promise((resolve) => window.setTimeout(resolve, NOTICE_HOLD_MS));
        }
        router.push('/thanh-toan');
        return;
      }
      setMsg(note && ok ? `Đã thêm vào giỏ! ${note}` : 'Đã thêm vào giỏ!');
      setWarn(note && !ok ? note : null);
      setSuccess(true);
    } catch (e) {
      setMsg(actionErrorText(e));
      setSuccess(false);
      // Thường là "Chỉ còn N sản phẩm": tồn kho đang hiển thị đã cũ, lấy lại để nút/giới hạn khớp thực tế.
      void qc.invalidateQueries({ queryKey: ['product-stock', slug] });
    } finally {
      if (!leaving) setBusy(false);
    }
  };

  // Khách bấm "Thêm vào giỏ" khi chưa đăng nhập rồi đăng nhập xong thì quay lại đây: thêm nốt món đó.
  const resumed = useRef(false);
  useEffect(() => {
    if (phase !== 'authenticated' || resumed.current || blockedReason) return;
    resumed.current = true;
    const pending = takePendingAdd(isrVariations.map((v) => v.id));
    if (!pending) return;
    userPicked.current = true;
    setSelectedId(pending.variationId);
    void add(pending.variationId, pending.quantity, pending.buyNow === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chạy đúng một lần khi vừa có phiên
  }, [phase]);

  // Thêm giỏ và Mua ngay chung cửa kiểm tra phiên: chưa đăng nhập thì nhớ món + ý định rồi sang đăng nhập, quay lại làm nốt.
  const submit = async (buyNow: boolean, chosen?: { id: string; quantity: number }) => {
    if (phase === 'loading' || blockedReason) return;
    // Điện thoại: từ 2 phân loại thì hỏi chọn trong bảng như Mini App. Máy tính đã có ô chọn ngay cạnh nút.
    if (!chosen && needsVariationPicker(variations) && isPhoneWidth()) {
      setSheetOpened(true);
      setSheetMode(buyNow ? 'buy' : 'add');
      return;
    }
    if (phase === 'unavailable') {
      setSuccess(false);
      setWarn(null);
      setMsg(
        `Chưa kết nối được tới Tubu Tree nên chưa ${buyNow ? 'mua được' : 'thêm được vào giỏ'}. Bạn kiểm tra mạng rồi bấm lại nhé.`,
      );
      return;
    }
    if (phase === 'guest') {
      const pick = chosen ?? (selected && available ? { id: selected.id, quantity: qty } : null);
      if (pick) rememberPendingAdd({ variationId: pick.id, quantity: pick.quantity, ...(buyNow ? { buyNow: true } : {}) });
      router.push(loginHref(`/san-pham/${encodeURIComponent(slug)}`));
      return;
    }
    const target = chosen ? variations.find((v) => v.id === chosen.id) : selected;
    if (!target || target.stock <= 0) return;
    // Bấm mua là đã chọn: Giờ vàng hay tồn kho về muộn không được đổi phân loại dưới tay khách.
    userPicked.current = true;
    await add(target.id, Math.min(chosen?.quantity ?? qty, Math.max(target.stock, 1)), buyNow);
  };
  const confirming = useRef(false);
  const confirmVariation = (id: string, quantity: number) => {
    const mode = sheetMode;
    // Bảng đóng có hiệu ứng nên nút còn bấm được lần nữa: chặn bấm đúp thêm giỏ hai lần.
    if (!mode || busy || confirming.current) return;
    confirming.current = true;
    setSheetMode(null);
    userPicked.current = true;
    if (id !== selectedId) keepQtyOnce.current = true;
    setSelectedId(id);
    setQty(quantity);
    void submit(mode === 'buy', { id, quantity }).finally(() => {
      confirming.current = false;
    });
  };
  const onAdd = () => submit(false);
  const onBuyNow = () => submit(true);

  if (blockedReason) {
    return (
      <div className={`mt-4 max-md:order-6 ${phoneBand}`}>
        <button type="button" disabled className={`${ui.btnPrimary} w-full`}>
          Tạm thời chưa mua được
        </button>
      </div>
    );
  }

  const total = formatVnd(price * qty);
  const addLabel = !available ? 'Hết hàng' : busy && !buying ? 'Đang thêm…' : `Thêm vào giỏ · ${total}`;
  const buyLabel = busy && buying ? 'Đang xử lý…' : 'Mua ngay';
  const cannotBuy = busy || !available || phase === 'loading';
  const status = (msg || warn) && (
    <div role="status" className="space-y-1 text-sm">
      {msg && (
        <p className={success ? 'text-success-fg' : 'text-danger-fg'}>
          {msg}{' '}
          {success && !buying && (
            <a href="/gio-hang" className="font-semibold underline">
              Xem giỏ hàng →
            </a>
          )}
        </p>
      )}
      {warn && <p className="text-warning-fg">{warn}</p>}
    </div>
  );

  // Điện thoại: gốc là `contents` để chip và Số lượng thành khối con của cột thông tin trang sản phẩm, xếp bằng `order` như Mini App
  // (Ưu đãi/Vận chuyển → ghi chú → chip → Số lượng → Combo/Mua kèm → Đánh giá nhanh). Không có dòng "Phân loại ›": chip đã đủ tên, giá,
  // hết hàng, và Thêm vào giỏ/Mua ngay vẫn mở bảng chọn từ 2 phân loại. Máy tính giữ một khối liền.
  return (
    <div className="mt-4 max-md:contents">
      {variations.length > 1 && (
        <div
          role="group"
          aria-labelledby="variation-label"
          data-section="pdp-variation-chips"
          className={`max-md:order-5 ${phoneBandPad} max-md:pb-3`}
        >
          <div id="variation-label" className="text-sm font-semibold text-stone-900 max-md:sr-only">
            {fillCopy('pdp.variation')}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 max-md:mt-0">
            {variations.map((v) => {
              const out = v.stock <= 0;
              const active = v.id === selectedId;
              const vp = variationPricing(v, flash);
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={active}
                  // Hết hàng thì khoá hẳn như chip của Mini App: không chọn được (chọn xong nút mua chỉ đổi thành "Hết hàng", khó hiểu) và control
                  // đang khoá được miễn luật tương phản, nên chữ mờ "Hết hàng" không bị tính là chữ nhạt đang tương tác.
                  disabled={out}
                  onClick={
                    out
                      ? undefined
                      : () => {
                          userPicked.current = true;
                          setSelectedId(v.id);
                        }
                  }
                  // Điện thoại: hai dòng (tên / giá) như chip của Mini App, viền 1,5px. Từ md giữ "tên · giá" một dòng để nút mua còn trong 1280×800.
                  className={`min-h-11 rounded-control border px-4 text-sm transition max-md:flex max-md:flex-col max-md:items-start max-md:border-[1.5px] max-md:px-3.5 max-md:py-2 max-md:text-left ${
                    active
                      ? 'border-forest-600 bg-forest-50 font-semibold text-forest-700 max-md:border-[var(--color-border-selected)] max-md:bg-[var(--color-action-secondary-bg)]'
                      : 'border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50 max-md:border-[var(--color-border-subtle)] max-md:bg-[var(--color-bg-surface)]'
                  } ${out ? 'opacity-60 max-md:opacity-[0.55]' : ''}`}
                >
                  <span className={`${active ? 'max-md:font-semibold' : 'max-md:font-normal'} ${out ? 'line-through' : ''} max-md:text-sm`}>{v.name}</span>
                  <span aria-hidden="true" className="max-md:hidden">
                    {' · '}
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 max-md:text-xs max-md:font-normal ${
                      out
                        ? 'max-md:text-[var(--color-text-disabled)]'
                        : vp.isFlash
                          ? 'max-md:text-[var(--color-text-price-deal)]'
                          : active
                            ? 'max-md:text-[var(--color-text-brand)]'
                            : 'max-md:text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {out ? (
                      'Hết hàng'
                    ) : (
                      <>
                        {vp.isFlash && <Zap className="hidden h-3 w-3 max-md:block" strokeWidth={2} aria-hidden="true" />}
                        {formatVnd(vp.price)}
                      </>
                    )}
                  </span>
                  {vp.isFlash && !out && <span className="ml-1.5 text-xs font-bold text-promo-fg max-md:sr-only">Giờ vàng</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Điện thoại: dòng nhắc tồn thấp nằm ở khối thông tin chính dưới Điểm Xanh như Mini App (`PdpLowStock`), nên ẩn ở đây. */}
      {available && (selected?.stock ?? 0) <= LOW_STOCK_NOTICE && (
        <p className="mt-3 text-sm font-medium text-warning-fg max-md:hidden">Chỉ còn {selected!.stock} sản phẩm</p>
      )}

      <div data-section="pdp-quantity" className={`mt-4 flex items-center gap-3 max-md:order-6 max-md:justify-between ${phoneBand}`}>
        <span className="text-sm font-semibold text-stone-900 md:hidden">Số lượng</span>
        <QuantitySelector value={qty} max={maxQty} onChange={setQty} />
        {/* Từ md: nút thêm giỏ ngay cạnh số lượng. Dưới md hai nút nằm ở thanh dính đáy (bên dưới). */}
        <button type="button" onClick={onAdd} disabled={cannotBuy} className={`${ui.btnSecondary} hidden flex-1 md:inline-flex`}>
          {addLabel}
        </button>
      </div>
      <button type="button" onClick={onBuyNow} disabled={cannotBuy} className={`${ui.btnPrimary} mt-3 hidden w-full md:inline-flex`}>
        {buyLabel}
      </button>

      {status && <div className="mt-3 hidden md:block">{status}</div>}

      {needsVariationPicker(variations) && sheetOpened && (
        <VariationSheet
          open={sheetMode !== null}
          onClose={() => setSheetMode(null)}
          mode={sheetMode ?? 'add'}
          productName={productName}
          thumbnail={thumbnail}
          variations={variations}
          flash={flash}
          initialId={selectedId}
          initialQty={qty}
          onConfirm={(v, quantity) => confirmVariation(v.id, quantity)}
        />
      )}

      <StickyActionBar label="Mua hàng">
        {status && <div className="mb-2">{status}</div>}
        <div className="flex items-center gap-2.5">
          <Link
            href="/gio-hang"
            aria-label="Xem giỏ hàng"
            className="relative flex h-12 w-12 flex-none items-center justify-center rounded-control border border-[var(--color-action-secondary-border)] text-[var(--color-text-primary)]"
          >
            <ShoppingCart className="h-[22px] w-[22px]" aria-hidden="true" />
            <CountBadge count={cartCount} />
          </Link>
          {available ? (
            <div className="flex min-w-0 flex-1 gap-2.5">
              <button type="button" onClick={onAdd} disabled={cannotBuy} className={`${uiBar.secondary} ${phoneSecondary} min-w-0 flex-1`}>
                {busy && !buying ? 'Đang thêm…' : 'Thêm vào giỏ'}
              </button>
              {/* Hai dòng (nhãn + giá) như Mini App: một dòng "Mua ngay · giá" tràn ở 320-390px. */}
              <button
                type="button"
                onClick={onBuyNow}
                disabled={cannotBuy}
                aria-label={`${buyLabel} · ${total}`}
                className={`${uiBar.primary} min-w-0 flex-1 flex-col !py-1.5 leading-[1.2]`}
              >
                <span className="block max-w-full truncate">{buyLabel}</span>
                <span className="block max-w-full truncate text-xs font-medium">{total}</span>
              </button>
            </div>
          ) : (
            <button type="button" disabled className={`${ui.btnPrimary} flex-1`}>
              Hết hàng
            </button>
          )}
        </div>
      </StickyActionBar>
    </div>
  );
}
