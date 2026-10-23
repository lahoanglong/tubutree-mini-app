import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Box, Page, Text, useNavigate, useParams, useSnackbar, useLocation } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Repeat, ChevronRight, ShoppingCart, Share2, Users, Truck, Megaphone, Check, MessageCircle, Clock } from 'lucide-react';
import {
  fetchProduct,
  fetchRelated,
  fetchBoughtTogether,
  getCart,
  addToCart,
  fetchActiveFlashSales,
  type VariationDetail,
  type ProductCard as ProductCardData,
  type FlashSaleActiveItem,
} from '../services/shop-api';
import { getErrorMessage, isNotFoundError } from '../services/api';
import { getCoupons, type CouponDTO } from '../services/account-api';
import { createGroupBuy } from '../services/groupbuy-api';
import { groupBuyPitch } from '../utils/group-buy-copy';
import { useAuthStore } from '../store/auth';
import { useShareWithFallback } from '../components/share-sheet';
import { WEB_BASE_URL } from '../utils/web-base-url';
import { withReferral } from '../utils/share-link';
import { ReviewsSection, Stars } from '../components/reviews-section';
import { WishlistHeart } from '../components/wishlist-heart';
import { SubscribeSheet } from '../components/subscribe-sheet';
import { fetchReviews } from '../services/shop-api';
import { tilePricing } from '../components/catalog/catalog-pricing';
import { trackEvent } from '../services/analytics';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { SuggestedRail } from '../components/catalog/suggested-rail';
import { SR_ONLY } from '../components/ui/sr-only';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { brandAccent, brandBrowseLabel, brandBrowsePath } from '../utils/brands';
import { formatVnd, formatSold } from '../utils/format';
import { soldPercent } from '../utils/flash-display';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { hasOA, openOAChat } from '../services/zmp-bridge';
import { isRetailOnly } from '../utils/retail-only';
import { StorefrontContextBar } from '../components/storefront-context-bar';
import { useCountdown } from '../hooks/use-countdown';
import { usePublicConfig } from '../hooks/use-public-config';
import { useRecordRecentlyViewed } from '../hooks/use-record-recently-viewed';
import { rememberCheckoutSelection } from '../utils/checkout-selection';
import { getAffiliateMe } from '../services/affiliate-api';
import { ContentKitSheet } from '../components/content-kit-sheet';
import { CartBadge } from '../components/ui/cart-badge';
import { copyText } from '../utils/clipboard';
import { Button } from '../components/ui/button';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { SectionTitle } from '../components/ui/section-title';
import { PriceTag } from '../components/ui/price-tag';
import { PointsEarnLine } from '../components/product/points-earn-line';
import { PointsBoostStrip } from '../components/loyalty/points-boost-strip';
import { Badge } from '../components/ui/badge';
import { Icon } from '../components/ui/icon';
import { ProductTile } from '../components/ui/product-tile';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { ScrollRow } from '../components/ui/scroll-row';
import { useScrollHints } from '../components/ui/use-scroll-hints';
import { cartKey, useCartKey } from '../services/cart-key';

const LOW_STOCK_THRESHOLD = 5;
const DESC_COLLAPSED_LINES = 4;
// Khung chờ và khung lỗi chưa có tên sản phẩm; h1 ẩn giữ cho route luôn đúng một h1.
const PDP_TITLE = 'Chi tiết sản phẩm';

/** Phí giao của gian hàng tự giao, như lúc thanh toán tính cho kiện của gian hàng. */
function merchantShippingLine(fee: number, freeShipFrom: number | null): string {
  if (fee <= 0) return 'Gian hàng miễn phí giao hàng';
  const base = `Phí giao ${formatVnd(fee)}`;
  return freeShipFrom != null ? `${base}, miễn phí cho đơn của gian hàng từ ${formatVnd(freeShipFrom)}` : base;
}

