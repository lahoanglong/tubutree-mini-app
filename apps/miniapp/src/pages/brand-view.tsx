import { useEffect, useMemo, useRef, useState } from 'react';
import { Page, useParams, useNavigate } from 'zmp-ui';
import { useNotify } from '../hooks/use-notify';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPublicBrand, getBrandShareToEarn,
  getBrandFollowState, followBrand, unfollowBrand,
} from '../services/brand-api';
import { useStorefrontContext } from '../store/storefront-context';
import { useAuthStore } from '../store/auth';
import { getLoadErrorMessage, isNotFoundError } from '../services/api';
import { formatVnd } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { ShareSheet } from '../components/share-sheet';
import { getDealerMe } from '../services/dealer-api';
import { BadgePercent, Check, ChevronRight, Leaf, MapPin, Plus, Share2, Store } from 'lucide-react';
import { brandStatsInput, followerStat, promotionVoucher, shopTabs, type ShopTabKey } from '@tubutree/app-core/commerce/shop-page';
import { shopStats } from '@tubutree/app-core/commerce/shop-stats';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { copyText } from '../utils/clipboard';
import { serverNow } from '../utils/server-clock';
import { Text, Heading } from '../components/ui/text';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Icon } from '../components/ui/icon';
import { IconButton } from '../components/ui/icon-button';
import { PageHeader } from '../components/ui/page-header';
import { ProductRail } from '../components/ui/product-rail';
import { ScrollRow } from '../components/ui/scroll-row';
import { SectionHeader } from '../components/ui/section-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { ShopHeader } from '../components/ui/shop-header';
import { ShopStatsRow } from '../components/ui/shop-stats-row';
import { ShopTopBar } from '../components/ui/shop-top-bar';
import { VoucherTicket } from '../components/ui/voucher-ticket';
import { ShopProductsTab } from '../components/shop-page/shop-products-tab';
import { findBrandOrigin } from '../utils/brand-origins';

/** Tiêu đề khi chưa có tên nhãn (đang tải/lỗi); tải xong thì tên nhãn là h1 của ShopHeader. */
const PAGE_TITLE = 'Nhãn hàng';

/** Số sản phẩm nổi bật trên tab Shop (kệ ngang); phần còn lại ở tab Sản phẩm. */
const FEATURED_MAX = 10;
/** Cao thanh nút lùi cố định (56) cộng vùng an toàn phía trên: thanh tab dính ngay dưới nó. */
const STICKY_TOP = 'calc(var(--safe-top, 0px) + 56px)';
const TABS_HEIGHT = 62;

