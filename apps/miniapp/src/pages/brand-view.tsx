import { useEffect, useState } from 'react';
import { Page, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPublicBrand, getBrandShareToEarn,
  getBrandFollowState, followBrand, unfollowBrand,
} from '../services/brand-api';
import { useStorefrontContext } from '../store/storefront-context';
import { useAuthStore } from '../store/auth';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { ShareSheet } from '../components/share-sheet';
import { getDealerMe } from '../services/dealer-api';
import { BadgePercent, Check, Leaf, Plus, Share2, Sparkles, Store } from 'lucide-react';
import { copyText } from '../utils/clipboard';
import { StorePageShell } from '../components/store-page-shell';
import { Text, Heading } from '../components/ui/text';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ProductTile } from '../components/ui/product-tile';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { ScrollRow } from '../components/ui/scroll-row';

/** Tiêu đề khi chưa có tên nhãn (đang tải/lỗi); tải xong thì tên nhãn là h1 của StorePageShell. */
const PAGE_TITLE = 'Nhãn hàng';

export default function BrandViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [shareOpen, setShareOpen] = useState(false);
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
  const followQ = useQuery({ queryKey: ['brand-follow', slug], queryFn: () => getBrandFollowState(slug), retry: false });
  const followMut = useMutation({
    mutationFn: () => (followQ.data?.following ? unfollowBrand(slug) : followBrand(slug)),
    onSuccess: (r) => {
      qc.setQueryData(['brand-follow', slug], r);
      // Số "N người theo dõi" nằm trong query ['public-brand'] (staleTime 60s). Không làm mới
      // thì bấm Theo dõi xong con số đứng im cả phút → người dùng bấm lại "cho chắc" và vô
      // tình bỏ theo dõi.
      void qc.invalidateQueries({ queryKey: ['public-brand', slug] });
      openSnackbar({ text: r.following ? 'Đã theo dõi nhãn 💚' : 'Đã bỏ theo dõi', type: 'success' });
    },
    onError: () => openSnackbar({ text: 'Cần đăng nhập để theo dõi nhãn.', type: 'warning' }),
  });
  // Banner share-to-earn: chỉ AFFILIATE đăng nhập mới eligible; lỗi (401/chưa login) coi như ẩn.
  const steQ = useQuery({
    queryKey: ['brand-ste', slug],
    queryFn: () => getBrandShareToEarn(slug),
    retry: false,
    staleTime: 60_000,
  });
  const ste = steQ.data;
  const eligible = ste?.eligible === true;
  const myRef = ste?.eligible ? ste.referralCode : null;

  const b = q.data;

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
          <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        </div>
      </Page>
    );
  }

  return (
    <Page className="page page-bleed" style={{ background: 'var(--color-bg-canvas)' }}>
      <StorePageShell
        coverUrl={b.coverUrl}
        coverHeight={96}
        avatarUrl={b.logoUrl}
        avatarFallback={<Icon icon={Leaf} size="lg" tone="inverse" />}
        avatarSize={64}
        title={b.name}
        badges={
          b.isVerified ? (
            // Pill đặc (không phải soft-tone chuẩn của Badge) để giữ đúng trọng lượng thị giác
            // "đã xác minh" như bản cũ (leaf-600 đặc/chữ trắng), chỉ đổi sang token ngữ nghĩa DS v2.
            <Badge
              tone="success"
              style={{ background: 'var(--color-action-primary-bg)', color: 'var(--color-text-inverse)', display: 'inline-flex', alignItems: 'center', gap: 2 }}
            >
              <Icon icon={Check} size="sm" tone="inverse" />
              Chính hãng
            </Badge>
          ) : undefined
        }
        stickyBar={
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <Button
              variant="secondary"
              style={{ flex: 1 }}
              icon={followQ.data?.following ? Check : Plus}
              loading={followMut.isPending}
              onPress={() => followMut.mutate()}
            >
              {followQ.data?.following ? 'Đang theo dõi' : 'Theo dõi'}
            </Button>
            <Button style={{ flex: 1 }} icon={Share2} onPress={() => setShareOpen(true)}>
              Chia sẻ
            </Button>
          </div>
        }
      >
        <div style={{ padding: '0 16px' }}>
          {b.tagline && <Text variant="body-sm" tone="secondary">{b.tagline}</Text>}
          {b.followerCount > 0 && (
            <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>{b.followerCount} người theo dõi</Text>
          )}
        </div>

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
                Bấm để lấy link + caption gắn mã giới thiệu của bạn.
              </Text>
            </button>
          </div>
        )}

        {b.certifications.length > 0 && (
          <div style={{ marginTop: 16, padding: '0 16px' }}>
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
          <div style={{ marginTop: 16, padding: '0 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Sparkles size={16} color="var(--color-promo-fg)" aria-hidden />
              <Heading variant="title-sm" as="h2">Khuyến mãi</Heading>
            </div>
            {b.promotions.map((p) => (
              <div
                key={p.id}
                style={{ marginBottom: 8, background: 'var(--color-promo-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-card)', padding: 12, borderColor: p.themeColor ?? undefined }}
              >
                <Text variant="body-sm" style={{ fontWeight: 700, color: 'var(--color-promo-fg)' }}>{p.title}</Text>
                {p.subtitle && <Text variant="caption" tone="secondary" as="div">{p.subtitle}</Text>}
                {/* Có mã mà không hiện thì banner chỉ là lời quảng cáo: khách đọc xong không
                    biết làm gì tiếp. Chạm để chép, dán ở bước thanh toán. */}
                {p.couponCode && (
                  <button
                    type="button"
                    aria-label={`Sao chép mã ${p.couponCode}`}
                    className="tubu-press"
                    onClick={() => {
                      const code = p.couponCode!;
                      void copyText(code).then((ok) =>
                        openSnackbar(
                          ok
                            ? { text: `Đã chép mã ${code} — dán ở bước thanh toán`, type: 'success', duration: 2600 }
                            : { text: `Mã giảm giá: ${code}`, type: 'info', duration: 3000 },
                        ),
                      );
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 8,
                      padding: '6px 12px',
                      minHeight: 44,
                      font: 'inherit',
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-control)',
                      border: '1px dashed var(--color-promo-fg)',
                      background: 'var(--color-bg-surface)',
                    }}
                  >
                    <Text variant="caption" style={{ fontWeight: 700, color: 'var(--color-promo-fg)', letterSpacing: 0.5 }}>
                      {p.couponCode}
                    </Text>
                    <Text variant="caption" tone="tertiary">chạm để chép</Text>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {b.products.length > 0 && (
          <div style={{ marginTop: 16, padding: '0 16px' }}>
            <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>Sản phẩm</Heading>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {b.products.map((p) => (
                <ProductTile
                  key={p.id}
                  // Payload sản phẩm của trang nhãn không kèm `brand` (mọi SP đều thuộc nhãn này) —
                  // ProductTile cần để hiện tên nhãn, dùng luôn tên nhãn của trang.
                  product={{ ...p, brand: b.name }}
                  variant="grid"
                  priceOverride={null}
                  onPress={() => navigate(`/product/${p.slug}`)}
                />
              ))}
            </div>
          </div>
        )}

        {b.dealerRewards.length > 0 && (
          <div style={{ marginTop: 16, padding: '0 16px' }}>
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

        {b.story && (
          <div style={{ marginTop: 16, padding: '0 16px' }}>
            <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>Câu chuyện thương hiệu</Heading>
            <Text variant="body-sm" tone="secondary" as="div" style={{ whiteSpace: 'pre-line' }}>{b.story}</Text>
          </div>
        )}
      </StorePageShell>

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
