import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Page, Text, Button, useNavigate, useParams, useSnackbar, useLocation } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Repeat, ChevronRight, ShoppingCart, Share2, Users, Truck, Megaphone } from 'lucide-react';
import {
  fetchProduct,
  fetchRelated,
  fetchBoughtTogether,
  getCart,
  addToCart,
  fetchActiveFlashSales,
  type VariationDetail,
} from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { getCoupons, type CouponDTO } from '../services/account-api';
import { createGroupBuy } from '../services/groupbuy-api';
import { useAuthStore } from '../store/auth';
import { shareLink } from '../services/zmp-bridge';
import ProductCard from '../components/product-card';
import { ReviewsSection, Stars } from '../components/reviews-section';
import { WishlistHeart } from '../components/wishlist-heart';
import { SubscribeSheet } from '../components/subscribe-sheet';
import { fetchReviews } from '../services/shop-api';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { brandAccent } from '../utils/brands';
import { formatVnd, formatSold } from '../utils/format';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { StorefrontContextBar } from '../components/storefront-context-bar';
import { useCountdown } from '../hooks/use-countdown';
import { usePublicConfig } from '../hooks/use-public-config';
import { rememberCheckoutSelection } from '../utils/checkout-selection';
import { getAffiliateMe } from '../services/affiliate-api';
import { ContentKitSheet } from '../components/content-kit-sheet';
import { CartBadge } from '../components/ui/cart-badge';
import { copyText } from '../utils/clipboard';

const LOW_STOCK_THRESHOLD = 5;
const DESC_COLLAPSED_LINES = 4;

