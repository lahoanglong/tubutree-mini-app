import { useEffect, useState } from 'react';
import { Box, Page, useParams, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Share2, Sprout, MessageSquare, MapPin, CheckCircle2, Sparkles } from 'lucide-react';
import {
  OPEN_STOREFRONT_CTA,
  OPEN_STOREFRONT_PROMPT,
  SAMPLE_STOREFRONT_LABEL,
  SAMPLE_STOREFRONT_NOTE,
  sampleShareText,
} from '@tubutree/app-core/storefront-signup';
import { getPublicStorefront } from '../services/storefront-api';
import { apiMediaUrl, getErrorMessage, isNotFoundError } from '../services/api';
import { vi } from '../i18n/vi';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { SuggestedRail } from '../components/catalog/suggested-rail';
import { useStorefrontContext } from '../store/storefront-context';
import { useAuthStore } from '../store/auth';
import { ShareSheet } from '../components/share-sheet';
import { TierBadge } from '../components/ui/tier-badge';
import { StorePageShell } from '../components/store-page-shell';
import { Text, Heading } from '../components/ui/text';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import ProductCard from '../components/product-card';

/** Nhãn tin cậy chỉ cho gian hàng admin đã duyệt: tick và "CTV tuyển chọn" là lời cam kết của Tubu Tree, không phải của chủ shop tự gắn. */
function trustBadgeLabel(sf: { type: 'CTV' | 'BRAND' | 'MERCHANT'; approved?: boolean }): string | null {
  if (!sf.approved) return null;
  if (sf.type === 'MERCHANT') return vi.storefront.badgePartner;
  if (sf.type === 'BRAND') return vi.storefront.badgeBrand;
  return vi.storefront.badgeSelectedCtv;
}

