'use client';

import { useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { addToCart, getCart, type AddToCartSource } from '@tubutree/app-core/api/cart';
import { fetchProduct, type ProductCard, type VariationDetail } from '@tubutree/app-core/api/catalog';
import { QUICK_ADD_SOLD_OUT, quickAddPlan } from '@tubutree/app-core/quick-add';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { productQuery } from '@tubutree/app-core/queries/catalog';
import { wishlistQuery } from '@tubutree/app-core/queries/wishlist';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartKey, cartStorefrontSlug, useCartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { playCartFeedback } from '@/lib/cart-feedback';
import { actionErrorText } from '@/lib/error-text';
import { guestCartFlagNow } from '@/lib/guest-cart/flag';
import { addGuestLine, GUEST_CART_MAX_LINES } from '@/lib/guest-cart/store';
import { useGuestCartLines } from '@/lib/guest-cart/use-guest-cart';
import { loginHref, rememberPendingAdd } from '@/lib/return-to';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { useFlashAllowance } from '@/lib/use-flash-allowance';
import { useAutoDismiss } from '@/lib/use-auto-dismiss';

const VariationSheet = dynamic(() => import('@/components/variation-sheet').then((m) => m.VariationSheet), { ssr: false });

const NOTICE_MS = 4000;

export interface QuickAddNotice {
  ok: boolean;
  text: string;
}
type Notice = QuickAddNotice;

export interface QuickAdd {
  /** Thêm một thẻ vào giỏ theo đúng luật giỏ nhanh: tải chi tiết, một phân loại còn hàng thì thêm thẳng, nhiều thì mở bảng chọn, hết hàng thì báo. */
  quickAdd: (product: ProductCard, opts?: { initialId?: string | null; origin?: Element | null }) => Promise<void>;
  /** Thêm thẳng một phân loại đã biết (dải Mua lại món quen), số lượng 1, không tải chi tiết. Lỗi (hết hàng, ngừng bán) hiện thông báo như mọi đường giỏ nhanh. */
  addVariation: (variationId: string, opts?: { origin?: Element | null }) => Promise<void>;
  /** Hiện một thông báo nổi ở đáy màn (cùng chỗ với "Đã thêm vào giỏ!"). */
  notify: (n: QuickAddNotice) => void;
  /** Thông báo đang hiện, để nơi dùng `inlineNotice` tự vẽ trong khung của mình. */
  notice: QuickAddNotice | null;
  /** Mã sản phẩm đang được thêm (chặn bấm lại ở nơi vẽ nút). */
  busyId: string | null;
  /** Thông báo nổi và bảng chọn phân loại: nơi dùng vẽ ở bất cứ đâu trong cây. */
  feedback: ReactNode;
}

/**
 * Đường giỏ nhanh dùng chung cho thẻ yêu thích, Reel Trang chủ và dải Mua lại món quen. Thẻ không mang phân loại nên tải chi tiết lúc thêm (cũng cho tồn kho mới nhất), rồi theo cùng luật
 * với trang chi tiết: một phân loại thì thêm thẳng, nhiều thì mở bảng chọn. `source` là nguồn ghi nhận lúc thêm giỏ (thiếu thì không ghi).
 * `inlineNotice`: nơi gọi nằm trong hộp thoại phủ lên cả thông báo nổi (z-40 dưới hộp thoại z-50), nên `feedback` bỏ thông báo nổi và nơi gọi vẽ `notice` ngay trong hộp.
 * `staleKey` là khoá truy vấn của danh sách đang vẽ thẻ/món để thêm: máy chủ từ chối vì trạng thái đã đổi (400/404/409/422) thì danh sách đó đã cũ nên tải lại đúng khoá này.
 * Cùng lúc tải lại chi tiết của đúng sản phẩm vừa bấm (khi biết slug): Reel và nơi khác vẽ nút từ chi tiết đó, còn bản cũ thì nút vẫn sáng.
 */
export function useQuickAdd(
  source: AddToCartSource | undefined,
  staleKey: readonly unknown[],
  opts: {
    inlineNotice?: boolean;
    /**
     * Chỉ nơi bán cho khách chưa đăng nhập (Trang chủ) truyền. Khách chưa đăng nhập, cờ `web.guest_cart_enabled` bật: thêm vào giỏ trình duyệt (nhiều phân loại thì mở bảng chọn
     * như khách đã đăng nhập), không rời trang. Cờ tắt hay chưa về, hoặc trình duyệt chặn bộ nhớ: gọi `login` để nơi gọi nhớ món rồi sang đăng nhập như trước.
     */
    guest?: { login: (product: ProductCard, variations: VariationDetail[]) => void };
  } = {},
): QuickAdd {
  const qc = useQueryClient();
  const flash = useActiveFlashSales();
  const phase = useAuthPhase();
  const guestLines = useGuestCartLines();
  const guest = phase === 'guest' ? opts.guest : undefined;
  // Giỏ cho bảng chọn: thêm giỏ cộng dồn và máy chủ giá Giờ vàng trên cả dòng, nên nút phải biết số đã có (cùng khoá với giỏ ở thanh đầu và trang sản phẩm, thêm xong `setQueryData` cập nhật).
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: () => getCart(coreHttp, cartStorefrontSlug()), enabled: phase === 'authenticated' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ product: ProductCard; variations: VariationDetail[]; initialId: string | null; guestCart: boolean } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Số suất Giờ vàng khách còn mua được (đã trừ các đơn trước) cho các phân loại của sản phẩm trong bảng; không có bảng thì không có id nên không gọi.
  const flashWithAllowance = useFlashAllowance(flash, picker?.variations.map((v) => v.id) ?? []);
  // Chống bấm đúp đồng bộ: state chưa kịp render lại giữa hai cú chạm liền nhau, còn ref thì có ngay.
  const inFlight = useRef(false);

  // Tự tắt sau NOTICE_MS nhưng dừng khi trỏ/focus đang ở trên thông báo (có liên kết "Xem giỏ hàng"; WCAG 2.2.1).
  const noticeHold = useAutoDismiss(!!notice, NOTICE_MS, () => setNotice(null), notice);
  const show = (n: Notice) => setNotice(n);

  const addLine = async (variationId: string, qty: number, origin: Element | null = null) => {
    const cart = await addToCart(coreHttp, variationId, qty, source, cartStorefrontSlug());
    // Badge giỏ ở header đọc cùng khoá và không remount khi khách ở lại trang này.
    qc.setQueryData(cartKey(), cart);
    show({ ok: true, text: 'Đã thêm vào giỏ!' });
    playCartFeedback(origin?.isConnected ? origin : null);
  };

  // Khách chưa đăng nhập (cờ giỏ khách bật): ghi vào giỏ trình duyệt, cùng phản hồi như `addLine`. Trình duyệt chặn bộ nhớ thì nhờ nơi gọi đưa sang đăng nhập.
  const addGuest = (product: ProductCard, variations: VariationDetail[], variation: { id: string; stock?: number }, qty: number, origin: Element | null = null) => {
    const res = addGuestLine({ variationId: variation.id, slug: product.slug, quantity: qty, maxQty: variation.stock });
    if (res.ok) {
      show({ ok: true, text: 'Đã thêm vào giỏ!' });
      playCartFeedback(origin?.isConnected ? origin : null);
      return;
    }
    if (res.reason === 'storage') {
      guest?.login(product, variations);
      return;
    }
    show({ ok: false, text: res.reason === 'full' ? fillCopy('guestCart.full', { n: GUEST_CART_MAX_LINES }) : fillCopy('guestCart.atMax') });
  };

  const reloadStale = (slug: string | undefined) =>
    Promise.all((slug ? [staleKey, productQuery(coreHttp, slug).queryKey] : [staleKey]).map((queryKey) => qc.invalidateQueries({ queryKey })));

  const run = async (task: () => Promise<void>, slug?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await task();
    } catch (e) {
      show({ ok: false, text: actionErrorText(e) });
      setPicker(null);
      // Thẻ/món đang hiện đã cũ: giữ khoá tới khi dữ liệu của nơi gọi mới về (tối đa 4 giây) kẻo chạm lại nhận đúng lời từ chối đó. Lời lỗi đã hiện trước khi chờ.
      if (serverRejectedState(e)) await settleWithin(reloadStale(slug));
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  };

  const quickAdd = async (product: ProductCard, opts?: { initialId?: string | null; origin?: Element | null }) => {
    // Sang đăng nhập chạy SAU `run` (đã nhả khoá, đã bắt lỗi của chính lượt thêm): lỗi điều hướng ném ra khỏi hàm này, không bị `run` nuốt thành thông báo.
    let login: (() => void) | undefined;
    await run(async () => {
      setBusyId(product.id);
      // Cờ đọc lúc bấm (bản đã có sẵn, chưa có thì chờ ngắn) để Trang chủ không gọi cấu hình riêng cho nút này.
      const guestOn = guest ? await guestCartFlagNow(qc) : false;
      if (guest && !guestOn) {
        // Cờ giỏ khách tắt hay chưa về: lối cũ. Chi tiết không tải được thì khách tự chọn ở trang sản phẩm sau đăng nhập.
        const variations = await fetchProduct(coreHttp, product.slug).then((d) => d.variations, () => [] as VariationDetail[]);
        if (variations.length > 0 && quickAddPlan(variations).kind === 'soldOut') show({ ok: false, text: QUICK_ADD_SOLD_OUT });
        else login = () => guest.login(product, variations);
        return;
      }
      const detail = await fetchProduct(coreHttp, product.slug);
      const plan = quickAddPlan(detail.variations);
      if (plan.kind === 'soldOut') {
        show({ ok: false, text: QUICK_ADD_SOLD_OUT });
        // Thẻ còn nút giỏ và không có lớp Hết hàng nếu không tải lại: khách bấm lại sẽ ra đúng lời báo này.
        void reloadStale(product.slug);
      } else if (plan.kind === 'pick') setPicker({ product, variations: detail.variations, initialId: opts?.initialId ?? null, guestCart: guestOn });
      else if (guestOn) addGuest(product, detail.variations, detail.variations.find((v) => v.id === plan.variationId) ?? { id: plan.variationId }, 1, opts?.origin ?? null);
      else await addLine(plan.variationId, 1, opts?.origin ?? null);
    }, product.slug);
    login?.();
  };

  const addVariation = (variationId: string, opts?: { origin?: Element | null }) =>
    run(async () => {
      setBusyId(variationId);
      await addLine(variationId, 1, opts?.origin ?? null);
    });

  const confirmPick = (variation: { id: string; stock?: number }, qty: number) =>
    run(async () => {
      setBusyId(picker?.product.id ?? null);
      if (picker?.guestCart && guest) addGuest(picker.product, picker.variations, variation, qty);
      else await addLine(variation.id, qty);
      setPicker(null);
    }, picker?.product.slug);

  const feedback = (
    <>
      {/* Vùng báo luôn có mặt trong cây, chỉ đổi phần con: vùng live vừa gắn cùng chữ thường không được đọc ra. */}
      <div role="status">
        {notice && !opts.inlineNotice && (
          <div
            role={notice.ok ? undefined : 'alert'}
            data-surface="inverse"
            {...noticeHold}
            className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card bg-stone-900 px-4 py-2 text-sm text-stone-0 shadow-raised"
          >
            <span>{notice.text}</span>
            {notice.ok && (
              <Link href="/gio-hang" className="inline-flex min-h-11 flex-none items-center font-semibold underline underline-offset-2">
                Xem giỏ hàng
              </Link>
            )}
          </div>
        )}
      </div>
      {picker && (
        <VariationSheet
          open
          onClose={() => setPicker(null)}
          mode="add"
          productName={picker.product.name}
          thumbnail={picker.product.thumbnail}
          variations={picker.variations}
          flash={flashWithAllowance}
          initialId={picker.initialId ?? picker.product.pinnedVariationId ?? picker.product.repVariationId ?? null}
          initialQty={1}
          busy={busyId === picker.product.id}
          cartLines={picker.guestCart ? guestLines : cartQ.data?.items}
          onConfirm={confirmPick}
        />
      )}
    </>
  );

  return { quickAdd, addVariation, notify: show, notice, busyId, feedback };
}

