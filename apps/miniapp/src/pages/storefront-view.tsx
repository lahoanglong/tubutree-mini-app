import { useEffect, useState } from 'react';
import { Box, Page, useParams, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Share2, Sprout, MessageSquare, MapPin, CheckCircle2 } from 'lucide-react';
import { getPublicStorefront } from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { useStorefrontContext } from '../store/storefront-context';
import { ShareSheet } from '../components/share-sheet';
import { TierBadge } from '../components/ui/tier-badge';
import { StorePageShell } from '../components/store-page-shell';
import { Text, Heading } from '../components/ui/text';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ProductTile } from '../components/ui/product-tile';

export default function StorefrontViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['public-storefront', slug], queryFn: () => getPublicStorefront(slug), staleTime: 60_000 });
  const setSfContext = useStorefrontContext((s) => s.setContext);
  const [shareOpen, setShareOpen] = useState(false);

  const sf = q.data;
  useEffect(() => {
    if (sf) setSfContext({ slug: sf.slug, referralCode: sf.type === 'CTV' ? sf.slug : null, kind: 'ctv' });
  }, [sf, setSfContext]);

  if (q.isLoading) return <Page className="page"><Box p={4}><Skeleton style={{ height: 180, borderRadius: 16 }} /></Box></Page>;
  if (q.isError || !sf) return <Page className="page"><Box p={6}><ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} /></Box></Page>;

  return (
    <Page className="page page-bleed" style={{ background: 'var(--color-bg-canvas)' }}>
      <StorePageShell
        coverUrl={sf.coverUrl}
        coverHeight={84}
        avatarUrl={sf.avatarUrl}
        avatarFallback={<Sprout size={28} color="var(--color-text-inverse)" />}
        avatarSize={58}
        title={sf.title}
        badges={
          <>
            {/* Huy hiệu xác thực — pill đặc (không phải soft-tone chuẩn của Badge) để giữ đúng
             * trọng lượng thị giác "đã xác minh" như bản cũ (leaf-600 đặc/chữ trắng); override
             * background/color sang token ngữ nghĩa DS v2 thay vì hex/--leaf-* cũ. */}
            <Badge tone="success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--color-action-primary-bg)', color: 'var(--color-text-inverse)' }}>
              <CheckCircle2 size={12} />
              {sf.type === 'MERCHANT' ? 'Đối tác chính hãng Tubu' : 'CTV tuyển chọn Tubu'}
            </Badge>
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
          <Button fullWidth icon={Share2} onPress={() => setShareOpen(true)}>
            Chia sẻ gian hàng
          </Button>
        }
      >
        {sf.headerNote && (
          <Box px={4}>
            <Text variant="body-sm" tone="secondary">{sf.headerNote}</Text>
          </Box>
        )}

        {sf.collections.map((col) => (
          <Box key={col.id} mt={4} px={4}>
            <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>{col.title}</Heading>
            <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {col.items.filter((it) => Boolean(it?.product)).map((it) => (
                <div key={it.id}>
                  <ProductTile
                    product={it.product}
                    variant="grid"
                    priceOverride={null}
                    onPress={() => navigate(`/product/${it.product.slug}`)}
                  />
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
      </StorePageShell>

      <ShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        slug={sf.slug}
        title={sf.title}
        referralCode={sf.type === 'CTV' ? sf.slug : null}
        thumbnail={sf.collections[0]?.items[0]?.product.thumbnail ?? undefined}
      />
    </Page>
  );
}
