'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { addToCart, formatVnd, getCart, getProductStock } from '@/lib/shop-client';
import { loginHref, rememberPendingAdd, takePendingAdd } from '@/lib/return-to';
import { rememberCheckoutSelection } from '@/lib/checkout-selection';
import { ui, uiBar } from '@/lib/guest-ui';
import { phoneSecondary } from '@/lib/phone-ui';
import { CountBadge } from '@/components/mini/badge';
import { defaultVariationFor, pickDefaultVariation, variationPricing } from '@/lib/flash-price';
import { useActiveFlashSales, useFlashSalesLoaded } from '@/lib/use-flash-sales';
import { formatDateTime } from '@/lib/format-date';
import { usePdpSelection } from './pdp-selection';
import { cartKey, useCartKey } from '@/lib/cart-key';
import { StickyActionBar } from './sticky-action-bar';
import { actionErrorText } from '@/lib/error-text';

interface Variation {
  id: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

/** Còn từng này trở xuống thì nhắc "Chỉ còn N" để khách biết nên chốt sớm. */
const LOW_STOCK_NOTICE = 5;

export default function AddToCart({
  slug,
  variations: isrVariations,
  blockedReason = null,
}: {
  slug: string;
  variations: Variation[];
  /** Gian hàng tạm nghỉ/ngừng bán (R3-MERCHANT-3): khách xem được trang nhưng chưa mua được. */
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  // Tồn kho trong HTML là bản ISR (tối đa 5 phút tuổi). Khi mở trang hỏi lại tồn kho thật; lỗi/chưa xong thì dùng bản ISR.
  const stockQ = useQuery({
    queryKey: ['product-stock', slug],
    queryFn: () => getProductStock(slug),
    staleTime: 30_000,
    retry: 0,
  });
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
  const userPicked = useRef(false);

  // Số món ở nút giỏ của thanh dính (như Mini App); cùng khoá và cùng GET /cart với giỏ ở thanh đầu.
  const cartCount = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' }).data?.itemCount ?? 0;
  const flash = useActiveFlashSales();
  const selected = variations.find((v) => v.id === selectedId);
  const selectedPricing = selected ? variationPricing(selected, flash) : null;
  const price = selectedPricing?.price ?? 0;
  const available = (selected?.stock ?? 0) > 0;
  // Số lượng luôn giới hạn theo tồn kho của phân loại đang chọn (tối thiểu 1) — tránh
  // trường hợp chuyển sang phân loại còn ít/hết hàng nhưng vẫn giữ số lượng của phân loại cũ,
  // dẫn đến gửi lên giỏ hàng số lượng vượt tồn kho (hoặc bằng 0 nếu hết hàng).
  const maxQty = Math.max(selected?.stock ?? 1, 1);

  // Đổi phân loại → reset số lượng về 1 thay vì giữ số lượng cũ (có thể vượt tồn kho mới).
  useEffect(() => {
    setQty(1);
  }, [selectedId, setQty]);

  // Tồn kho thật vừa về thấp hơn số đang chọn → kéo số lượng xuống cho khớp.
  useEffect(() => {
    setQty((q) => Math.min(q, maxQty));
  }, [maxQty, setQty]);

  // Phân loại mở sẵn chốt một lần khi danh sách Giờ vàng về (để giá không đổi hai lần). `?v=<variationId>` (thẻ, dải Giờ vàng) thắng
  // khi phân loại đó còn hàng và còn Giờ vàng; không thì cùng luật với thẻ (`defaultVariationFor`), nên gợi ý tìm, bài cộng đồng,
  // Đã xem gần đây, liên kết trực tiếp đều mở đúng phân loại có giá đã hiện. Khách đã tự chọn thì không tự đổi.
  const flashLoaded = useFlashSalesLoaded();
  const autoPicked = useRef(false);
  useEffect(() => {
    if (!flashLoaded || autoPicked.current) return;
    autoPicked.current = true;
    if (userPicked.current) return;
    const wanted = new URLSearchParams(window.location.search).get('v');
    const entry = wanted ? variations.find((v) => v.id === wanted && v.stock > 0 && variationPricing(v, flash).isFlash) : undefined;
    const target = entry ?? defaultVariationFor({ slug }, variations, flash);
    if (target && target.id !== selectedId) setSelectedId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chốt một lần khi Giờ vàng vừa về
  }, [flashLoaded]);

  // Phân loại mặc định (theo bản ISR) hết hàng thật rồi mà còn phân loại khác → chọn giúp, trừ khi khách đã tự chọn.
  useEffect(() => {
    if (userPicked.current || !stockQ.data) return;
    const current = variations.find((v) => v.id === selectedId);
    if (current && current.stock <= 0) {
      const alt = variations.find((v) => v.stock > 0);
      if (alt) setSelectedId(alt.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi tồn kho thật vừa về
  }, [stockQ.data]);

  const add = async (variationId: string, quantity: number, buyNow = false) => {
    setBusy(true);
    setBuying(buyNow);
    setMsg(null);
    let leaving = false;
    try {
      const cart = await addToCart(variationId, quantity);
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
        router.push('/thanh-toan');
        return;
      }
      setMsg('Đã thêm vào giỏ!');
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
  const submit = async (buyNow: boolean) => {
    if (phase === 'loading' || blockedReason) return;
    if (phase === 'unavailable') {
      setSuccess(false);
      setMsg(
        `Chưa kết nối được tới Tubu Tree nên chưa ${buyNow ? 'mua được' : 'thêm được vào giỏ'}. Bạn kiểm tra mạng rồi bấm lại nhé.`,
      );
      return;
    }
    if (phase === 'guest') {
      if (selected && available) rememberPendingAdd({ variationId: selected.id, quantity: qty, ...(buyNow ? { buyNow: true } : {}) });
      router.push(loginHref(`/san-pham/${encodeURIComponent(slug)}`));
      return;
    }
    if (!selected || !available) return;
    await add(selected.id, Math.min(qty, maxQty), buyNow);
  };
  const onAdd = () => submit(false);
  const onBuyNow = () => submit(true);

  if (blockedReason) {
    return (
      <div className="mt-4">
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
  const status = msg && (
    <p role="status" className={`text-sm ${success ? 'text-success-fg' : 'text-danger-fg'}`}>
      {msg}{' '}
      {success && (
        <a href="/gio-hang" className="font-semibold underline">
          Xem giỏ hàng →
        </a>
      )}
    </p>
  );

  return (
    <div className="mt-4">
      {variations.length > 1 && (
        <div role="group" aria-labelledby="variation-label">
          <div id="variation-label" className="text-sm font-semibold text-stone-900">
            Phân loại
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {variations.map((v) => {
              const out = v.stock <= 0;
              const active = v.id === selectedId;
              const vp = variationPricing(v, flash);
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    userPicked.current = true;
                    setSelectedId(v.id);
                  }}
                  className={`min-h-11 rounded-control border px-4 text-sm transition ${
                    active
                      ? 'border-forest-600 bg-forest-50 font-semibold text-forest-700'
                      : 'border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50'
                  } ${out ? 'opacity-60 line-through' : ''}`}
                >
                  {v.name} · {formatVnd(vp.price)}
                  {vp.isFlash && <span className="ml-1.5 text-xs font-bold text-promo-fg">Giờ vàng</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedPricing?.isFlash && (
        <p data-testid="flash-price-note" className="mt-3 text-sm font-medium text-promo-fg">
          Giá Giờ vàng {formatVnd(selectedPricing.price)}, giá gốc {formatVnd(selectedPricing.originalPrice)}
          {selectedPricing.endAt ? ` · đến ${formatDateTime(selectedPricing.endAt)}` : ''}
        </p>
      )}

      {available && (selected?.stock ?? 0) <= LOW_STOCK_NOTICE && (
        <p className="mt-3 text-sm font-medium text-warning-fg">Chỉ còn {selected!.stock} sản phẩm</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-stone-900 md:hidden">Số lượng</span>
        <div className="flex items-center rounded-control border border-stone-450 bg-stone-0">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="h-11 w-11 text-lg text-stone-800"
            aria-label="Giảm số lượng"
          >
            −
          </button>
          <span className="w-8 text-center text-stone-900" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
            className="h-11 w-11 text-lg text-stone-800"
            aria-label="Tăng số lượng"
          >
            +
          </button>
        </div>
        {/* Từ md: nút thêm giỏ ngay cạnh số lượng. Dưới md hai nút nằm ở thanh dính đáy (bên dưới). */}
        <button type="button" onClick={onAdd} disabled={cannotBuy} className={`${ui.btnSecondary} hidden flex-1 md:inline-flex`}>
          {addLabel}
        </button>
      </div>
      <button type="button" onClick={onBuyNow} disabled={cannotBuy} className={`${ui.btnPrimary} mt-3 hidden w-full md:inline-flex`}>
        {buyLabel}
      </button>

      {status && <div className="mt-3 hidden md:block">{status}</div>}

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