/** Nhãn ngắn cho voucher hiển thị ở PDP. */
function couponLabel(c: CouponDTO): string {
  if (c.type === 'FREESHIP') return 'Miễn phí giao hàng';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`;
  return `Giảm ${formatVnd(c.value)}`;
}

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const shareWithFallback = useShareWithFallback();
  const queryClient = useQueryClient();
  const { status, login, user } = useAuthStore();
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

  // Thẻ "Ưu đãi giờ vàng" truyền variationId qua state để PDP mở đúng phân loại đang giảm;
  // không có state (vào từ lưới sản phẩm/deep link) thì giữ hành vi cũ là tự chọn phân loại
  // đầu tiên còn hàng.
  const location = useLocation();
  const navState = location.state as { variationId?: string; listSource?: string; reviewOrderId?: string } | null;
  const [selectedId, setSelectedId] = useState<string | null>(navState?.variationId ?? null);
  const [quantity, setQuantity] = useState(1);
  const [badgeBounce, setBadgeBounce] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [showContentKit, setShowContentKit] = useState(false);
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
  });
  // "Đã xem gần đây" (spec 5b.4): ghi khi PDP mở THÀNH CÔNG. Đặt trước mọi early-return (luật hook).
  useRecordRecentlyViewed(product.isSuccess ? product.data : undefined);
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
  const cart = useQuery({
    queryKey: useCartKey(),
    queryFn: getCart,
    enabled: status === 'authenticated',
  });
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
    refetchInterval: 60_000,
  });

  // Mặc định chọn phân loại đầu tiên CÒN HÀNG (không phải đầu danh sách).
  const variations = product.data?.variations ?? [];
  // Memo theo (selectedId + danh sách variation) — tránh tạo ref mới mỗi render gây effect chạy dư.
  const selected = useMemo(
    () =>
      variations.find((v) => v.id === selectedId) ??
      variations.find((v) => v.stock > 0) ??
      variations[0],
    [selectedId, variations],
  );

  // Flash sale đang chạy cho ĐÚNG phân loại đang chọn (BE re-resolve giá thật lúc thêm giỏ/checkout).
  const flashItem = selected ? (flashQ.data ?? []).find((f) => f.variationId === selected.id) : undefined;
  const flashLeft = useCountdown(flashItem?.endAt ?? null);

  // Đổi phân loại → kẹp lại số lượng theo tồn kho mới (chỉ phụ thuộc id/stock, không phải ref).
  useEffect(() => {
    if (selected && quantity > Math.max(1, selected.stock)) {
      setQuantity(Math.max(1, selected.stock));
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
    const baseSelectedPrice = selected.salePrice ?? selected.retailPrice ?? product.data.basePrice;
    const viewPrice = flashItem ? Math.min(flashItem.flashPrice, baseSelectedPrice) : baseSelectedPrice;
    void trackEvent('product_viewed', 'miniapp', {
      productId: product.data.id,
      variationId: selected.id,
      price: viewPrice,
      isFlash: Boolean(flashItem),
      inStock: selected.stock > 0,
      listSource: navState?.listSource ?? 'browse',
    });
  }, [product.isSuccess, product.data, selected, flashItem, flashQ.isPending]);

  const addMutation = useMutation({
    mutationFn: (input: { variation: VariationDetail; qty: number }) =>
      addToCart(input.variation.id, input.qty),
    onSuccess: (updatedCart) => {
      queryClient.setQueryData(cartKey(), updatedCart);
      haptic('medium');
      setBadgeBounce(true);
      openSnackbar({ text: vi.product.added, type: 'success', duration: 2000 });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  // "Mua ngay": thêm vào giỏ rồi tới thẳng checkout (giảm 2 chạm so với thêm-giỏ→mở-giỏ→checkout).
  const buyNowMutation = useMutation({
    mutationFn: (input: { variation: VariationDetail; qty: number }) =>
      addToCart(input.variation.id, input.qty).then((updatedCart) => ({ updatedCart, variationId: input.variation.id })),
    onSuccess: ({ updatedCart, variationId }, variables) => {
      queryClient.setQueryData(cartKey(), updatedCart);
      haptic('medium');
      // Chỉ chọn đúng dòng vừa "Mua ngay" — tránh charge nhầm các món khác đã có sẵn trong giỏ.
      const line = updatedCart.items.find((l) => l.variationId === variationId);
      // BE gộp theo variationId (increment atomic) — nếu variation này đã có sẵn trong giỏ,
      // dòng vừa chọn sẽ nhiều hơn `qty` vừa bấm "Mua ngay". Báo rõ để tránh hiểu lầm thanh
      // toán ít hơn/khác số lượng đã thấy trên PDP.
      if (line && line.quantity > variables.qty) {
        openSnackbar({
          text: `Sản phẩm này đã có ${line.quantity - variables.qty} trong giỏ — thanh toán gộp ${line.quantity} sản phẩm`,
          type: 'info',
          duration: 3200,
        });
      }
      // "Mua ngay" chỉ thanh toán đúng dòng vừa thêm; ghi nhớ để tải lại trang không tính cả giỏ.
      const itemIds = line ? [line.id] : null;
      rememberCheckoutSelection(itemIds);
      navigate('/checkout', { state: { itemIds } });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const groupBuyMutation = useMutation({
    mutationFn: (productId: string) => createGroupBuy(productId),
    onSuccess: (group) => {
      openSnackbar({ text: 'Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé 🛒', type: 'success' });
      navigate(`/group-buy/${group.id}`);
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (product.isLoading) return <PdpSkeleton />;
  if (!product.data) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <h1 style={SR_ONLY}>{PDP_TITLE}</h1>
        {isNotFoundError(product.error) ? (
          <>
            <ErrorState message="Không tìm thấy sản phẩm này." onRetry={() => undefined} onHome={() => navigate('/')} />
            {/* Khách từ link sàn/CTV vào sản phẩm đã gỡ: cho họ chỗ đi tiếp thay vì ngõ cụt. */}
            <SuggestedRail listSource="pdp_not_found" />
          </>
        ) : (
          <ErrorState message={getErrorMessage(product.error)} onRetry={() => void product.refetch()} />
        )}
      </Page>
    );
  }

  const p = product.data;
  const pdpCoupons = (couponsQ.data ?? []).filter((c) => !c.products || c.products.some((x) => x.id === p?.id));
  // Flash không bao giờ tính cao hơn giá đang niêm yết — khớp BE (min(flashPrice, giá chuẩn)).
  const baseSelectedPrice = selected?.salePrice ?? selected?.retailPrice ?? p.basePrice;
  const price = flashItem ? Math.min(flashItem.flashPrice, baseSelectedPrice) : baseSelectedPrice;
  // Giờ vàng gạch giá đang bán trước giờ vàng (khớp dải trang chủ và thẻ SP); flash không rẻ hơn thì như không có flash.
  const originalPrice = flashItem && price < baseSelectedPrice ? baseSelectedPrice : selected ? selected.retailPrice : p.basePrice;
  // % badge tính từ giá THỰC hiển thị (price/originalPrice) — không dùng flashItem.retailPrice (snapshot cũ).
  const flashPct = originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;
  const inStock = (selected?.stock ?? 0) > 0;
  const lowStock = inStock && (selected?.stock ?? 0) <= LOW_STOCK_THRESHOLD;
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

  const handleAdd = async () => {
    if (status !== 'authenticated') {
      await login();
      if (useAuthStore.getState().status !== 'authenticated') return;
    }
    if (selected && inStock && !addMutation.isPending) {
      addMutation.mutate({ variation: selected, qty: quantity });
    }
  };

  const handleBuyNow = async () => {
    if (status !== 'authenticated') {
      await login();
      if (useAuthStore.getState().status !== 'authenticated') return;
    }
    if (selected && inStock && !buyNowMutation.isPending) {
      buyNowMutation.mutate({ variation: selected, qty: quantity });
    }
  };

  const handleShare = () => {
    haptic('light');
    const code = user?.referralCode;
    void shareWithFallback(
      {
        title: p.name,
        description: p.shortDesc ?? vi.home.tagline,
        thumbnail: p.thumbnail ?? undefined,
        path: withReferral(`/product/${p.slug}`, code),
      },
      withReferral(`${WEB_BASE_URL}/san-pham/${p.slug}`, code),
    );
  };

  return (
    <Page className="page page-bleed" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>

      <StorefrontContextBar />
      <Gallery key={p.slug} images={p.images.length > 0 ? p.images : p.thumbnail ? [p.thumbnail] : []} alt={p.name} />

      {/* ── Info chính ── */}
      <Box p={4} style={{ background: 'var(--color-bg-surface)' }}>
        <Box flex alignItems="center" style={{ gap: 6 }}>
          {/* Lọc theo tên nhãn đúng như catalog (p.brand), không phải slug: API so khớp chính xác tên. */}
          <button
            type="button"
            className="tubu-press"
            aria-label={brandBrowseLabel(p.brand)}
            onClick={() => navigate(brandBrowsePath(p.brand))}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, padding: 0,
              background: 'none', border: 'none', cursor: 'pointer', font: 'inherit',
            }}
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
          <Box style={{ marginLeft: 'auto' }}>
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

        {reviews.data && reviews.data.count > 0 && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 6 }}>
            <Stars value={reviews.data.average} size={14} />
            <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
              {reviews.data.average.toFixed(1)} · {reviews.data.count} đánh giá
            </Text>
          </Box>
        )}

        <Box flex alignItems="baseline" style={{ gap: 8, marginTop: 8 }}>
          <PriceTag value={price} compareAt={originalPrice} size="xl" />
          {formatSold(p.sold) && (
            <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{formatSold(p.sold)}</Text>
          )}
        </Box>

        <PointsEarnLine goods={price * quantity} authStatus={status} tierId={user?.tierId} />
        <PointsBoostStrip placement="product" />

        {/* Giờ vàng cho phân loại đang chọn — badge % + đếm ngược êm + đã bán bao nhiêu%. */}
        {flashItem && (
          <Box flex alignItems="center" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <Badge tone="promo" size="sm" style={{ background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' }}>
              -{flashPct}%
            </Badge>
            {flashLeft && (
              <Badge tone="promo" size="sm" icon={Clock}>
                {vi.flashSale.endsIn(flashLeft)}
              </Badge>
            )}
            <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
              {vi.flashSale.soldPct(soldPercent(flashItem.soldCount, flashItem.quota))}
            </Text>
          </Box>
        )}

        {lowStock && (
          <Text size="xSmall" style={{ color: 'var(--clay-700)', marginTop: 4 }}>
            {vi.product.lowStock(selected!.stock)}
          </Text>
        )}

        {p.shortDesc && (
          <Text size="small" style={{ color: 'var(--color-text-secondary)', marginTop: 8 }}>
            {p.shortDesc}
          </Text>
        )}

        {p.fulfiller?.kind === 'TUBU' && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 10 }}>
            <Truck size={15} color="var(--color-text-brand)" strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
            <Text size="xSmall" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
              Tubu Tree giao hàng
            </Text>
          </Box>
        )}

        {merchant && (
          <Box flex style={{ gap: 6, marginTop: 10 }}>
            <Truck size={15} color="var(--color-text-brand)" strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text size="xSmall" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
                {merchant.name} tự giao
              </Text>
              {merchant.shippingFee != null && (
                <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                  {merchantShippingLine(merchant.shippingFee, merchant.freeShipFrom)}
                </Text>
              )}
              <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                Thanh toán khi nhận hàng (COD) hoặc bằng Ví Tubu, không nhận chuyển khoản hay ZaloPay.
              </Text>
              <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                Hàng gian hàng tự giao chỉ bán theo giá lẻ, không dùng Điểm Xanh, chưa đặt định kỳ hay mua chung được.
              </Text>
            </Box>
          </Box>
        )}

        {unavailable && (
          <Box flex role="status" style={{ gap: 6, marginTop: 10 }}>
            <Truck size={15} color="var(--color-status-warning-fg)" strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <Text size="xSmall" style={{ color: 'var(--color-status-warning-fg)', fontWeight: 600 }}>
              {unavailable.reason === 'STORE_PAUSED'
                ? `${unavailable.name} đang tạm nghỉ, chưa nhận đơn.`
                : `${unavailable.name} đã ngừng bán trên Tubu Tree.`}
            </Text>
          </Box>
        )}

        {!fromStore && p.partnerOwned && (
          <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginTop: 10 }}>
            Hàng của gian hàng đối tác chỉ bán theo giá lẻ, không dùng Điểm Xanh, chưa đặt định kỳ hay mua chung được.
          </Text>
        )}

        {/* Badge freeship — tín hiệu vận chuyển ở nơi ra quyết định mua (trước đây chỉ có ở giỏ). */}
        {!fromStore && freeshipFrom != null && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 10 }}>
            <Truck size={15} color="var(--color-text-brand)" strokeWidth={2} aria-hidden />
            <Text size="xSmall" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
              {freeshipFrom > 0 ? vi.product.freeshipFrom(formatVnd(freeshipFrom)) : vi.product.freeshipAll}
            </Text>
          </Box>
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

        {/* Voucher khả dụng — chạm để COPY mã (áp ở giỏ). Discovery ưu đãi ngay tại PDP. */}
        {pdpCoupons.length > 0 && (
          <ScrollRow label="Mã giảm giá có thể dùng" style={{ gap: 8, marginTop: 12 }}>
            {pdpCoupons.slice(0, 6).map((c) => (
              <Box
                key={c.code}
                role="button"
                {...rowKeyboardProps()}
                aria-label={`Sao chép mã ${c.code}`}
                className="tubu-press"
                onClick={() => {
                  haptic('light');
                  void copyText(c.code).then((ok) =>
                    openSnackbar(
                      ok
                        ? {
                            text: `Đã chép mã ${c.code} — mã đã có sẵn trong ví, chọn ở bước thanh toán`,
                            type: 'success',
                            duration: 2600,
                          }
                        : { text: `Mã của bạn: ${c.code} — chọn ở bước thanh toán`, type: 'info', duration: 4000 },
                    ),
                  );
                }}
                style={{
                  flex: '0 0 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  background: 'var(--clay-50)',
                  border: '1px dashed var(--clay-500)',
                  borderRadius: 'var(--radius-control)',
                  padding: '6px 12px',
                  minHeight: 44,
                  justifyContent: 'center',
                  boxSizing: 'border-box',
                }}
              >
                <Text size="xSmall" bold style={{ color: 'var(--clay-700)' }}>
                  {c.code} · {couponLabel(c)}
                </Text>
                {c.minOrder ? (
                  <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>Đơn từ {formatVnd(c.minOrder)}</Text>
                ) : null}
              </Box>
            ))}
          </ScrollRow>
        )}

        {selected && inStock && !retailOnly && (
          <Box
            role="button"
            {...rowKeyboardProps()}
            className="tubu-press"
            onClick={async () => {
              haptic('light');
              if (status !== 'authenticated') {
                await login();
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

      {/* ── Phân loại ── */}
      {variations.length > 1 && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <SectionTitle>{vi.product.variations}</SectionTitle>
          <Box flex style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {variations.map((v) => (
              <VariationChip
                key={v.id}
                variation={v}
                active={selected?.id === v.id}
                onClick={() => {
                  haptic('light');
                  setSelectedId(v.id);
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* ── Số lượng ── */}
      <Box p={4} mt={2} flex alignItems="center" justifyContent="space-between" style={{ background: 'var(--color-bg-surface)' }}>
        <Text bold size="small">
          {vi.product.quantity}
        </Text>
        <QuantitySelector
          value={quantity}
          max={Math.max(1, selected?.stock ?? 1)}
          onChange={(n) => {
            haptic('light');
            setQuantity(n);
          }}
        />
      </Box>

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
            if (groupBuyMutation.isPending) return;
            haptic('light');
            if (status !== 'authenticated') {
              await login();
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
              {groupBuyMutation.isPending ? 'Đang mở nhóm…' : 'Mở nhóm mua chung — nhận mã giảm khi đủ người'}
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
          <SectionTitle style={{ marginBottom: 10 }}>Thành phần</SectionTitle>
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
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <SectionTitle style={{ marginBottom: 8 }}>Cam kết Tubu</SectionTitle>
        <Box flex flexDirection="column" style={{ gap: 6 }}>
          {['Hàng chính hãng — nguồn gốc rõ ràng', 'Đổi trả trong 7 ngày nếu lỗi', 'Sản phẩm xanh, an lành cho cả nhà'].map((t) => (
            <Box key={t} flex alignItems="center" style={{ gap: 8 }}>
              <Icon icon={Check} size="sm" tone="brand" style={{ flexShrink: 0 }} />
              <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>{t}</Text>
            </Box>
          ))}
        </Box>
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
              void login();
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

      {slug && (
        <ContentKitSheet
          visible={showContentKit}
          onClose={() => setShowContentKit(false)}
          productSlug={slug}
        />
      )}

      {/* ── Thường mua kèm (§6.12 co-occurrence) ── */}
      {(boughtTogether.data?.length ?? 0) > 0 && (
        <>
          <Box pt={4} pb={2} px={4} flex alignItems="center" style={{ gap: 6 }}>
            <ShoppingCart size={18} color="var(--color-text-primary)" strokeWidth={1.9} />
            <SectionTitle>Thường mua kèm</SectionTitle>
          </Box>
          <Box
            px={4}
            pb={4}
            className="scroll-x"
            style={{ gap: 12 }}
          >
            {boughtTogether.data?.map((bp) => (
              <Box key={bp.id} style={{ flex: '0 0 150px' }}>
                <RelatedTile product={bp} flashSales={flashQ.data ?? []} />
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* ── Cùng thương hiệu ── */}
      {(related.data?.length ?? 0) > 0 && (
        <>
          <Box pt={4} pb={2} px={4}>
            <SectionTitle>Cùng nhà {p.brand}</SectionTitle>
          </Box>
          <Box
            px={4}
            pb={4}
            className="scroll-x"
            style={{ gap: 12 }}
          >
            {related.data?.map((rp) => (
              <Box key={rp.id} style={{ flex: '0 0 150px' }}>
                <RelatedTile product={rp} flashSales={flashQ.data ?? []} />
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* ── Sticky CTA ── */}
      <StickyActionBar
        secondary={
          <Box
            role="button"
            {...rowKeyboardProps()}
            aria-label={vi.product.viewCart}
            className="tubu-press"
            onClick={() => navigate('/cart')}
            onAnimationEnd={() => setBadgeBounce(false)}
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
            <CartBadge count={cartCount} bounce={badgeBounce} />
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
                onPress={handleAdd}
                style={{ flex: 1 }}
              >
                {vi.product.addToCart}
              </Button>
              {/* 2 dòng (nhãn + giá): "Mua ngay · 1.250.000đ" một dòng cần ~170px, trong khi mỗi nút
                  chỉ còn ~110-140px ở 320-390px → trước đây tràn khỏi màn hình. aria-label giữ
                  nguyên câu một dòng cho trình đọc màn hình (và cả lúc loading — I1). */}
              <Button
                variant="primary"
                size="lg"
                loading={buyNowMutation.isPending}
                disabled={!selected}
                onPress={handleBuyNow}
                aria-label={`Mua ngay · ${formatVnd(price * quantity)}`}
                style={{ flex: 1, paddingTop: 6, paddingBottom: 6 }}
              >
                <span style={BUY_NOW_LINE}>Mua ngay</span>
                <span style={{ ...BUY_NOW_LINE, fontSize: 'var(--type-caption-size)', fontWeight: 500 }}>
                  {formatVnd(price * quantity)}
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
        <svg width="72" height="72" viewBox="0 0 48 48" fill="none" aria-hidden>
          <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="var(--forest-200)" />
          <path d="M17 34c4-10 12-18 19-22" stroke="var(--color-text-brand)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
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
          <img
            key={src}
            src={src}
            alt={`${alt} — ảnh ${i + 1}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              objectFit: 'cover',
              flex: '0 0 100%',
              scrollSnapAlign: 'center',
              display: 'block',
            }}
          />
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