export default function BrandViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notify } = useNotify();
  const [shareOpen, setShareOpen] = useState(false);
  const [tab, setTab] = useState<ShopTabKey>('shop');
  const tabsRef = useRef<HTMLDivElement>(null);
  const setSfContext = useStorefrontContext((s) => s.setContext);
  const q = useQuery({ queryKey: ['public-brand', slug], queryFn: () => getPublicBrand(slug), staleTime: 60_000 });
  // Đại lý đã duyệt vẫn thấy "Đăng ký đại lý" thì đọc như hồ sơ chưa được duyệt (P3-22).
  // enabled theo trạng thái đăng nhập: khách vãng lai mở trang nhãn không nên bắn request 401
  // (kéo theo một lượt refresh token vô ích ở interceptor).
  const authed = useAuthStore((st) => st.status === 'authenticated');
  const dealerQ = useQuery({ queryKey: ['dealer-me'], queryFn: getDealerMe, retry: false, enabled: authed });
  const alreadyDealer = dealerQ.data?.isDealer === true || dealerQ.data?.status === 'APPROVED';

  // Vào trang nhãn → lưu store-context kind 'brand' để back/sau-mua quay về trang nhãn.
  // KHÔNG set storefrontSlug khi checkout (kind='brand') → tránh ô nhiễm analytics gian hàng CTV.
  useEffect(() => {
    if (slug) setSfContext({ slug, kind: 'brand' });
  }, [slug, setSfContext]);
  // Trạng thái theo dõi (cần đăng nhập; lỗi/401 coi như chưa theo dõi).
  // Chỉ hỏi sau khi nhãn đã tải xong và khách đã đăng nhập: nhãn không có thì không bắn thêm request 404/401.
  const brandLoaded = !!q.data;
  const followQ = useQuery({ queryKey: ['brand-follow', slug], queryFn: () => getBrandFollowState(slug), retry: false, enabled: authed && brandLoaded });
  const followMut = useMutation({
    mutationFn: () => (followQ.data?.following ? unfollowBrand(slug) : followBrand(slug)),
    onSuccess: (r) => {
      qc.setQueryData(['brand-follow', slug], r);
      // Số "N người theo dõi" nằm trong query ['public-brand'] (staleTime 60s). Không làm mới
      // thì bấm Theo dõi xong con số đứng im cả phút → người dùng bấm lại "cho chắc" và vô
      // tình bỏ theo dõi.
      void qc.invalidateQueries({ queryKey: ['public-brand', slug] });
      notify({ text: r.following ? 'Đã theo dõi nhãn 💚' : 'Đã bỏ theo dõi', type: 'success' });
    },
    onError: () => notify({ text: 'Cần đăng nhập để theo dõi nhãn.', type: 'warning' }),
  });
  // Banner share-to-earn: chỉ AFFILIATE đăng nhập mới eligible; lỗi (401/chưa login) coi như ẩn.
  const steQ = useQuery({
    queryKey: ['brand-ste', slug],
    queryFn: () => getBrandShareToEarn(slug),
    retry: false,
    staleTime: 60_000,
    enabled: authed && brandLoaded,
  });
  const ste = steQ.data;
  const eligible = ste?.eligible === true;
  const myRef = ste?.eligible ? ste.referralCode : null;

  const b = q.data;
  const mapOrigin = b ? findBrandOrigin({ slug, name: b.name }) : null;
  const featured = useMemo(() => (b?.products ?? []).slice(0, FEATURED_MAX).map((p) => ({ ...p, brand: b?.name ?? '', isFeatured: false })), [b]);

  if (q.isLoading) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={PAGE_TITLE} />
        <div style={{ padding: 16 }}>
          <Skeleton style={{ height: 180, borderRadius: 'var(--radius-card)' }} />
        </div>
      </Page>
    );
  }
  if (!b) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={PAGE_TITLE} />
        <div style={{ padding: 24 }}>
          {isNotFoundError(q.error) ? (
            <EmptyState
              art="search"
              heading="Không tìm thấy nhãn hàng"
              body="Nhãn này chưa được công khai hoặc liên kết đã cũ. Xem các nhãn khác trong Danh mục nhé."
              ctaLabel="Xem Danh mục"
              onCta={() => navigate('/browse', { replace: true })}
            />
          ) : (
            <ErrorState message={getLoadErrorMessage(q.error)} onRetry={() => void q.refetch()} />
          )}
        </div>
      </Page>
    );
  }

  const hasStory = Boolean(b.story || b.origin || b.storyImages.length > 0);
  const productCount = b.productCount ?? b.products.length;
  const stats = [...shopStats(brandStatsInput(b)), ...[followerStat(b.followerCount)].filter((x) => x !== null)];
  const tabs = shopTabs({ productCount, hasStory, hasCategories: false }).map((t) => ({
    key: t.key,
    label: t.count === undefined ? t.label : `${t.label} (${t.count})`,
  }));
  const openTab = (key: string) => {
    setTab(key as ShopTabKey);
    // Thanh tab dính nên nội dung mới đổi dưới tay khách: kéo thanh tab lên đầu thay vì để trang ở giữa chừng.
    tabsRef.current?.scrollIntoView?.({ block: 'start' });
  };
  const copyPromoCode = (code: string) =>
    void copyText(code).then((ok) =>
      notify(
        ok
          ? { text: `Đã chép mã ${code} — dán ở bước thanh toán`, type: 'success', duration: 2600 }
          : { text: `Mã giảm giá: ${code}`, type: 'info', duration: 3000 },
      ),
    );
  const now = serverNow();

  return (
    <Page className="page page-bleed" style={{ background: 'var(--color-bg-canvas)' }}>
      <ShopTopBar title={b.name} />
      <ShopHeader
        title={b.name}
        coverUrl={b.coverUrl}
        avatarUrl={b.logoUrl}
        verified={b.isVerified}
        note={b.tagline}
        badges={
          b.isVerified ? (
            // Pill đặc (không phải soft-tone chuẩn của Badge) để giữ đúng trọng lượng thị giác
            // "đã xác minh" như bản cũ (leaf-600 đặc/chữ trắng), chỉ đổi sang token ngữ nghĩa DS v2.
            <Badge tone="verified" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <Icon icon={Check} size="sm" tone="inverse" />
              Chính hãng
            </Badge>
          ) : undefined
        }
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Button
              variant="secondary"
              icon={followQ.data?.following ? Check : Plus}
              loading={followMut.isPending}
              onPress={() => followMut.mutate()}
            >
              {followQ.data?.following ? fillCopy('shop.following') : fillCopy('shop.follow')}
            </Button>
            <IconButton icon={Share2} label="Chia sẻ" onPress={() => setShareOpen(true)} />
          </div>
        }
      />
      <ShopStatsRow stats={stats} />

      {eligible && ste?.eligible && (
        <div style={{ marginTop: 12, padding: '0 16px' }}>
          <button
            type="button"
            className="tubu-press"
            onClick={() => setShareOpen(true)}
            style={{
              display: 'block', width: '100%', minHeight: 44, textAlign: 'left', font: 'inherit', cursor: 'pointer',
              background: 'var(--color-action-secondary-bg)', border: '1px solid var(--color-action-secondary-border)',
              borderRadius: 'var(--radius-card)', padding: 12,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BadgePercent size={18} color="var(--color-action-secondary-fg)" aria-hidden />
              <Text variant="body-sm" style={{ fontWeight: 700, color: 'var(--color-action-secondary-fg)' }}>
                {ste.maxAffiliateRate > 0 ? `Chia sẻ nhãn này — nhận tới ${ste.maxAffiliateRate}% hoa hồng` : 'Chia sẻ nhãn này'}
              </Text>
            </span>
            <Text variant="caption" style={{ color: 'var(--color-text-brand)', marginTop: 2 }} as="span">
              Bấm để lấy link + lời đăng gắn mã giới thiệu của bạn.
            </Text>
          </button>
        </div>
      )}

      <div ref={tabsRef} style={{ position: 'sticky', top: STICKY_TOP, zIndex: 3, background: 'var(--color-bg-canvas)', padding: '12px 16px 8px', minHeight: TABS_HEIGHT }}>
        <SegmentedTabs items={tabs} value={tab} onChange={openTab} />
      </div>

      <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label} style={{ ['--sort-bar-top' as string]: `calc(var(--safe-top, 0px) + 56px + ${TABS_HEIGHT - 12}px)` }}>
        {tab === 'shop' && (
          <div style={{ padding: '0 16px' }}>
            {b.certifications.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>Chứng nhận</Heading>
                <ScrollRow label="Chứng nhận" style={{ gap: 8, minWidth: 0, maxWidth: '100%' }}>
                  {b.certifications.map((c) => (
                    <Badge key={c.code} tone="success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon icon={Leaf} size="sm" tone="brand" />
                      {c.label}
                    </Badge>
                  ))}
                </ScrollRow>
              </div>
            )}

            {b.promotions.length > 0 && (
              <div style={{ marginTop: 16 }} data-testid="brand-vouchers">
                <SectionHeader title={fillCopy('shop.vouchers')} icon="ticket" />
                {/* Phiếu chip chỉ có tiêu đề và điều kiện; mã nằm sau nút Sao chép (dán ở bước thanh toán). */}
                <ScrollRow label={fillCopy('shop.vouchers')} style={{ gap: 8, minWidth: 0, maxWidth: '100%' }}>
                  {b.promotions.map((p) => (
                    <VoucherTicket
                      key={p.id}
                      voucher={promotionVoucher(p, now)}
                      variant="chip"
                      primary={p.couponCode ? { label: 'Sao chép', onClick: () => copyPromoCode(p.couponCode!) } : undefined}
                    />
                  ))}
                </ScrollRow>
              </div>
            )}

            {hasStory && b.story && (
              <div style={{ marginTop: 16 }}>
                <Heading variant="title-sm" as="h2" style={{ marginBottom: 4 }}>Câu chuyện thương hiệu</Heading>
                <Text variant="body-sm" tone="secondary" as="p" data-testid="brand-story-teaser" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {b.story}
                </Text>
                <button
                  type="button"
                  className="tubu-press tubu-hit-44"
                  onClick={() => openTab('story')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 2, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--type-label-size)', fontWeight: 600, color: 'var(--color-text-brand)' }}
                >
                  {fillCopy('shop.readStory')}
                  <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            )}

            {featured.length > 0 && (
              <div style={{ marginTop: 16 }} data-testid="brand-featured">
                <SectionHeader
                  title="Sản phẩm nổi bật"
                  action={
                    productCount > featured.length
                      ? {
                          label: fillCopy('shop.seeAllN', { n: productCount }),
                          onPress: () => openTab('products'),
                          spoken: fillCopy('shop.seeAllNSpoken', { n: productCount, title: 'Sản phẩm nổi bật' }),
                        }
                      : undefined
                  }
                />
                {/* Payload sản phẩm của trang nhãn không kèm `brand` (mọi SP đều thuộc nhãn này): đặt tên nhãn của trang cho đủ kiểu, thẻ không in lại. */}
                <ProductRail items={featured} variant="rail-md" label="Sản phẩm nổi bật" showBrand={false} />
              </div>
            )}

            {b.dealerRewards.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Store size={16} color="var(--color-text-brand)" aria-hidden />
                  <Heading variant="title-sm" as="h2">Chương trình đại lý</Heading>
                </div>
                {b.dealerRewards.map((d) => (
                  <div key={d.id} style={{ marginBottom: 8, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-card)', padding: 12 }}>
                    <Text variant="body-sm" style={{ fontWeight: 700 }} as="div">{d.title}</Text>
                    {d.description && <Text variant="caption" tone="secondary" as="div">{d.description}</Text>}
                    <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
                      Đạt doanh số {formatVnd(d.threshold)} / {d.period === 'YEAR' ? 'năm' : 'quý'}
                    </Text>
                  </div>
                ))}
                <Button variant="secondary" onPress={() => navigate('/dealer')}>
                  {alreadyDealer ? 'Vào kênh đại lý' : dealerQ.data?.status === 'PENDING' ? 'Xem hồ sơ đại lý' : 'Đăng ký đại lý'}
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === 'products' && <ShopProductsTab source={{ kind: 'brand', slug: b.slug }} showBrand={false} />}

        {tab === 'story' && hasStory && (
          <div style={{ padding: '0 16px' }}>
            <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>Câu chuyện thương hiệu</Heading>
            {b.origin && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <MapPin size={16} color="var(--color-text-brand)" aria-hidden />
                  <Text variant="body-sm" as="span">Xuất xứ: {b.origin}</Text>
                </span>
                {mapOrigin && (
                  <Button variant="secondary" onPress={() => navigate(`/brand-story?brand=${mapOrigin.id}`)} style={{ flexShrink: 0 }}>
                    Xem trên bản đồ
                  </Button>
                )}
              </div>
            )}
            {b.story && <Text variant="body-sm" tone="secondary" as="div" style={{ whiteSpace: 'pre-line' }}>{b.story}</Text>}
            {b.storyImages.length > 0 && (
              <ScrollRow label="Ảnh câu chuyện thương hiệu" style={{ gap: 8, marginTop: 12, minWidth: 0, maxWidth: '100%' }}>
                {b.storyImages.map((src, i) => (
                  <img
                    key={`${i}:${src}`}
                    src={src}
                    alt={`${b.name}, ảnh ${i + 1}`}
                    loading="lazy"
                    style={{ flex: '0 0 auto', width: 240, height: 160, objectFit: 'cover', borderRadius: 'var(--radius-card)', background: 'var(--color-bg-subtle)' }}
                  />
                ))}
              </ScrollRow>
            )}
          </div>
        )}
      </div>

      <ShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        slug={b.slug}
        title={`Cửa hàng ${b.name}`}
        referralCode={myRef}
        thumbnail={b.coverUrl ?? b.logoUrl ?? b.products[0]?.thumbnail ?? undefined}
        pathPrefix="brand"
        captions={
          eligible
            ? [
                `Mình tin dùng ${b.name} 🌿 Ghé xem & ưu đãi nha`,
                `${b.name} — hàng chính hãng, sống xanh 💚`,
              ]
            : undefined
        }
      />
    </Page>
  );
}