/** Nhãn ngắn cho voucher hiển thị ở PDP. */
function couponLabel(c: CouponDTO): string {
  if (c.type === 'FREESHIP') return 'Miễn phí vận chuyển';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`;
  return `Giảm ${formatVnd(c.value)}`;
}

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const { status, login } = useAuthStore();
  // Voucher khả dụng (endpoint /me/coupons đã lọc active + scope-eligible + chưa hết lượt).
  // Hiển thị để user KHÁM PHÁ ưu đãi ngay ở PDP (trước đây phải tự biết mã mới gõ ở giỏ).
  const couponsQ = useQuery({
    // Cùng queryKey với VoucherSheet ở giỏ/thanh toán → một cache, không gọi 2 lần và
    // không có cảnh "PDP thấy mã, sheet chưa thấy" sau khi nhận mã mới.
    queryKey: ['coupons'],
    queryFn: getCoupons,
    enabled: status === 'authenticated',
  });
  // Ngưỡng freeship (public config) cho badge "Miễn phí vận chuyển" — tín hiệu tin cậy ở PDP.
  const config = usePublicConfig();

  // Thẻ "Ưu đãi giờ vàng" truyền variationId qua state để PDP mở đúng phân loại đang giảm;
  // không có state (vào từ lưới sản phẩm/deep link) thì giữ hành vi cũ là tự chọn phân loại
  // đầu tiên còn hàng.
  const navState = useLocation().state as { variationId?: string } | null;
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
    queryKey: ['cart'],
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

  const addMutation = useMutation({
    mutationFn: (input: { variation: VariationDetail; qty: number }) =>
      addToCart(input.variation.id, input.qty),
    onSuccess: (updatedCart) => {
      queryClient.setQueryData(['cart'], updatedCart);
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
      queryClient.setQueryData(['cart'], updatedCart);
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
    onSuccess: () => {
      openSnackbar({ text: 'Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé 🛒', type: 'success' });
      navigate('/group-buy');
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (product.isLoading) return <PdpSkeleton />;
  if (product.isError || !product.data) {
    return (
      <Page style={{ background: 'var(--neutral-50)' }}>
        <ErrorState message={getErrorMessage(product.error)} onRetry={() => void product.refetch()} />
      </Page>
    );
  }

  const p = product.data;
  // Flash không bao giờ tính cao hơn giá đang niêm yết — khớp BE (min(flashPrice, giá chuẩn)).
  const baseSelectedPrice = selected?.salePrice ?? selected?.retailPrice ?? p.basePrice;
  const price = flashItem ? Math.min(flashItem.flashPrice, baseSelectedPrice) : baseSelectedPrice;
  const originalPrice = selected ? selected.retailPrice : p.basePrice;
  const hasSale = price < originalPrice;
  // % badge tính từ giá THỰC hiển thị (price/originalPrice) — không dùng flashItem.retailPrice (snapshot cũ).
  const flashPct = originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;
  const inStock = (selected?.stock ?? 0) > 0;
  const lowStock = inStock && (selected?.stock ?? 0) <= LOW_STOCK_THRESHOLD;
  const cartCount = cart.data?.itemCount ?? 0;

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
    void shareLink({
      title: p.name,
      description: p.shortDesc ?? vi.home.tagline,
      thumbnail: p.thumbnail ?? undefined,
      path: `/product/${p.slug}`,
    }).catch(() => {
      /* user đóng share sheet — không phải lỗi */
    });
  };

  return (
    <Page className="page page-bleed" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>

      <StorefrontContextBar />
      <Gallery key={p.slug} images={p.images.length > 0 ? p.images : p.thumbnail ? [p.thumbnail] : []} alt={p.name} />

      {/* ── Info chính ── */}
      <Box p={4} style={{ background: 'var(--neutral-0)' }}>
        <Box flex alignItems="center" style={{ gap: 6 }}>
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: '50%', background: brandAccent(p.brand) }}
          />
          <Text size="xSmall" bold style={{ color: 'var(--neutral-600)' }}>
            {p.brand}
          </Text>
          <Box style={{ marginLeft: 'auto' }}>
            <WishlistHeart productId={p.id} size={22} />
          </Box>
          <Box
            role="button"
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
            <Share2 size={20} color="var(--primary-700)" strokeWidth={2} />
          </Box>
        </Box>

        <Text.Title size="small" style={{ marginTop: 2 }}>
          {p.name}
        </Text.Title>

        {reviews.data && reviews.data.count > 0 && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 6 }}>
            <Stars value={reviews.data.average} size={14} />
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
              {reviews.data.average.toFixed(1)} · {reviews.data.count} đánh giá
            </Text>
          </Box>
        )}

        <Box flex alignItems="baseline" style={{ gap: 8, marginTop: 8 }}>
          <Text bold style={{ color: 'var(--primary-700)', fontSize: 24 }}>
            {formatVnd(price)}
          </Text>
          {hasSale && (
            <Text size="small" style={{ color: 'var(--neutral-400)', textDecoration: 'line-through' }}>
              {formatVnd(originalPrice)}
            </Text>
          )}
          {formatSold(p.sold) && (
            <Text size="xSmall" style={{ color: 'var(--neutral-500)', marginLeft: 'auto' }}>{formatSold(p.sold)}</Text>
          )}
        </Box>

        {/* Giờ vàng cho phân loại đang chọn — badge % + đếm ngược êm + đã bán bao nhiêu%. */}
        {flashItem && (
          <Box flex alignItems="center" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <Text
              size="xSmall"
              bold
              style={{
                background: 'var(--clay-500)',
                color: 'var(--neutral-0)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              -{flashPct}%
            </Text>
            <Text
              size="xSmall"
              bold
              style={{
                background: 'var(--clay-50)',
                color: 'var(--clay-700)',
                padding: '2px 10px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {vi.flashSale.endsIn(flashLeft)}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
              {vi.flashSale.soldPct(flashItem.quota > 0 ? Math.round((flashItem.soldCount / flashItem.quota) * 100) : 0)}
            </Text>
          </Box>
        )}

        {lowStock && (
          <Text size="xSmall" style={{ color: 'var(--clay-700)', marginTop: 4 }}>
            {vi.product.lowStock(selected!.stock)}
          </Text>
        )}

        {p.shortDesc && (
          <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 8 }}>
            {p.shortDesc}
          </Text>
        )}

        {/* Badge freeship — tín hiệu vận chuyển ở nơi ra quyết định mua (trước đây chỉ có ở giỏ). */}
        {config.isLoaded && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 10 }}>
            <Truck size={15} color="var(--leaf-700)" strokeWidth={2} aria-hidden />
            <Text size="xSmall" style={{ color: 'var(--leaf-700)', fontWeight: 600 }}>
              Miễn phí vận chuyển cho đơn từ {formatVnd(config.freeshipThreshold)}
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
                  background: 'var(--leaf-50)',
                  color: 'var(--leaf-700)',
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  fontWeight: 500,
                }}
              >
                ✓ {c}
              </Text>
            ))}
          </Box>
        )}

        {/* Voucher khả dụng — chạm để COPY mã (áp ở giỏ). Discovery ưu đãi ngay tại PDP. */}
        {(couponsQ.data?.length ?? 0) > 0 && (
          <Box className="scroll-x" style={{ gap: 8, marginTop: 12 }}>
            {couponsQ.data!.slice(0, 6).map((c) => (
              <Box
                key={c.code}
                role="button"
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
                  borderRadius: 'var(--radius-md)',
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
                  <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Đơn từ {formatVnd(c.minOrder)}</Text>
                ) : null}
              </Box>
            ))}
          </Box>
        )}

        {selected && inStock && (
          <Box
            role="button"
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
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--leaf-600)',
              background: 'var(--leaf-50)',
            }}
          >
            <Repeat size={18} color="var(--leaf-700)" strokeWidth={1.9} />
            <Text size="small" bold style={{ color: 'var(--leaf-700)', flex: 1 }}>
              Đặt định kỳ — tiết kiệm {Math.round(config.subscribeDiscountPct * 100)}%
            </Text>
            <ChevronRight size={18} color="var(--leaf-700)" strokeWidth={2} />
          </Box>
        )}
      </Box>

      {/* ── Phân loại ── */}
      {variations.length > 1 && (
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Text bold size="small">
            {vi.product.variations}
          </Text>
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
      <Box p={4} mt={2} flex alignItems="center" justifyContent="space-between" style={{ background: 'var(--neutral-0)' }}>
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
      <Box
        className="tubu-press"
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
          background: 'var(--neutral-0)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          opacity: groupBuyMutation.isPending ? 0.6 : 1,
        }}
      >
        <Box style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--leaf-50)', display: 'grid', placeItems: 'center' }}>
          <Users size={20} color="var(--leaf-700)" strokeWidth={2} />
        </Box>
        <Box style={{ flex: 1 }}>
          <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
            {groupBuyMutation.isPending ? 'Đang mở nhóm…' : 'Mở nhóm mua chung — giá tốt hơn'}
          </Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
            Rủ bạn bè cho đủ nhóm, cả nhóm cùng được giảm giá
          </Text>
        </Box>
        <ChevronRight size={18} color="var(--leaf-700)" strokeWidth={2} />
      </Box>

      {isAffiliate && (
        <Box
          className="tubu-press"
          p={4}
          mt={2}
          role="button"
          aria-label={vi.contentKit.sheetTitle}
          onClick={() => {
            haptic('light');
            setShowContentKit(true);
          }}
          style={{ background: 'var(--neutral-0)', display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <Box style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--primary-50)', display: 'grid', placeItems: 'center' }}>
            <Megaphone size={20} color="var(--primary-700)" strokeWidth={2} />
          </Box>
          <Box style={{ flex: 1 }}>
            <Text size="small" bold style={{ color: 'var(--primary-700)' }}>
              {vi.contentKit.sheetTitle}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
              Bài mẫu đã gắn sẵn link giới thiệu của bạn — copy là đăng được
            </Text>
          </Box>
          <ChevronRight size={18} color="var(--primary-700)" strokeWidth={2} />
        </Box>
      )}

      {/* ── Thành phần (spec §6.2 — niềm tin cho persona sợ hoá chất) ── */}
      {p.ingredients && p.ingredients.length > 0 && (
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Text bold size="small" style={{ marginBottom: 10 }}>
            Thành phần
          </Text>
          <Box flex flexDirection="column" style={{ gap: 10 }}>
            {p.ingredients.map((ing, i) => (
              <Box key={i} flex style={{ gap: 10 }}>
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--leaf-600)', marginTop: 6, flex: '0 0 auto' }}
                />
                <Box style={{ flex: 1 }}>
                  <Box flex alignItems="center" style={{ gap: 6 }}>
                    <Text size="small" bold>
                      {ing.name}
                    </Text>
                    {ing.percentage && (
                      <Text
                        size="xSmall"
                        style={{ background: 'var(--leaf-50)', color: 'var(--leaf-700)', padding: '1px 6px', borderRadius: 'var(--radius-full)' }}
                      >
                        {ing.percentage}
                      </Text>
                    )}
                  </Box>
                  {ing.benefit && (
                    <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
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
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>Cam kết Tubu</Text>
        <Box flex flexDirection="column" style={{ gap: 6 }}>
          {['Hàng chính hãng — nguồn gốc rõ ràng', 'Đổi trả trong 7 ngày nếu lỗi', 'Sản phẩm xanh, an lành cho cả nhà'].map((t) => (
            <Box key={t} flex alignItems="center" style={{ gap: 8 }}>
              <span style={{ color: 'var(--leaf-600)', fontWeight: 700, flexShrink: 0 }}>✓</span>
              <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>{t}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── Mô tả ── */}
      {p.description && <CollapsibleDescription text={p.description} />}

      {/* ── Đánh giá ── */}
      {slug && <ReviewsSection slug={slug} />}

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
            <ShoppingCart size={18} color="var(--neutral-800)" strokeWidth={1.9} />
            <Text.Title size="small">Thường mua kèm</Text.Title>
          </Box>
          <Box
            px={4}
            pb={4}
            className="scroll-x"
            style={{ gap: 12 }}
          >
            {boughtTogether.data?.map((bp) => (
              <Box key={bp.id} style={{ flex: '0 0 150px' }}>
                <ProductCard product={bp} />
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* ── Cùng thương hiệu ── */}
      {(related.data?.length ?? 0) > 0 && (
        <>
          <Box pt={4} pb={2} px={4}>
            <Text.Title size="small">Cùng nhà {p.brand}</Text.Title>
          </Box>
          <Box
            px={4}
            pb={4}
            className="scroll-x"
            style={{ gap: 12 }}
          >
            {related.data?.map((rp) => (
              <Box key={rp.id} style={{ flex: '0 0 150px' }}>
                <ProductCard product={rp} />
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* ── Sticky CTA ── */}
      <Box
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '10px 12px calc(10px + var(--safe-bottom))',
          background: 'var(--neutral-0)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <Box
          role="button"
          aria-label={vi.product.viewCart}
          className="tubu-press"
          onClick={() => navigate('/cart')}
          onAnimationEnd={() => setBadgeBounce(false)}
          style={{
            position: 'relative',
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--primary-200)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 auto',
          }}
        >
          <CartIcon />
          <CartBadge count={cartCount} bounce={badgeBounce} />
        </Box>
        {inStock ? (
          <>
            {/* CTA đôi kiểu Shopee: Thêm giỏ (viền) + Mua ngay (đặc, tới thẳng checkout). */}
            <Button
              variant="secondary"
              loading={addMutation.isPending}
              disabled={!selected}
              onClick={handleAdd}
              style={{ flex: 1, minHeight: 48, fontWeight: 600 }}
            >
              {vi.product.addToCart}
            </Button>
            <Button
              loading={buyNowMutation.isPending}
              disabled={!selected}
              onClick={handleBuyNow}
              style={{ flex: 1, background: 'var(--primary-600)', minHeight: 48, fontWeight: 700 }}
            >
              Mua ngay · {formatVnd(price * quantity)}
            </Button>
          </>
        ) : (
          <Button
            fullWidth
            disabled
            style={{ background: 'var(--neutral-200)', minHeight: 48, fontWeight: 600 }}
          >
            {vi.product.outOfStock}
          </Button>
        )}
      </Box>
    </Page>
  );
}

/** Carousel ảnh scroll-snap + dots — không cần lib ngoài. */
function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  if (images.length === 0) {
    return (
      <Box
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--leaf-50)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="72" height="72" viewBox="0 0 48 48" fill="none" aria-hidden>
          <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="var(--leaf-200)" />
          <path d="M17 34c4-10 12-18 19-22" stroke="var(--leaf-600)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
      </Box>
    );
  }

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <Box style={{ position: 'relative' }}>
      <div
        ref={trackRef}
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
                borderRadius: 'var(--radius-full)',
                background: i === index ? 'var(--primary-600)' : 'rgba(255,255,255,0.85)',
                transition: 'width var(--dur-base) var(--ease-out)',
                boxShadow: 'var(--shadow-xs)',
              }}
            />
          ))}
        </Box>
      )}
    </Box>
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
      // Hết hàng → KHÔNG cho chọn (trước đây vẫn select được → CTA disable, gây khó hiểu).
      className={out ? undefined : 'tubu-press'}
      onClick={out ? undefined : onClick}
      style={{
        padding: '8px 14px',
        borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
        background: active ? 'var(--primary-50)' : 'var(--neutral-0)',
        opacity: out ? 0.55 : 1,
        minHeight: 44,
        boxSizing: 'border-box',
      }}
    >
      <Text
        size="small"
        bold={active}
        style={{
          color: active ? 'var(--primary-700)' : 'var(--neutral-900)',
          textDecoration: out ? 'line-through' : 'none',
        }}
      >
        {variation.name}
      </Text>
      <Text size="xSmall" style={{ color: active ? 'var(--primary-700)' : 'var(--neutral-400)' }}>
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
    <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
      <Text bold size="small">
        {vi.product.description}
      </Text>
      <Text
        size="small"
        style={{
          color: 'var(--neutral-600)',
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
          size="small"
          bold
          onClick={() => setExpanded((e) => !e)}
          style={{ color: 'var(--primary-700)', marginTop: 8, padding: '8px 0' }}
        >
          {expanded ? vi.product.descriptionLess : vi.product.descriptionMore}
        </Text>
      )}
    </Box>
  );
}

function CartIcon() {
  return <ShoppingCart size={22} color="var(--primary-700)" strokeWidth={1.9} />;
}

/** Skeleton match layout PDP. */
function PdpSkeleton() {
  return (
    <Page style={{ background: 'var(--neutral-50)' }}>
      <Skeleton height="auto" radius="0" style={{ aspectRatio: '1 / 1' }} />
      <Box p={4} style={{ background: 'var(--neutral-0)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton width={70} height={12} />
        <Skeleton width="85%" height={18} />
        <Skeleton width={120} height={24} />
        <Skeleton width="100%" height={13} />
        <Skeleton width="70%" height={13} />
      </Box>
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)', display: 'flex', gap: 8 }}>
        <Skeleton width={92} height={44} />
        <Skeleton width={92} height={44} />
        <Skeleton width={92} height={44} />
      </Box>
    </Page>
  );
}