/** Card sản phẩm ở dải "Thường mua kèm"/"Cùng nhà {brand}" — dùng chung ProductTile (Task 23),
 * tự tính giá theo đúng quy tắc flash>sale>base y hệt ProductCard cũ (giữ nguyên logic điều hướng
 * + giá giờ vàng, chỉ đổi lớp trình bày — audit A4-06/A4-19). */
function RelatedTile({ product, flashSales }: { product: ProductCardData; flashSales: FlashSaleActiveItem[] }) {
  const navigate = useNavigate();
  const flash = flashSales.find((f) => f.productSlug === product.slug);
  const { price, compareAt, isFlash, salePct } = tilePricing(product, flashSales);
  return (
    <ProductTile
      product={product}
      variant="rail"
      priceOverride={{ price, compareAt }}
      badge={
        // Y hệt ProductCard cũ: KHÔNG hiện badge giảm giá khi đã hết hàng — overlay "tạm hết
        // hàng" của ProductTile là lớp phủ TRONG SUỐT (72% opacity), badge % có thể lộ ra dưới
        // lớp phủ nếu không chặn ở đây (review fix, Task 24).
        salePct > 0 && product.inStock ? (
          <Badge
            tone="promo"
            size="sm"
            style={isFlash ? { background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' } : undefined}
          >
            -{salePct}%
          </Badge>
        ) : undefined
      }
      onPress={() => {
        haptic('light');
        // Mở đúng phân loại đang giảm giờ vàng (SP nhiều phân loại: flash chỉ gắn vào một).
        navigate(`/product/${product.slug}`, flash ? { state: { variationId: flash.variationId } } : undefined);
      }}
    />
  );
}

/** Chip phân loại 2 dòng: tên + giá. Hết hàng = mờ + gạch nhưng vẫn xem được. */
function VariationChip({
  variation,
  active,
  onClick,
}: {
  variation: VariationDetail;
  active: boolean;
  onClick: () => void;
}) {
  const out = variation.stock <= 0;
  return (
    <Box
      role="button"
      aria-pressed={active}
      aria-disabled={out}
      {...(out ? null : rowKeyboardProps())}
      // Hết hàng → KHÔNG cho chọn (trước đây vẫn select được → CTA disable, gây khó hiểu).
      className={out ? undefined : 'tubu-press'}
      onClick={out ? undefined : onClick}
      style={{
        padding: '8px 14px',
        borderRadius: 'var(--radius-control)',
        border: `1.5px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
        background: active ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
        opacity: out ? 0.55 : 1,
        minHeight: 44,
        boxSizing: 'border-box',
      }}
    >
      <Text
        size="small"
        bold={active}
        style={{
          color: active ? 'var(--color-text-brand)' : 'var(--color-text-primary)',
          textDecoration: out ? 'line-through' : 'none',
        }}
      >
        {variation.name}
      </Text>
      <Text size="xSmall" style={{ color: active ? 'var(--color-text-brand)' : 'var(--color-text-disabled)' }}>
        {out ? vi.product.outOfStock : formatVnd(variation.salePrice ?? variation.retailPrice)}
      </Text>
    </Box>
  );
}

/** Mô tả thu gọn 4 dòng + nút Xem thêm. */
function CollapsibleDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 220;
  return (
    <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
      <SectionTitle>{vi.product.description}</SectionTitle>
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
