import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Box, Page, Text, useNavigate, useParams, useLocation } from 'zmp-ui';
import { announce, useNotify } from '../hooks/use-notify';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat, ChevronRight, ShoppingCart, Share2, Users, Truck, Megaphone, Check, MessageCircle, Ticket, MapPin } from 'lucide-react';
import { PRODUCT_NOT_FOUND } from '@tubutree/app-core/client-copy';
import {
  fetchProduct,
  fetchRelated,
  fetchBoughtTogether,
  fetchForYou,
  getCart,
  addToCart,
  applyCoupon,
  fetchActiveFlashSales,
  type CartSummary,
  type VariationDetail,
  type FlashSaleActiveItem,
} from '../services/shop-api';
import { getErrorMessage, getLoadErrorMessage, isNotFoundError, isStaleStateError } from '../services/api';
import { getCoupons } from '../services/account-api';
import type { LegalSlug } from '../services/legal-api';
import { createGroupBuy } from '../services/groupbuy-api';
import { groupBuyPitch } from '../utils/group-buy-copy';
import { useAuthStore } from '../store/auth';
import { useShareWithFallback } from '../components/share-sheet';
import { miniAppLink } from '../utils/miniapp-link';
import { withReferral } from '../utils/share-link';
import { ReviewsSection, Stars } from '../components/reviews-section';
import { WishlistHeart } from '../components/wishlist-heart';
import { SubscribeSheet } from '../components/subscribe-sheet';
import { VariationSheet, type VariationSheetMode } from '../components/variation-sheet';
import { fetchReviews } from '../services/shop-api';
import { trackEvent } from '../services/analytics';
import { Skeleton } from '../components/ui/skeleton';
import { useLockedMutation } from '../components/game/use-locked-mutation';
import { settleWithin } from '../utils/settle-within';
import { ErrorState } from '../components/ui/empty-state';
import { SuggestedRail } from '../components/catalog/suggested-rail';
import { SR_ONLY } from '../components/ui/sr-only';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { brandAccent, brandBrowseLabel, brandBrowsePath } from '../utils/brands';
import { pdpOriginLink } from '../utils/brand-origins';
import { formatVnd, formatSold } from '../utils/format';
import { soldPercent } from '../utils/flash-display';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { joinVariationLine, variationLabel } from '../utils/variation-label';
import { hasOA, openOAChat } from '../services/zmp-bridge';
import { isRetailOnly } from '../utils/retail-only';
import { StorefrontContextBar } from '../components/storefront-context-bar';
import { useLoginWithNotice } from '../components/ui/auth-gate';
import { serverNow } from '../utils/server-clock';
import { cardPricing, defaultVariationFor, isFlashRunning, pickDefaultVariation, variationPricing } from '@tubutree/app-core/flash-price';
import { couponUseCopy, couponUseOutcome } from '@tubutree/app-core/coupon-use';
import { addOneVariationPricing } from '@tubutree/app-core/commerce/add-one-pricing';
import { buildFrequentlyBoughtBundle, pickFbtPartners } from '@tubutree/app-core/commerce/frequently-bought';
import { pdpShelves } from '@tubutree/app-core/commerce/pdp-view';
import { productTrustStrip } from '@tubutree/app-core/commerce/product-trust-strip';
import { withProductCopyFallback } from '@tubutree/app-core/commerce/product-copy-fallback';
import { formatRating } from '@tubutree/app-core/commerce/card-meta';
import { offerAmount } from '@tubutree/app-core/commerce/voucher-picker';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { resolveStoryConfig } from '@tubutree/app-core/commerce/product-story';
import { returnsPromise } from '@tubutree/app-core/returns-copy';
import { needsVariationPicker } from '@tubutree/app-core/variation-picker';
import { inCartQuantity, lineNote, variationLinePreview } from '@tubutree/app-core/commerce/flash-line';
import { useFlashAllowance } from '../hooks/use-flash-allowance';
import { isLowStock, qtyPickMax } from '@tubutree/app-core/commerce/stock-text';
import { usePublicConfig } from '../hooks/use-public-config';
import { useRecordRecentlyViewed } from '../hooks/use-record-recently-viewed';
import { rememberCheckoutSelection } from '../utils/checkout-selection';
import { SUBSCRIPTIONS_IN_MINIAPP } from '../utils/features';
import { getAffiliateMe } from '../services/affiliate-api';
import { ContentKitSheet } from '../components/content-kit-sheet';
import { POLICY_TITLES, PolicySheet } from '../components/policy-sheet';
import { CartBadge } from '../components/ui/cart-badge';
import { playCartFeedback } from '../utils/cart-feedback';
import { copyText } from '../utils/clipboard';
import { Button } from '../components/ui/button';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { SectionTitle } from '../components/ui/section-title';
import { PriceTag } from '../components/ui/price-tag';
import { PointsEarnLine } from '../components/product/points-earn-line';
import { Badge } from '../components/ui/badge';
import { Icon } from '../components/ui/icon';
import { ProductRail } from '../components/ui/product-rail';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { useScrollHints } from '../components/ui/use-scroll-hints';
import { cartKey, useCartKey } from '../services/cart-key';
import { LeafGlyph } from '../components/ui/product-image';
import { useSizedImage } from '../utils/image-src';
import { FlashPriceBar } from '../components/product/flash-price-bar';
import { PdpBundles } from '../components/product/pdp-bundles';
import { PdpFbt, useFbtCartProductIds } from '../components/product/pdp-fbt';
import { ProductTrustStrip } from '../components/ui/product-trust-strip';
import { VariationChip } from '../components/product/variation-chip';
import { useBundlesWait } from '../components/product/use-product-bundles';
import { PdpOffersSheet } from '../components/product/pdp-offers-sheet';
import { PdpQuickReviews } from '../components/product/pdp-quick-reviews';
import { PdpFeed } from '../components/product/pdp-feed';
import { ListRow } from '../components/ui/list-row';

// Cảnh câu chuyện kéo theo sprite, CSS và ảnh: nạp lười để gói đầu của trang không phải gánh khi khách không mở tới.
const ProductStoryShowcase = lazy(() => import('../components/ui/product-story-showcase').then((m) => ({ default: m.ProductStoryShowcase })));

type CartLines = readonly { variationId: string; quantity: number }[] | undefined;

const ADDED_FLASH_MS = 1_200;
const DESC_COLLAPSED_LINES = 4;
// Khung chờ và khung lỗi chưa có tên sản phẩm; h1 ẩn giữ cho route luôn đúng một h1.
const PDP_TITLE = 'Chi tiết sản phẩm';

/** Phí giao của gian hàng tự giao, như lúc thanh toán tính cho kiện của gian hàng. */
function merchantShippingLine(fee: number, freeShipFrom: number | null): string {
  if (fee <= 0) return 'Gian hàng miễn phí giao hàng';
  const base = `Phí giao ${formatVnd(fee)}`;
  return freeShipFrom != null ? `${base}, miễn phí cho đơn của gian hàng từ ${formatVnd(freeShipFrom)}` : base;
}

/**
 * Danh sách Giờ vàng tải ở máy có thể cũ hơn mốc kết thúc của đợt (nhịp tải lại 5 đến 60 giây): trang chỉ dùng suất còn chạy theo giờ
 * máy chủ, không đợi lần tải lại, để giá và nhãn Giờ vàng biến mất đúng lúc đợt hết.
 */