/**
 * Lối cũ của khách chưa đăng nhập khi cờ giỏ khách tắt (hay trình duyệt chặn bộ nhớ): nhớ món nếu khách không phải chọn gì (đúng một phân loại còn hàng; nhiều phân loại thì trang
 * sản phẩm sau đăng nhập để khách tự chọn, không thêm hộ) rồi sang đăng nhập, quay lại đúng trang sản phẩm.
 */
export function guestQuickAddLogin(router: { push: (href: string) => void }): (product: ProductCard, variations: VariationDetail[]) => void {
  return (product, variations) => {
    const plan = quickAddPlan(variations);
    if (plan.kind === 'add') rememberPendingAdd({ variationId: plan.variationId, quantity: 1 });
    router.push(loginHref(`/san-pham/${encodeURIComponent(product.slug)}`));
  };
}

/** Nút giỏ nhanh nổi ở góc dưới ảnh thẻ: vùng chạm 44px bọc vòng trắng 32px, cùng kiểu nút tim ở góc trên. */
export function useWishlistQuickAdd(): { buttonFor: (p: ProductCard) => ReactNode; feedback: ReactNode; notify: QuickAdd['notify'] } {
  const { quickAdd, busyId, feedback, notify } = useQuickAdd('wishlist', wishlistQuery(coreHttp).queryKey);
  // Khoá chung cả trang: một thẻ đang bay thì chạm giỏ ở thẻ khác bị nuốt, nên mọi nút báo aria-disabled (chỉ thẻ đang bay báo thêm aria-busy), không `disabled` kẻo rớt focus.
  const buttonFor = (p: ProductCard) =>
    p.inStock === false ? null : (
      <button
        type="button"
        aria-label={`Thêm ${p.name} vào giỏ`}
        aria-busy={busyId === p.id}
        aria-disabled={busyId !== null || undefined}
        onClick={(e) => void quickAdd(p, { origin: e.currentTarget })}
        className="inline-flex h-11 w-11 items-center justify-center text-stone-700"
      >
        <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-stone-0 shadow-e1 ${busyId === p.id ? 'opacity-60' : ''}`}>
          <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
        </span>
      </button>
    );

  // `notify`: chuông báo hàng về của trang dùng chung chỗ thông báo nổi với giỏ nhanh.
  return { buttonFor, feedback, notify };
}