export default function StorefrontViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['public-storefront', slug], queryFn: () => getPublicStorefront(slug), staleTime: 60_000 });
  const setSfContext = useStorefrontContext((s) => s.setContext);
  const [shareOpen, setShareOpen] = useState(false);
  const myReferralCode = useAuthStore((s) => s.user?.referralCode);

  const sf = q.data;
  useEffect(() => {
    if (sf) setSfContext({ slug: sf.slug, referralCode: sf.referralCode ?? null, kind: 'ctv' });
  }, [sf, setSfContext]);

  if (q.isLoading) return <Page className="page"><Box p={4}><Skeleton style={{ height: 180, borderRadius: 16 }} /></Box></Page>;
  if (!sf) {
    // Link CTV hỏng/gian hàng đã đóng: thử lại không khác đi, nên chỉ đường về và gợi ý sản phẩm thay vì ngõ cụt.
    const gone = isNotFoundError(q.error);
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={vi.storefront.publicTitle} />
        {gone ? (
          <ErrorState message={vi.storefront.notFound} onRetry={() => undefined} onHome={() => navigate('/')} />
        ) : (
          <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
        {gone && <SuggestedRail listSource="storefront_not_found" />}
      </Page>
    );
  }

  // Chỉ gian hàng CTV có mã giới thiệu để nhận ra chủ; chủ gian hàng đối tác chia sẻ từ trình dựng.
  const isOwner = Boolean(myReferralCode && sf.referralCode && myReferralCode.toUpperCase() === sf.referralCode.toUpperCase());
  const collections = sf.collections.map((col) => ({ ...col, items: col.items.filter((it) => Boolean(it?.product)) })).filter((col) => col.items.length > 0);
  const badgeLabel = trustBadgeLabel(sf);

  return (
    <Page className="page page-bleed" style={{ background: 'var(--color-bg-canvas)' }}>
      <StorePageShell
        coverUrl={sf.coverUrl ? apiMediaUrl(sf.coverUrl) : sf.coverUrl}
        coverHeight={84}
        avatarUrl={sf.avatarUrl ? apiMediaUrl(sf.avatarUrl) : sf.avatarUrl}
        avatarFallback={<Sprout size={28} color="var(--color-text-inverse)" />}
        avatarSize={58}
        avatarMark={badgeLabel ? <CheckCircle2 size={20} color="var(--color-action-primary-bg)" aria-label="Đã được Tubu Tree duyệt" role="img" /> : undefined}
        title={sf.title}
        badges={
          <>
            {/* Huy hiệu xác thực — pill đặc (không phải soft-tone chuẩn của Badge) để giữ đúng
             * trọng lượng thị giác "đã xác minh" như bản cũ (leaf-600 đặc/chữ trắng); override
             * background/color sang token ngữ nghĩa DS v2 thay vì hex/--leaf-* cũ. */}
            {sf.isSample && <Badge tone="promo">{SAMPLE_STOREFRONT_LABEL}</Badge>}
            {badgeLabel && (
              <Badge tone="success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--color-action-primary-bg)', color: 'var(--color-text-inverse)' }}>
                <Sparkles size={12} />
                {badgeLabel}
              </Badge>
            )}
            {sf.ownerTier && <TierBadge name={sf.ownerTier.name} emoji={sf.ownerTier.emoji} />}
            {sf.warehouseCity && (
              <Badge tone="neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={12} />
                Kho: {sf.warehouseCity}
              </Badge>
            )}
            {/* Đã bỏ nhãn "VietQR trực tiếp" — audit A2-01=A5-02=A6-03 (2026-09-27): mọi thanh
             * toán chuyển khoản đều đi qua checkout thật (tài khoản Tubu), không storefront nào
             * tự nhận tiền trực tiếp, nên nhãn quảng cáo khả năng không còn tồn tại này là sai. */}
          </>
        }
        stickyBar={
          isOwner ? (
            <Button fullWidth icon={Share2} onPress={() => setShareOpen(true)}>
              {vi.storefront.shareStore}
            </Button>
          ) : (
            <Button fullWidth onPress={() => navigate('/browse')}>
              {vi.storefront.viewProducts}
            </Button>
          )
        }
      >
        {sf.isSample && (
          <Box px={4} mt={2}>
            <Text variant="caption" tone="tertiary" as="div" data-testid="sample-note">{SAMPLE_STOREFRONT_NOTE}</Text>
          </Box>
        )}
        {sf.headerNote && (
          <Box px={4}>
            <Text variant="body-sm" tone="secondary">{sf.headerNote}</Text>
          </Box>
        )}

        {collections.length === 0 && (
          <EmptyState
            art="basket"
            heading={vi.storefront.emptyHeading}
            body={isOwner ? vi.storefront.emptyOwnerBody : vi.storefront.emptyBody}
            ctaLabel={isOwner ? vi.storefront.addProduct : vi.storefront.viewProducts}
            onCta={() => navigate(isOwner ? '/storefront' : '/browse')}
          />
        )}

        {collections.map((col) => (
          <Box key={col.id} mt={4} px={4}>
            <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>{col.title}</Heading>
            <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {col.items.map((it) => (
                <div key={it.id}>
                  <ProductCard product={it.product} />
                  {it.note && (
                    <Box flex alignItems="center" style={{ gap: 4, marginTop: 4, background: 'var(--color-status-success-bg)', padding: '4px 8px', borderRadius: 10 }}>
                      <MessageSquare size={12} color="var(--color-status-success-fg)" />
                      <Text variant="caption" style={{ color: 'var(--color-status-success-fg)' }}>{it.note}</Text>
                    </Box>
                  )}
                </div>
              ))}
            </Box>
          </Box>
        ))}
        {!isOwner && sf.type === 'CTV' && (
          <Box mt={6} px={4}>
            <Card padding={16}>
              <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{OPEN_STOREFRONT_PROMPT}</Text>
              <Button variant="secondary" fullWidth style={{ marginTop: 10 }} onPress={() => navigate('/storefront')}>
                {OPEN_STOREFRONT_CTA}
              </Button>
            </Card>
          </Box>
        )}
      </StorePageShell>

      <ShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        slug={sf.slug}
        title={sampleShareText(sf.title, sf.isSample)}
        referralCode={sf.referralCode ?? null}
        thumbnail={sf.collections[0]?.items[0]?.product.thumbnail ?? undefined}
      />
    </Page>
  );
}