function runningFlash(list: readonly FlashSaleActiveItem[] | undefined): FlashSaleActiveItem[] {
  const now = serverNow();
  return (list ?? []).filter((f) => isFlashRunning(f, now));
}

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { notify } = useNotify();
  const shareWithFallback = useShareWithFallback();
  const queryClient = useQueryClient();
  const { status, user } = useAuthStore();
  const loginWithNotice = useLoginWithNotice();
  // Voucher khả dụng (endpoint /me/coupons đã lọc active + scope-eligible + chưa hết lượt; mã chỉ áp cho vài sản phẩm
  // kèm `products` và chỉ hiện trên trang của đúng sản phẩm đó). Để user KHÁM PHÁ ưu đãi ngay ở PDP.
  const couponsQ = useQuery({
    // Cùng queryKey với VoucherSheet ở giỏ/thanh toán → một cache, không gọi 2 lần và
    // không có cảnh "PDP thấy mã, sheet chưa thấy" sau khi nhận mã mới.
    queryKey: ['coupons'],
    queryFn: getCoupons,
    enabled: status === 'authenticated',
  });
  // Ngưỡng freeship (public config) cho badge "Miễn phí giao hàng" — tín hiệu tin cậy ở PDP.
  const config = usePublicConfig();
  const chatOn = config.chat?.enabled === true;
  const chatReady = chatOn && status === 'authenticated';

  // Thẻ và dải "Giờ vàng" truyền variationId qua state; hợp lệ khi phân loại đó còn hàng và còn Giờ vàng; `pinnedVariationId` (món gian hàng CTV ghim phân loại) chỉ cần còn hàng. Mọi lối vào khác
  // (lưới, gợi ý tìm, bài cộng đồng, deep link) mở phân loại mà thẻ đã ghi giá (`defaultVariationFor`). Chỉ khách bấm chọn mới
  // là `selectedId`. Trang hiện ngay với phân loại đại diện; khi danh sách Giờ vàng về thì chốt lại một lần, không đổi lại khi đợt hết giờ lúc khách đang xem.
  const location = useLocation();
  const navState = location.state as
    | { variationId?: string; pinnedVariationId?: string; listSource?: string; reviewOrderId?: string; applyCoupon?: string }
    | null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bảng đóng có hiệu ứng ~200ms nên nút xác nhận còn bấm được: khoá đồng bộ để bấm đúp không thêm giỏ hai lần hay gọi login hai lần.
  const confirming = useRef(false);
  const sharing = useRef(false);
  // Thêm giỏ và Mua ngay đều ghi vào giỏ nên là một khoá chung: chạm "Thêm vào giỏ" rồi "Mua ngay" sát nhau (hay hai lối vào khác nhau của cùng một nút) chỉ ghi giỏ một lần.
  // `isPending` chỉ đúng sau lần vẽ kế tiếp nên không chặn được cú chạm thứ hai; ref thì chặn ngay.
  const cartWrite = useRef(false);
  const autoPick = useRef<{ slug: string; id: string | null } | null>(null);
  const [quantity, setQuantity] = useState(1);
  // Nút "Thêm vào giỏ" tự xác nhận "Đã thêm" ADDED_FLASH_MS; bấm lại trong lúc đó thì tính lại cửa sổ từ lần bấm sau.
  const [justAdded, setJustAdded] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(addedTimer.current), []);
  const [showSubscribe, setShowSubscribe] = useState(false);
  // Chính sách mở ngay trong trang: nút Vận chuyển ở Cam kết Tubu và lối xem chính sách của dải cam kết dùng chung một sheet.
  const [policySlug, setPolicySlug] = useState<LegalSlug | null>(null);
  const [sheetMode, setSheetMode] = useState<VariationSheetMode | null>(null);
  const [showContentKit, setShowContentKit] = useState(false);
  const [offersOpen, setOffersOpen] = useState(false);
  // Bộ đếm Giờ vàng báo hết giờ: tăng để trang tính lại `runningFlash` theo giờ máy chủ mà không đợi lần tải lại danh sách.
  const [, setFlashTick] = useState(0);
  // "Bộ nội dung bán hàng" trước đây CHỈ mở được từ trình dựng gian hàng, tức CTV phải thêm
  // sản phẩm vào gian hàng mới lấy được bài mẫu — trong khi lúc cần là lúc đang xem sản phẩm
  // để đi đăng bài (P1-7). Cùng queryKey với trang CTV nên không tốn thêm request.
  const affiliateQ = useQuery({
    queryKey: ['affiliate-me'],
    queryFn: getAffiliateMe,
    enabled: status === 'authenticated',
    staleTime: 5 * 60_000,
  });
  const isAffiliate = affiliateQ.data?.isAffiliate === true;

  const product = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(slug!),
    enabled: !!slug,
    // Chữ dự phòng gắn lúc đọc (không ghi vào cache) và nằm trong chunk tải lười của trang này, không vào gói đầu.
    select: withProductCopyFallback,
  });
  // "Đã xem gần đây" (spec 5b.4): ghi khi PDP mở THÀNH CÔNG. Đặt trước mọi early-return (luật hook).
  useRecordRecentlyViewed(product.isSuccess ? product.data : undefined);
  // Combo/Mua kèm tải song song với sản phẩm; trang giữ khung chờ tối đa vài trăm ms để khối chèn cùng lần vẽ đầu, không đẩy các hàng bên dưới.
  const bundlesWaiting = useBundlesWait(slug);
  const related = useQuery({
    queryKey: ['related', slug],
    queryFn: () => fetchRelated(slug!),
    enabled: !!slug && product.isSuccess,
  });
  const boughtTogether = useQuery({
    queryKey: ['bought-together', slug],
    queryFn: () => fetchBoughtTogether(slug!),
    enabled: !!slug && product.isSuccess,
  });
  // Cùng khoá với lưới gợi ý Trang chủ: phản hồi `/products/for-you` không phụ thuộc sản phẩm đang xem nên mở món khác không gọi lại.
  // Lỗi chỉ làm ẩn dải gợi ý; dạng dữ liệu sai thì `pdpShelves` coi như rỗng.
  const feed = useQuery({
    queryKey: ['for-you'],
    queryFn: () => fetchForYou(),
    enabled: !!slug && product.isSuccess,
    staleTime: 5 * 60_000,
  });
  const cart = useQuery({
    queryKey: useCartKey(),
    queryFn: getCart,
    enabled: status === 'authenticated',
  });
  // Món đã có trong giỏ lúc trang mở không được gợi ý mua kèm; khách đã đăng nhập thì chờ giỏ về (hoặc lỗi) rồi mới chọn món, để bộ gợi ý không đổi sau lần vẽ đầu.
  // Chờ cả phiên: ở 'loading' (lúc app vừa mở) chưa biết giỏ của ai, đóng băng ngay sẽ chốt một danh sách rỗng rồi không tính lại khi đăng nhập xong; khoá theo việc đã đăng nhập
  // để phiên từ lỗi/khách sang đăng nhập tính lại một lần.
  const fbtCartIds = useFbtCartProductIds(
    slug && `${slug}:${status === 'authenticated'}`,
    cart.data?.items,
    status === 'authenticated' ? !cart.isPending : status !== 'loading',
  );
  // Giỏ lúc khách bấm "Mua ngay". Thêm xong, giỏ mới (đã có món vừa thêm) vào cache trong lúc trang này còn mount ở hiệu ứng thoát: tính lại theo giỏ mới thì
  // `inCart` đã gồm số vừa thêm, nên số nút và câu ghi chú nhảy sai chốc lát (trình đọc màn hình đọc câu sai). Giữ giỏ cũ tới khi lỗi hoặc trang gỡ.
  const [buyFreeze, setBuyFreeze] = useState<{ lines: CartLines } | null>(null);
  const cartLines = buyFreeze ? buyFreeze.lines : cart.data?.items;
  // Cùng queryKey với ReviewsSection → React Query dedupe, chỉ 1 request.
  const reviews = useQuery({
    queryKey: ['reviews', slug],
    queryFn: () => fetchReviews(slug!),
    enabled: !!slug,
  });
  // Cùng queryKey với FlashSale (trang chủ) → React Query dedupe nếu đã cache sẵn.
  const flashQ = useQuery({
    queryKey: ['flash-sales', 'active'],
    queryFn: fetchActiveFlashSales,
  });

  // Mặc định: phân loại còn hàng có giá đang bán thấp nhất, cùng phân loại mà thẻ sản phẩm lấy giá.
  const variations = product.data?.variations ?? [];
  // Memo theo (selectedId + danh sách variation) — tránh tạo ref mới mỗi render gây effect chạy dư.
  if (product.data && !flashQ.isPending && autoPick.current?.slug !== slug) {
    const flashNow = runningFlash(flashQ.data);
    const entry =
      variations.find((v) => v.id === navState?.variationId && v.stock > 0 && variationPricing(v, flashNow).isFlash) ??
      variations.find((v) => v.id === navState?.pinnedVariationId && v.stock > 0);
    autoPick.current = { slug: slug ?? '', id: (entry ?? defaultVariationFor({ slug: product.data.slug }, variations, flashNow, serverNow()))?.id ?? null };
  }
  const auto = autoPick.current;
  const autoId = auto && auto.slug === slug ? auto.id : null;
  const selected = useMemo(
    () => variations.find((v) => v.id === selectedId) ?? variations.find((v) => v.id === autoId) ?? pickDefaultVariation(variations),
    [selectedId, autoId, variations],
  );

  // Số suất Giờ vàng khách còn mua được (đã trừ các đơn trước): một request cho các suất của sản phẩm này, chỉ khi đã đăng nhập; chỉ nút, tổng và ghi chú đọc nó.
  const flashWithAllowance = useFlashAllowance(flashQ.data, variations.map((v) => v.id));
  // Flash sale đang chạy cho ĐÚNG phân loại đang chọn (BE re-resolve giá thật lúc thêm giỏ/checkout).
  const flashItem = selected ? runningFlash(flashQ.data).find((f) => f.variationId === selected.id) : undefined;

  // Đổi phân loại → kẹp lại số lượng theo trần nút + của phân loại mới (chỉ phụ thuộc id/stock, không phải ref).
  useEffect(() => {
    if (selected && quantity > qtyPickMax(selected.stock)) {
      setQuantity(qtyPickMax(selected.stock));
    }
  }, [selected, quantity]);

  // Phát 'product_viewed' khi đã tải xong sản phẩm + đã xác định phân loại đang chọn.
  // ĐẶT Ở ĐÂY (trước early-return loading/error bên dưới), KHÔNG đặt cạnh biến `price` (được
  // khai báo sau early-return, dòng ~203) — hook không được gọi có điều kiện, nếu đặt sau
  // early-return thì render đầu (đang loading) sẽ bỏ qua hẳn lời gọi hook này còn render sau
  // (đã có data) thì gọi, khiến số lượng hook đổi giữa các lần render (React sẽ throw). Vì vậy
  // tính lại công thức giá y hệt `price` ở dưới, dùng `product.data` (đã guard non-null) thay
  // vì biến `p`.
  const trackedViewKey = useRef<string | null>(null);
  useEffect(() => {
    // `flashQ` refetch mỗi 60s (giờ vàng) và tạo object `flashItem` MỚI mỗi lần `soldCount` đổi
    // dù khách không thao tác gì — nếu phát theo tham chiếu `flashItem` thì khách đứng yên trên
    // trang giờ vàng vẫn bị phát `product_viewed` lặp lại mỗi phút, sai tỉ lệ chuyển đổi PDP→giỏ
    // của đúng nhóm hàng giờ vàng cần đo nhất (review 2026-09-28). Chờ `flashQ.isPending` xong
    // (tránh race: phát `isFlash:false` trước rồi phát thêm lần 2 `isFlash:true` khi flashQ
    // resolve) và chỉ phát 1 LẦN cho mỗi cặp (sản phẩm, biến thể) bằng khoá `viewKey`.
    if (!product.isSuccess || !product.data || !selected || flashQ.isPending) return;
    const viewKey = `${product.data.id}:${selected.id}`;
    if (trackedViewKey.current === viewKey) return;
    trackedViewKey.current = viewKey;
    const view = variationPricing(selected, runningFlash(flashQ.data));
    const viewPrice = view.price;
    void trackEvent('product_viewed', 'miniapp', {
      productId: product.data.id,
      variationId: selected.id,
      price: viewPrice,
      isFlash: view.isFlash,
      inStock: selected.stock > 0,
      listSource: navState?.listSource ?? 'browse',
    });
  }, [product.isSuccess, product.data, selected, flashQ.data, flashQ.isPending]);

  // Mã của nhóm mua chung đủ người (nút "Mua ngay với mã" ở trang Mua chung). Mã gắn riêng sản phẩm và có đơn tối thiểu nên chỉ áp được
  // khi món đã nằm trong giỏ: thử một lần ngay sau lần thêm giỏ đầu tiên thành công. Lỗi không chặn việc mua, chỉ nói lý do để khách tự chọn mã ở giỏ.
  const groupCoupon = navState?.applyCoupon?.trim().toUpperCase() || null;
  const groupCouponTried = useRef(false);
  const applyGroupCoupon = async (
    cart: CartSummary,
  ): Promise<{ cart: CartSummary; note: { text: string; ok: boolean } | null; couponRejected?: boolean }> => {
    if (!groupCoupon || groupCouponTried.current) return { cart, note: null };
    groupCouponTried.current = true;
    try {
      const next = await applyCoupon(groupCoupon);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      const outcome = couponUseOutcome(cart.couponCode, groupCoupon, next);
      return { cart: next, note: outcome.kind === 'ok' ? { text: `Đã áp mã ${groupCoupon}`, ok: true } : { text: outcome.text, ok: outcome.kind === 'switched' } };
    } catch (e) {
      return { cart, note: { text: couponUseCopy.notApplied(getErrorMessage(e)), ok: false }, couponRejected: isStaleStateError(e) };
    }
  };
  // Đã thử áp thì gỡ mã khỏi state của mục lịch sử (như `reviewOrderId`): quay lại trang không áp lại một mã khách có thể đã bỏ chọn ở giỏ.
  const dropGroupCouponState = () => {
    const rest: Record<string, unknown> = { ...navState };
    delete rest.applyCoupon;
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: rest });
  };

  const releaseCartWrite = () => {
    cartWrite.current = false;
  };
  const writeCart = (run: () => void) => {
    if (cartWrite.current) return;
    cartWrite.current = true;
    run();
  };

  /**
   * Trả Promise để TanStack chờ trước `onSettled`: nút ghi giỏ giữ khoá tới khi số liệu mới về (tối đa `settleWithin`). Máy chủ từ chối (hết hàng, phân loại
   * ngừng bán, giá đổi) mà nhả sớm thì bấm lại trên tồn kho cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: nhả ngay.
   */
  const holdUntilFresh = (error: unknown, keys: readonly (readonly unknown[])[]) => {
    if (!isStaleStateError(error)) return undefined;
    return settleWithin(Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))));
  };

  const addMutation = useLockedMutation({
    mutationFn: async (input: { variation: VariationDetail; qty: number }) =>
      applyGroupCoupon(await addToCart(input.variation.id, input.qty)),
    onSuccess: ({ cart: updatedCart, note, couponRejected }) => {
      queryClient.setQueryData(cartKey(), updatedCart);
      haptic('medium');
      // Nút nguồn: bấm từ bảng chọn phân loại thì nút này vẫn nằm sau tấm, vẫn đo được; không thấy thì chỉ nảy huy hiệu.
      playCartFeedback(document.querySelector('.tubu-add-source'));
      clearTimeout(addedTimer.current);
      setJustAdded(true);
      addedTimer.current = setTimeout(() => setJustAdded(false), ADDED_FLASH_MS);
      if (note) dropGroupCouponState();
      // Không có ghi chú thì nút đã xác nhận bằng mắt; thanh thông báo chỉ còn khi có điều cần nói thêm (mã mua chung). Người dùng đọc màn hình vẫn nghe.
      if (note) notify({ text: `${vi.product.added} · ${note.text}`, type: note.ok ? 'success' : 'warning', duration: 3200, position: 'top' });
      else announce('status', vi.product.added);
      // Thêm giỏ đã xong nhưng máy chủ từ chối mã mua chung (hết hạn, đã dùng): làm mới danh sách mã rồi mới nhả nút, kẻo ô ưu đãi còn hiện mã đã chết.
      if (!couponRejected) return undefined;
      return settleWithin(Promise.all([queryClient.invalidateQueries({ queryKey: ['coupons'] }), queryClient.invalidateQueries({ queryKey: ['quote'] })]));
    },
    onError: (e: unknown) => {
      notify({ text: getErrorMessage(e), type: 'error' });
      return holdUntilFresh(e, [['product', slug], ['cart']]);
    },
    onSettled: releaseCartWrite,
  });

  // "Mua ngay": thêm vào giỏ rồi tới thẳng checkout (giảm 2 chạm so với thêm-giỏ→mở-giỏ→checkout).
  const buyNowMutation = useLockedMutation({
    mutationFn: async (input: { variation: VariationDetail; qty: number }) => {
      const { cart: updatedCart, note } = await applyGroupCoupon(await addToCart(input.variation.id, input.qty));
      return { updatedCart, note, variationId: input.variation.id };
    },
    onMutate: () => setBuyFreeze({ lines: cart.data?.items }),
    onSuccess: ({ updatedCart, note, variationId }, variables) => {
      queryClient.setQueryData(cartKey(), updatedCart);
      haptic('medium');
      // Chỉ chọn đúng dòng vừa "Mua ngay" — tránh charge nhầm các món khác đã có sẵn trong giỏ.
      const line = updatedCart.items.find((l) => l.variationId === variationId);
      // BE gộp theo variationId (increment atomic) — nếu variation này đã có sẵn trong giỏ,
      // dòng vừa chọn sẽ nhiều hơn `qty` vừa bấm "Mua ngay". Báo rõ để tránh hiểu lầm thanh
      // toán ít hơn/khác số lượng đã thấy trên PDP.
      const mergeNote =
        line && line.quantity > variables.qty
          ? `Sản phẩm này đã có ${line.quantity - variables.qty} trong giỏ — thanh toán gộp ${line.quantity} sản phẩm`
          : null;
      if (note) dropGroupCouponState();
      if (note) {
        notify({
          text: [mergeNote, note.text].filter(Boolean).join('. '),
          type: note.ok ? 'info' : 'warning',
          duration: 3200,
        });
      } else if (mergeNote) {
        notify({ text: mergeNote, type: 'info', duration: 3200 });
      }
      // "Mua ngay" chỉ thanh toán đúng dòng vừa thêm; ghi nhớ để tải lại trang không tính cả giỏ.
      const itemIds = line ? [line.id] : null;
      rememberCheckoutSelection(itemIds);
      navigate('/checkout', { state: { itemIds } });
    },
    onError: (e: unknown) => {
      setBuyFreeze(null);
      notify({ text: getErrorMessage(e), type: 'error' });
      return holdUntilFresh(e, [['product', slug], ['cart']]);
    },
    onSettled: releaseCartWrite,
  });

  const groupBuyMutation = useLockedMutation({
    mutationFn: (productId: string) => createGroupBuy(productId),
    onSuccess: (group) => {
      notify({ text: 'Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé 🛒', type: 'success' });
      navigate(`/group-buy/${group.id}`);
    },
    // Máy chủ từ chối (đã có nhóm đang mở, sản phẩm không còn mua chung): làm mới danh sách nhóm và sản phẩm, giữ khoá tới lúc đó.
    onError: (e: unknown) => {
      notify({ text: getErrorMessage(e), type: 'error' });
      return holdUntilFresh(e, [['group-buy'], ['product', slug]]);
    },
  });

  if (product.isLoading || (product.data && bundlesWaiting)) return <PdpSkeleton />;
  if (!product.data) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <h1 style={SR_ONLY}>{PDP_TITLE}</h1>
        {isNotFoundError(product.error) ? (
          <>
            <ErrorState message={PRODUCT_NOT_FOUND} onRetry={() => undefined} onHome={() => navigate('/')} />
            {/* Khách từ link sàn/CTV vào sản phẩm đã gỡ: cho họ chỗ đi tiếp thay vì ngõ cụt. */}
            <SuggestedRail listSource="pdp_not_found" />
          </>
        ) : (
          <ErrorState message={getLoadErrorMessage(product.error)} onRetry={() => product.refetch()} />
        )}
      </Page>
    );
  }

  const p = product.data;
  const originLink = pdpOriginLink(p.brand);
  const pdpCoupons = (couponsQ.data ?? []).filter((c) => !c.products || c.products.some((x) => x.id === p?.id));
  const flashList = runningFlash(flashWithAllowance);
  const priceView = selected ? variationPricing(selected, flashList) : cardPricing(p, flashList, serverNow());
  const price = priceView.price;
  // Tiền theo luật máy chủ: quá giới hạn Giờ vàng mỗi khách thì cả dòng giỏ (số có sẵn + số thêm) tính giá thường, không phải qty × giá Giờ vàng.
  // "Mua ngay" chọn cả dòng giỏ của phân loại nên ghi `lineTotal`; điểm tích giữ `total` (phần đang chọn thêm). Giỏ chưa tải hay lỗi thì coi là rỗng.
  const line = selected
    ? variationLinePreview(selected, flashList, quantity, inCartQuantity(cartLines, selected.id))
    : { total: price * quantity, lineTotal: price * quantity, lineQuantity: quantity, inCart: 0, overLimit: false, allowance: null, allowanceBy: null };
  // Một câu dưới ô Số lượng: mất giá Giờ vàng, hoặc giỏ đã có sẵn nên "Mua ngay" thanh toán cả dòng (nút ghi cả dòng, khách thấy số lớn hơn qty × đơn giá).
  const overLimitText = lineNote(line, quantity, true);
  // Giữ chỗ 2 dòng caption từ lần vẽ đầu khi khách đã đăng nhập đang xem Giờ vàng: câu hết suất chỉ biết sau GET /flash-sales/me/allowance (về muộn 1–3 s) và không được đẩy phần dưới.
  // Khách chưa đăng nhập hoặc sản phẩm không có Giờ vàng thì không có số theo khách để chờ, không giữ dải trống.
  const reserveFlashNote = status === 'authenticated' && priceView.isFlash;
  const originalPrice = priceView.compareAt;
  const flashPct = priceView.salePct;
  const soldText = formatSold(p.sold);
  const ratingData = reviews.data && reviews.data.count > 0 ? reviews.data : null;
  const inStock = (selected?.stock ?? 0) > 0;
  const lowStock = isLowStock(selected?.stock ?? 0);
  const cartCount = cart.data?.itemCount ?? 0;
  // Ngưỡng freeship theo hạng của khách (cùng nguồn với giỏ hàng); khách chưa đăng nhập mới dùng ngưỡng chung. Đang đăng nhập
  // hoặc giỏ chưa về thì chưa hứa số nào để khỏi hiện ngưỡng chung rồi đổi.
  const freeshipFrom =
    status === 'authenticated' ? cart.data?.freeshipThreshold : status === 'loading' || !config.isLoaded ? undefined : config.freeshipThreshold;
  // Hàng gian hàng tự giao (D4): kiện riêng theo phí của gian hàng, không đi định kỳ/mua chung (kho Tubu không giao).
  const merchant = p.fulfiller?.kind === 'MERCHANT' ? p.fulfiller : null;
  // Gian hàng tạm nghỉ/ngừng bán (R3-MERCHANT-3): xem được trang nhưng chưa mua được; không phải hàng Tubu nên cũng không có
  // freeship, đặt định kỳ hay mua chung.
  const unavailable = p.fulfiller?.kind === 'UNAVAILABLE' ? p.fulfiller : null;
  const fromStore = merchant ?? unavailable;
  const retailOnly = isRetailOnly(p);
  // Thêm giỏ và Mua ngay chung một khoá ghi giỏ nên nút kia bị bỏ qua khi một nút đang chạy: báo bằng aria-disabled (không `disabled`, để nút đang giữ focus không rớt focus).
  // Giá trị tường minh thắng giá trị Button suy từ loading/disabled, nên phải gộp cả `!selected` vào đây.
  const cartWriting = addMutation.isPending || buyNowMutation.isPending;
  const ctaAriaDisabled = cartWriting || !selected || undefined;

  const confirmVariation = async (variation: VariationDetail, qty: number) => {
    if (!sheetMode || confirming.current || cartWrite.current) return;
    confirming.current = true;
    try {
      if (status !== 'authenticated') {
        await loginWithNotice();
        if (useAuthStore.getState().status !== 'authenticated') return;
      }
      const mode = sheetMode;
      // Cả nhóm lệnh trong khoá: lối khác giành khoá lúc khách đang đăng nhập thì bảng giữ nguyên, không đóng bảng mà không ghi gì.
      writeCart(() => {
        setSheetMode(null);
        setSelectedId(variation.id);
        setQuantity(qty);
        if (mode === 'buy') buyNowMutation.mutate({ variation, qty });
        else addMutation.mutate({ variation, qty });
      });
    } finally {
      confirming.current = false;
    }
  };

  const handleAdd = async () => {
    if (needsVariationPicker(variations)) {
      setSheetMode('add');
      return;
    }
    if (status !== 'authenticated') {
      await loginWithNotice();
      if (useAuthStore.getState().status !== 'authenticated') return;
    }
    if (selected && inStock) {
      writeCart(() => {
        // Bấm mua là đã chọn: danh sách Giờ vàng về muộn không được đổi phân loại dưới tay khách sau khi bấm.
        setSelectedId(selected.id);
        addMutation.mutate({ variation: selected, qty: quantity });
      });
    }
  };

  const handleBuyNow = async () => {
    if (needsVariationPicker(variations)) {
      setSheetMode('buy');
      return;
    }
    if (status !== 'authenticated') {
      await loginWithNotice();
      if (useAuthStore.getState().status !== 'authenticated') return;
    }
    if (selected && inStock) {
      writeCart(() => {
        setSelectedId(selected.id);
        buyNowMutation.mutate({ variation: selected, qty: quantity });
      });
    }
  };

  // Chép mã vào bộ nhớ tạm; mã đã nằm sẵn trong ví nên chỉ nhắc chọn ở bước thanh toán.
  const copyCoupon = (code: string) => {
    haptic('light');
    void copyText(code).then((ok) =>
      notify(
        ok
          ? { text: fillCopy('coupon.copiedToast', { code }), type: 'success', duration: 2600 }
          : { text: fillCopy('coupon.copyShowToast', { code }), type: 'info', duration: 4000 },
      ),
    );
  };

  const onFlashEnd = () => {
    setFlashTick((t) => t + 1);
    void queryClient.invalidateQueries({ queryKey: ['flash-sales', 'active'] });
  };

  const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const hasStory = resolveStoryConfig(p) !== null;
  // "Gợi ý mua kèm hợp vị": món đang xem (phân loại đang chọn, đúng giá trang ghi) + 2 món đầu của "Khách thường mua cùng". Hai món đó chiếm chỗ ở khối này
  // nên dải "Khách thường mua cùng" bên dưới bỏ chúng; khối không hiện (hết hàng, chưa có phân loại, hết gợi ý) thì không chiếm món nào.
  const fbtCurrentPricing = selected ? addOneVariationPricing(selected, flashList, inCartQuantity(cartLines, selected.id)) : null;
  const fbtPartners = fbtCartIds ? pickFbtPartners({ currentProductId: p.id, candidates: boughtTogether.data, flash: flashList, cartProductIds: fbtCartIds }) : [];
  const fbtBundle = buildFrequentlyBoughtBundle({
    current: {
      productId: p.id,
      slug: p.slug,
      name: selected && variations.length > 1 ? joinVariationLine(p.name, variationLabel(selected.name, variations.length)) : p.name,
      thumbnail: p.thumbnail ?? null,
      variationId: selected?.id ?? null,
      // Giá của đơn vị vừa thêm theo giỏ hiện có: vượt suất Giờ vàng (đã dùng hết, hoặc giỏ đã đủ suất) thì giỏ tính giá thường cho cả dòng, nên khối không ghi giá Giờ vàng.
      price: fbtCurrentPricing ? fbtCurrentPricing.price : price,
      compareAt: fbtCurrentPricing ? fbtCurrentPricing.compareAt : originalPrice,
      inStock: inStock && !unavailable,
    },
    candidates: null,
    partners: fbtPartners,
  });
  const shelves = pdpShelves({
    currentId: p.id,
    boughtTogether: fbtCartIds ? (boughtTogether.data ?? []) : [],
    brand: related.data ?? [],
    feed: feed.data ?? [],
    claimed: fbtBundle ? new Set(fbtPartners.map((l) => l.productId)) : undefined,
  });

  const handleShare = async () => {
    if (sharing.current) return;
    sharing.current = true;
    try {
      haptic('light');
      const code = user?.referralCode;
      await shareWithFallback(
        {
          title: p.name,
          description: p.shortDesc ?? vi.home.tagline,
          thumbnail: p.thumbnail ?? undefined,
          path: withReferral(`/product/${p.slug}`, code),
        },
        withReferral(miniAppLink(`/product/${p.slug}`), code),
      );
    } finally {
      sharing.current = false;
    }
  };

  // Dòng "Vận chuyển ›" chỉ nói ai giao và phí/freeship (ngắn, tên truy cập gọn). Các lưu ý dài (thanh toán COD, chỉ bán giá lẻ, gian hàng
  // tạm nghỉ) là chữ thường dưới bảng dòng: không nằm trong nút, và thông báo trạng thái không bị bọc trong một nút bấm.
  const shippingLines: ReactNode[] = [];
  const shippingNotes: ReactNode[] = [];
  if (p.fulfiller?.kind === 'TUBU') {
    shippingLines.push(
      <div key="tubu" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
        Tubu Tree giao hàng
      </div>,
    );
  }
  if (merchant) {
    shippingLines.push(
      <div key="store-name" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
        {merchant.name} tự giao
      </div>,
    );
    if (merchant.shippingFee != null) shippingLines.push(<div key="fee">{merchantShippingLine(merchant.shippingFee, merchant.freeShipFrom)}</div>);
    shippingNotes.push(<div key="cod">Thanh toán khi nhận hàng (COD) hoặc bằng Ví Tubu, không nhận chuyển khoản hay ZaloPay.</div>);
    shippingNotes.push(<div key="retail">Hàng gian hàng tự giao chỉ bán theo giá lẻ, không dùng Điểm Xanh, chưa đặt định kỳ hay mua chung được.</div>);
  }
  if (unavailable) {
    shippingNotes.push(
      <div key="unavailable" role="status" style={{ color: 'var(--color-status-warning-fg)', fontWeight: 600 }}>
        {unavailable.reason === 'STORE_PAUSED' ? `${unavailable.name} đang tạm nghỉ, chưa nhận đơn.` : `${unavailable.name} đã ngừng bán trên Tubu Tree.`}
      </div>,
    );
  }
  if (!fromStore && p.partnerOwned) {
    shippingNotes.push(<div key="partner">Hàng của gian hàng đối tác chỉ bán theo giá lẻ, không dùng Điểm Xanh, chưa đặt định kỳ hay mua chung được.</div>);
  }
  // Badge freeship ở nơi ra quyết định mua (trước đây chỉ có ở giỏ).
  if (!fromStore && freeshipFrom != null) {
    shippingLines.push(
      <div key="freeship" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
        {freeshipFrom > 0 ? vi.product.freeshipFrom(formatVnd(freeshipFrom)) : vi.product.freeshipAll}
      </div>,
    );
  }
  const infoRows: { key: string; icon: ReactNode; title: string; subtitle: ReactNode; onPress?: () => void }[] = [];
  if (pdpCoupons.length > 0) {
    infoRows.push({
      key: 'offers',
      icon: <Icon icon={Ticket} size="md" tone="brand" />,
      title: fillCopy('pdp.offers'),
      subtitle: fillCopy('pdp.offerCount', { n: pdpCoupons.length }),
      onPress: () => setOffersOpen(true),
    });
  }
  if (shippingLines.length > 0) {
    // Hàng Tubu: bấm tới Cam kết Tubu (giao, đổi trả). Hàng gian hàng tự giao không có cam kết đó nên dòng chỉ để đọc, không bấm được.
    infoRows.push({
      key: 'shipping',
      icon: <Icon icon={Truck} size="md" tone="brand" />,
      title: fillCopy('pdp.shipping'),
      subtitle: <>{shippingLines}</>,
      onPress: fromStore ? undefined : () => scrollToId('pdp-promises'),
    });
  }

  return (
    <Page className="page page-bleed" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>

      <StorefrontContextBar />
      <Gallery key={p.slug} images={p.images.length > 0 ? p.images : p.thumbnail ? [p.thumbnail] : []} alt={p.name} />
      {flashItem && priceView.isFlash && (
        <FlashPriceBar
          price={price}
          compareAt={originalPrice}
          pct={flashPct}
          endAt={flashItem.endAt}
          soldPct={soldPercent(flashItem.soldCount, flashItem.quota)}
          soldOut={flashItem.soldCount >= flashItem.quota}
          perUserLimit={flashItem.perUserLimit}
          onEnd={onFlashEnd}
        />
      )}

      {/* ── Info chính ── */}
      <Box p={4} style={{ background: 'var(--color-bg-surface)' }}>
        <Box flex alignItems="center" style={{ gap: 6 }}>
          {/* Nhãn và chip xuất xứ xuống dòng trong nhóm này (flexWrap, minWidth 0) để cụm Tim/Chia sẻ bên phải không bị đẩy tràn ở 320px. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 'var(--space-inline-md)', minWidth: 0 }}>
          {/* Lọc theo tên nhãn đúng như catalog (p.brand), không phải slug: API so khớp chính xác tên. */}
          <button
            type="button"
            className="tubu-press"
            aria-label={brandBrowseLabel(p.brand)}
            onClick={() => navigate(brandBrowsePath(p.brand))}
            style={LINK_BUTTON_STYLE}
          >
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: '50%', background: brandAccent(p.brand) }}
            />
            <Text size="xSmall" bold style={{ color: 'var(--color-text-secondary)' }}>
              {p.brand}
            </Text>
            <Icon icon={ChevronRight} size="sm" tone="muted" />
          </button>
          {originLink && (
            <button
              type="button"
              className="tubu-press"
              data-testid="pdp-origin-link"
              aria-label={originLink.ariaLabel}
              onClick={() => navigate(`/brand-story?brand=${encodeURIComponent(originLink.id)}`)}
              style={{ ...LINK_BUTTON_STYLE, minWidth: 0, maxWidth: '100%' }}
            >
              <MapPin size={14} color="var(--color-text-brand)" aria-hidden style={{ flex: 'none' }} />
              <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {originLink.label}
              </Text>
            </button>
          )}
          </div>
          <Box style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <WishlistHeart productId={p.id} size={22} />
          </Box>
          <Box
            role="button"
            {...rowKeyboardProps()}
            aria-label={vi.product.share}
            className="tubu-press"
            onClick={handleShare}
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Share2 size={20} color="var(--color-text-brand)" strokeWidth={2} />
          </Box>
        </Box>

        {/* Trang hero không có PageHeader nên tên sản phẩm là h1 duy nhất. */}
        <h1 style={PRODUCT_NAME_STYLE}>{p.name}</h1>

        {/* Giờ vàng: dòng giá trống (giá nằm ở FlashPriceBar dưới ảnh) nên "Đã bán" dời lên dòng đánh giá, không để một dòng gần như trống. */}
        {(ratingData || (priceView.isFlash && soldText)) && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 6 }}>
            {ratingData && (
              <>
                <Stars value={ratingData.average} size={14} />
                <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                  {formatRating(ratingData.average)} · {ratingData.count} đánh giá
                </Text>
              </>
            )}
            {priceView.isFlash && soldText && (
              <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginLeft: ratingData ? 'auto' : 0 }}>
                {soldText}
              </Text>
            )}
          </Box>
        )}

        {!priceView.isFlash && (
          <Box flex alignItems="baseline" style={{ gap: 8, marginTop: 8 }}>
            <PriceTag value={price} compareAt={originalPrice} size="xl" tone={originalPrice ? 'deal' : 'default'} />
            {flashPct > 0 && (
              <Badge tone="promo" size="sm">
                -{flashPct}%
              </Badge>
            )}
            {soldText && (
              <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
                {soldText}
              </Text>
            )}
          </Box>
        )}

        <PointsEarnLine goods={line.total} authStatus={status} tierId={user?.tierId} />

        {inStock && !unavailable && (
          <Text size="xSmall" data-testid={lowStock ? 'pdp-low-stock' : 'pdp-stock-label'} style={{ color: lowStock ? 'var(--color-text-warning)' : 'var(--color-text-secondary)', marginTop: 4 }}>
            {vi.product.lowStock(selected!.stock)}
          </Text>
        )}

        {/* Mô tả ngắn trùng nguyên văn mô tả dài thì khách đọc hai lần: chỉ giữ ở mục Mô tả. */}
        {p.shortDesc && p.shortDesc.trim() !== (p.description ?? '').trim() && (
          <Text size="small" style={{ color: 'var(--color-text-secondary)', marginTop: 8 }}>
            {p.shortDesc}
          </Text>
        )}

        {p.certifications.length > 0 && (
          <Box flex style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {p.certifications.map((c) => (
              <Text
                key={c}
                size="xSmall"
                style={{
                  background: 'var(--color-bg-subtle)',
                  color: 'var(--color-text-brand)',
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-pill)',
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Icon icon={Check} size="sm" tone="brand" />
                {c}
              </Text>
            ))}
          </Box>
        )}

        {SUBSCRIPTIONS_IN_MINIAPP && selected && inStock && !retailOnly && (
          <Box
            role="button"
            {...rowKeyboardProps()}
            className="tubu-press"
            onClick={async () => {
              haptic('light');
              if (status !== 'authenticated') {
                await loginWithNotice();
                if (useAuthStore.getState().status !== 'authenticated') return;
              }
              setShowSubscribe(true);
            }}
            flex
            alignItems="center"
            style={{
              gap: 8,
              marginTop: 12,
              minHeight: 44,
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: 'var(--radius-control)',
              border: '1px dashed var(--color-border-selected)',
              background: 'var(--color-bg-subtle)',
            }}
          >
            <Repeat size={18} color="var(--color-text-brand)" strokeWidth={1.9} />
            <Text size="small" bold style={{ color: 'var(--color-text-brand)', flex: 1 }}>
              Đặt định kỳ — tiết kiệm {Math.round(config.subscribeDiscountPct * 100)}%
            </Text>
            <ChevronRight size={18} color="var(--color-text-brand)" strokeWidth={2} />
          </Box>
        )}
      </Box>

      {/* ── Dòng thông tin (Ưu đãi, Vận chuyển) ›, ghi chú, chip phân loại; Số lượng liền ngay dưới. Không có dòng "Phân loại ›": chip đã nêu đủ tên, giá, hết hàng, và Thêm giỏ/Mua ngay vẫn mở bảng chọn ── */}
      {(infoRows.length > 0 || shippingNotes.length > 0 || variations.length > 1) && (
        <Box px={4} pt={infoRows.length > 0 || shippingNotes.length > 0 ? 0 : 3} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          {infoRows.map((row, i) => (
            <ListRow
              key={row.key}
              icon={row.icon}
              title={row.title}
              subtitle={row.subtitle}
              trailing={row.onPress ? 'chevron' : undefined}
              onPress={row.onPress}
              style={i < infoRows.length - 1 ? { boxShadow: 'inset 0 -1px 0 var(--color-border-subtle)' } : undefined}
            />
          ))}
          {shippingNotes.length > 0 && (
            <div
              data-testid="pdp-shipping-notes"
              style={{
                display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0 12px',
                fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-tertiary)',
              }}
            >
              {shippingNotes}
            </div>
          )}
          {variations.length > 1 && (
            <div
              role="group"
              aria-label="Phân loại nhanh"
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 12 }}
            >
              {variations.map((v) => (
                <VariationChip
                  key={v.id}
                  variation={v}
                  pricing={variationPricing(v, flashList)}
                  active={selected?.id === v.id}
                  onClick={() => {
                    haptic('light');
                    setSelectedId(v.id);
                  }}
                />
              ))}
            </div>
          )}
        </Box>
      )}

      {/* ── Số lượng: liền dưới phân loại, trước Combo và Đánh giá nhanh ── */}
      <Box p={4} mt={2} flex alignItems="center" justifyContent="space-between" style={{ background: 'var(--color-bg-surface)' }}>
        <Text bold size="small">
          {vi.product.quantity}
        </Text>
        <QuantitySelector
          value={quantity}
          max={qtyPickMax(selected?.stock ?? 0)}
          onChange={(n) => {
            haptic('light');
            setQuantity(n);
          }}
        />
      </Box>
      {/* Mua quá giới hạn Giờ vàng mỗi khách (máy chủ tính cả dòng giá thường) hoặc giỏ đã có sẵn phân loại này (Mua ngay thanh toán cả dòng): nói trước ở đây, nút Mua ngay đã ghi đúng số đó. Chỉ đẩy phần bên dưới, không dịch ô Số lượng. */}
      <div
        role="status"
        data-section="pdp-flash-limit"
        style={{
          background: 'var(--color-bg-surface)',
          minHeight: reserveFlashNote ? 'calc(var(--type-caption-size) * var(--type-caption-lh) * 2 + var(--space-inset-card) + 1px)' : undefined,
        }}
      >
        {overLimitText && (
          <p
            style={{
              margin: 0,
              // Ngang bằng dải Số lượng ngay trên (Box p={4} = 16px) và phoneBandPad của web; dưới 12px như max-md:pb-3 của web.
              padding: '0 var(--space-inset-page) var(--space-inset-card)',
              fontSize: 'var(--type-caption-size)',
              lineHeight: 'var(--type-caption-lh)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {overLimitText}
          </p>
        )}
      </div>

      {/* Dải cam kết ngay dưới khối mua nhanh (chip, Số lượng, lưu ý Giờ vàng), trước dải câu chuyện; web điện thoại cùng thứ tự (order 7, đứng trước dải câu chuyện). */}
      <ProductTrustStrip view={productTrustStrip({ fulfillerKind: p.fulfiller?.kind, returnWindowDays: config.returnWindowDays })} onOpenPolicy={setPolicySlug} />

      {/* Dải câu chuyện ngay dưới khối mua nhanh (chip, Số lượng), trước Combo và Đánh giá nhanh, như đặc tả; web điện thoại cùng thứ tự (order 7).
          Dải đã kể đủ các chương ngay trên trang và nút mua nằm ở thanh dưới, nên không có nút/khung toàn màn mở lại cùng nội dung (như web); khung toàn màn chỉ còn cho Reel ở Trang chủ. */}
      {hasStory && (
        <Suspense fallback={null}>
          <ProductStoryShowcase
            product={p}
            selectedVariationId={selected?.id}
            onSelectVariation={(id) => {
              haptic('light');
              setSelectedId(id);
            }}
          />
        </Suspense>
      )}

      {fbtBundle && <PdpFbt bundle={fbtBundle} />}

      {slug && <PdpBundles slug={slug} productName={product.data?.name} />}

      {reviews.data && reviews.data.count > 0 && (
        <PdpQuickReviews average={reviews.data.average} count={reviews.data.count} items={reviews.data.items ?? []} onSeeAll={() => scrollToId('danh-gia')} />
      )}

      {/* ── Mua chung (§6.14.8) ── */}
      {!retailOnly && (
        <Box
          className="tubu-press"
          role="button"
          {...rowKeyboardProps()}
          p={4}
          mt={2}
          // Trước đây bắn mutation ngay khi chạm: chưa đăng nhập thì ra lỗi 401 khó hiểu, chạm
          // 2 lần thì tạo 2 nhóm, và không có trạng thái chờ nên tưởng không ăn (P2-7 audit).
          // Các hành động khác trên trang này (Thêm giỏ / Mua ngay / Đặt định kỳ) đều đã guard.
          onClick={async () => {
            haptic('light');
            if (status !== 'authenticated') {
              await loginWithNotice();
              return;
            }
            groupBuyMutation.mutate(p.id);
          }}
          style={{
            background: 'var(--color-bg-surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            opacity: groupBuyMutation.isPending ? 0.6 : 1,
          }}
        >
          <Box style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center' }}>
            <Users size={20} color="var(--color-text-brand)" strokeWidth={2} />
          </Box>
          <Box style={{ flex: 1 }}>
            <Text size="small" bold style={{ color: 'var(--color-text-brand)' }}>
              {groupBuyMutation.isPending ? 'Đang mở nhóm…' : 'Mở nhóm mua chung — nhận mã giảm giá khi đủ người'}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
              {groupBuyPitch(config.groupBuy)}
            </Text>
          </Box>
          <ChevronRight size={18} color="var(--color-text-brand)" strokeWidth={2} />
        </Box>
      )}

      {isAffiliate && (
        <Box
          className="tubu-press"
          p={4}
          mt={2}
          role="button"
          {...rowKeyboardProps()}
          aria-label={vi.contentKit.sheetTitle}
          onClick={() => {
            haptic('light');
            setShowContentKit(true);
          }}
          style={{ background: 'var(--color-bg-surface)', display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <Box style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-action-secondary-bg)', display: 'grid', placeItems: 'center' }}>
            <Megaphone size={20} color="var(--color-text-brand)" strokeWidth={2} />
          </Box>
          <Box style={{ flex: 1 }}>
            <Text size="small" bold style={{ color: 'var(--color-text-brand)' }}>
              {vi.contentKit.sheetTitle}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
              Bài mẫu đã gắn sẵn link giới thiệu của bạn — chép là đăng được
            </Text>
          </Box>
          <ChevronRight size={18} color="var(--color-text-brand)" strokeWidth={2} />
        </Box>
      )}

      {/* ── Thành phần (spec §6.2 — niềm tin cho persona sợ hoá chất) ── */}
      {p.ingredients && p.ingredients.length > 0 && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <SectionTitle block style={{ marginBottom: 10 }}>Thành phần</SectionTitle>
          <Box flex flexDirection="column" style={{ gap: 10 }}>
            {p.ingredients.map((ing, i) => (
              <Box key={i} flex style={{ gap: 10 }}>
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-text-brand)', marginTop: 6, flex: '0 0 auto' }}
                />
                <Box style={{ flex: 1 }}>
                  <Box flex alignItems="center" style={{ gap: 6 }}>
                    <Text size="small" bold>
                      {ing.name}
                    </Text>
                    {ing.percentage && (
                      <Text
                        size="xSmall"
                        style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-brand)', padding: '1px 6px', borderRadius: 'var(--radius-pill)' }}
                      >
                        {ing.percentage}
                      </Text>
                    )}
                  </Box>
                  {ing.benefit && (
                    <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                      {ing.benefit}
                    </Text>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* ── Cam kết / chính sách (tín hiệu an tâm trước mua — trước đây PDP không có) ── */}
      <Box id="pdp-promises" p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <SectionTitle block style={{ marginBottom: 8 }}>Cam kết Tubu</SectionTitle>
        <Box flex flexDirection="column" style={{ gap: 6 }}>
          {['Hàng chính hãng — nguồn gốc rõ ràng', returnsPromise(config.returnWindowDays), 'Sản phẩm xanh, an lành cho cả nhà'].filter((t): t is string => t !== null).map((t) => (
            <Box key={t} flex alignItems="center" style={{ gap: 8 }}>
              <Icon icon={Check} size="sm" tone="brand" style={{ flexShrink: 0 }} />
              <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>{t}</Text>
            </Box>
          ))}
        </Box>
        <Button variant="ghost" onPress={() => setPolicySlug('van-chuyen')} style={{ minWidth: 0 }}>
          {POLICY_TITLES['van-chuyen']}
        </Button>
        {/* Chat OA ở đây, không ở thanh CTA dính: thêm nút 48px vào thanh làm hai nút chính hẹp lại ở màn 360px. */}
        {(hasOA || chatReady) && (
          <Button
            variant="secondary"
            icon={MessageCircle}
            onPress={() => {
              haptic('light');
              if (chatReady) navigate(`/chat?product=${encodeURIComponent(p.slug)}`);
              else void openOAChat(vi.product.chatAbout(p.name));
            }}
            style={{ marginTop: 12, minWidth: 0 }}
          >
            {vi.product.chatWithShop}
          </Button>
        )}
        {chatOn && !chatReady && status !== 'loading' && status !== 'error' && (
          <Button
            variant="secondary"
            icon={MessageCircle}
            onPress={() => {
              haptic('light');
              void loginWithNotice();
            }}
            style={{ marginTop: 12, minWidth: 0 }}
          >
            Đăng nhập để chat với Tubu Tree
          </Button>
        )}
      </Box>

      {/* ── Mô tả ── */}
      {p.description && <CollapsibleDescription text={p.description} />}

      {/* ── Đánh giá ── */}
      {slug && (
        <ReviewsSection
          slug={slug}
          onQuickAdd={inStock ? () => void handleAdd() : undefined}
          openForOrderId={navState?.reviewOrderId}
          onOrderLinkUsed={() => {
            // Thay đúng mục lịch sử hiện tại, giữ mọi trạng thái điều hướng khác (from, variationId, listSource).
            const rest: Record<string, unknown> = { ...navState };
            delete rest.reviewOrderId;
            navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: rest });
          }}
        />
      )}

      {selected && (
        <SubscribeSheet
          visible={showSubscribe}
          onClose={() => setShowSubscribe(false)}
          variationId={selected.id}
          quantity={quantity}
        />
      )}

      {needsVariationPicker(variations) && (
        <VariationSheet
          open={sheetMode !== null}
          onClose={() => setSheetMode(null)}
          mode={sheetMode ?? 'add'}
          productName={p.name}
          thumbnail={p.thumbnail}
          variations={variations}
          flash={flashList}
          initialId={selected?.id ?? null}
          initialQty={quantity}
          busy={addMutation.isPending || buyNowMutation.isPending}
          cartLines={cartLines}
          // 'idle' = khách chưa đăng nhập, giỏ không bao giờ về nên bảng Mua ngay không giữ dải ghi chú trống; 'loading' và 'error' thì giỏ vẫn có thể về.
          cartMayArrive={status !== 'idle'}
          onConfirm={(v, qty) => confirmVariation(v as VariationDetail, qty)}
        />
      )}

      <PolicySheet slug={policySlug} onClose={() => setPolicySlug(null)} />

      <PdpOffersSheet open={offersOpen} onClose={() => setOffersOpen(false)} coupons={pdpCoupons} amount={offerAmount(price, quantity, priceView.isFlash)} onCopy={copyCoupon} />

      {slug && (
        <ContentKitSheet
          visible={showContentKit}
          onClose={() => setShowContentKit(false)}
          productSlug={slug}
        />
      )}

      {/* ── Khách thường mua cùng (§6.12 co-occurrence; tên cũ "Thường mua kèm" nhường chữ "mua kèm" cho ưu đãi giảm giá) ── */}
      {shelves.boughtTogether.length > 0 && (
        <>
          <Box pt={4} pb={2} px={4} flex alignItems="center" style={{ gap: 6 }}>
            <ShoppingCart size={18} color="var(--color-text-primary)" strokeWidth={1.9} />
            <SectionTitle block>{fillCopy('pdp.boughtTogether')}</SectionTitle>
          </Box>
          <ProductRail label={fillCopy('pdp.boughtTogether')} variant="rail-md" items={shelves.boughtTogether} />
        </>
      )}

      {/* ── Cùng thương hiệu ── */}
      {shelves.brand.length > 0 && (
        <>
          <Box pt={4} pb={2} px={4}>
            <SectionTitle block>{fillCopy('pdp.brandShelf')}</SectionTitle>
          </Box>
          <ProductRail label={fillCopy('pdp.brandShelfLabel', { brand: p.brand })} variant="rail-md" items={shelves.brand} />
        </>
      )}

      <PdpFeed items={shelves.feed} />

      {/* ── Sticky CTA ── */}
      <StickyActionBar
        secondary={
          <Box
            role="button"
            {...rowKeyboardProps()}
            aria-label={vi.product.viewCart}
            data-cart-target=""
            className="tubu-press"
            onClick={() => navigate('/cart')}
            style={{
              position: 'relative',
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--color-action-secondary-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 auto',
            }}
          >
            <CartIcon />
            <CartBadge count={cartCount} />
          </Box>
        }
        primary={
          unavailable ? (
            <Button variant="primary" size="lg" fullWidth disabled>
              Tạm thời chưa mua được
            </Button>
          ) : inStock ? (
            // CTA đôi kiểu Shopee: Thêm giỏ (viền) + Mua ngay (đặc, tới thẳng checkout).
            <Box flex style={{ gap: 10 }}>
              <Button
                variant="secondary"
                size="lg"
                loading={addMutation.isPending}
                disabled={!selected}
                aria-disabled={ctaAriaDisabled}
                onPress={handleAdd}
                className="tubu-add-source"
                style={{ flex: 1 }}
              >
                {justAdded ? (
                  <span className="tubu-pop" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Check size={16} strokeWidth={2.25} aria-hidden="true" />
                    {vi.product.addedShort}
                  </span>
                ) : (
                  vi.product.addToCart
                )}
              </Button>
              {/* 2 dòng (nhãn + giá): "Mua ngay · 1.250.000đ" một dòng cần ~170px, trong khi mỗi nút
                  chỉ còn ~110-140px ở 320-390px → trước đây tràn khỏi màn hình. aria-label là câu một dòng "Mua ngay <giá>" cho trình đọc màn hình (và cả lúc loading — I1). */}
              <Button
                variant="primary"
                size="lg"
                loading={buyNowMutation.isPending}
                disabled={!selected}
                aria-disabled={ctaAriaDisabled}
                onPress={handleBuyNow}
                aria-label={`${buyNowMutation.isPending ? 'Đang xử lý…' : 'Mua ngay'} ${formatVnd(line.lineTotal)}`}
                style={{ flex: 1, paddingTop: 6, paddingBottom: 6 }}
              >
                <span style={BUY_NOW_LINE}>{buyNowMutation.isPending ? 'Đang xử lý…' : 'Mua ngay'}</span>
                {/* Khoảng trắng giữa hai khối (flex không vẽ ra) để chữ nhìn thấy khớp aria-label (WCAG 2.5.3). */}
                {' '}
                <span style={{ ...BUY_NOW_LINE, fontSize: 'var(--type-caption-size)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {formatVnd(line.lineTotal)}
                </span>
              </Button>
            </Box>
          ) : (
            <Button variant="primary" size="lg" fullWidth disabled>
              {vi.product.outOfStock}
            </Button>
          )
        }
      />
    </Page>
  );
}

/** Nút chữ trần cạnh tên sản phẩm (tên nhãn, chip xuất xứ): vùng chạm cao 44px, không nền, không viền. */
const LINK_BUTTON_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, padding: 0,
  background: 'none', border: 'none', cursor: 'pointer', font: 'inherit',
};

/** Tên sản phẩm: Inter 18/600 (title-md) — đậm và lớn hơn tiêu đề mục (title-sm) nhưng vẫn dưới giá (24/700).
 * `font: inherit` của h1 mặc định bị thay bằng đúng bậc chữ của DS. */
const PRODUCT_NAME_STYLE: CSSProperties = {
  margin: '2px 0 0',
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--type-title-md-size)',
  lineHeight: 'var(--type-title-md-lh)',
  fontWeight: 'var(--type-title-md-weight)' as unknown as number,
  color: 'var(--color-text-primary)',
};

/** Một dòng của nhãn 2 dòng trên nút "Mua ngay" (thanh CTA dính đáy). */
const BUY_NOW_LINE: CSSProperties = {
  display: 'block',
  lineHeight: 1.2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** Bề rộng ảnh chi tiết ở khổ điện thoại (CSS px): chọn bản đổi cỡ 640 (1x) và 960 (2x). */
const GALLERY_IMAGE_WIDTH = 480;

/** Một ảnh của carousel: tải lỗi thì rơi về hình lá chung, giữ nguyên ô vuông và vị trí cuộn. */
export function GallerySlide({ src, alt, eager }: { src: string; alt: string; eager: boolean }) {
  const [failed, setFailed] = useState(false);
  const { img, fallBack } = useSizedImage(src, GALLERY_IMAGE_WIDTH);
  const frame = { width: '100%', aspectRatio: '1 / 1', flex: '0 0 100%', scrollSnapAlign: 'center', display: 'block' } as const;
  if (failed || !img) {
    return (
      <div data-testid="gallery-fallback" style={{ ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-subtle)' }}>
        <LeafGlyph size={72} />
      </div>
    );
  }
  return <img src={img.src} srcSet={img.srcSet} alt={alt} width={GALLERY_IMAGE_WIDTH} height={GALLERY_IMAGE_WIDTH} loading={eager ? 'eager' : 'lazy'} decoding={eager ? 'auto' : 'async'} onError={() => fallBack() || setFailed(true)} style={{ ...frame, objectFit: 'cover' }} />;
}

/** Carousel ảnh scroll-snap + dots — không cần lib ngoài. */
function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState(0);
  // Ảnh không bấm được nên vùng cuộn phải tự focus được khi tràn, nếu không bàn phím không lật ảnh được (axe scrollable-region-focusable).
  const track = useScrollHints<HTMLDivElement>();

  if (images.length === 0) {
    return (
      <Box
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--color-bg-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LeafGlyph size={72} />
      </Box>
    );
  }

  const onScroll = () => {
    track.onScroll();
    const el = track.ref.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <Box style={{ position: 'relative' }}>
      <div
        ref={track.ref}
        role="region"
        aria-label="Ảnh sản phẩm"
        tabIndex={track.tabIndex}
        onScroll={onScroll}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {images.map((src, i) => (
          <GallerySlide key={src} src={src} alt={`${alt} — ảnh ${i + 1}`} eager={i === 0} />
        ))}
      </div>
      {images.length > 1 && (
        <Box
          aria-hidden
          style={{
            position: 'absolute',
            bottom: 10,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          {images.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === index ? 16 : 6,
                height: 6,
                borderRadius: 'var(--radius-pill)',
                background: i === index ? 'var(--color-action-primary-bg)' : 'var(--color-media-dot-idle)',
                transition: 'width var(--dur-base) var(--ease-out)',
                boxShadow: 'var(--elevation-1)',
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Mô tả thu gọn 4 dòng + nút Xem thêm. */
function CollapsibleDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 220;
  return (
    <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
      <SectionTitle block>{vi.product.description}</SectionTitle>
      <Text
        size="small"
        style={{
          color: 'var(--color-text-secondary)',
          marginTop: 6,
          whiteSpace: 'pre-line',
          ...(expanded || !isLong
            ? {}
            : {
                display: '-webkit-box',
                WebkitLineClamp: DESC_COLLAPSED_LINES,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }),
        }}
      >
        {text}
      </Text>
      {isLong && (
        <Text
          role="button"
          {...rowKeyboardProps()}
          size="small"
          bold
          onClick={() => setExpanded((e) => !e)}
          style={{ color: 'var(--color-text-brand)', marginTop: 8, padding: '8px 0' }}
        >
          {expanded ? vi.product.descriptionLess : vi.product.descriptionMore}
        </Text>
      )}
    </Box>
  );
}

function CartIcon() {
  return <ShoppingCart size={22} color="var(--color-text-brand)" strokeWidth={1.9} />;
}

/** Skeleton match layout PDP. */
function PdpSkeleton() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <h1 style={SR_ONLY}>{PDP_TITLE}</h1>
      <Skeleton height="auto" radius="0" style={{ aspectRatio: '1 / 1' }} />
      <Box p={4} style={{ background: 'var(--color-bg-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton width={70} height={12} />
        <Skeleton width="85%" height={18} />
        <Skeleton width={120} height={24} />
        <Skeleton width="100%" height={13} />
        <Skeleton width="70%" height={13} />
      </Box>
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)', display: 'flex', gap: 8 }}>
        <Skeleton width={92} height={44} />
        <Skeleton width={92} height={44} />
        <Skeleton width={92} height={44} />
      </Box>
    </Page>
  );
}
