import { useEffect, useState } from 'react';
import { Box, Page, Text, Button, useParams } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { getPublicStorefront } from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { useStorefrontContext } from '../store/storefront-context';
import { ShareSheet } from '../components/share-sheet';

const THEME: Record<string, string> = {
  'leaf-orange': 'linear-gradient(120deg, var(--leaf-600), var(--primary-600))',
};

export default function StorefrontViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const q = useQuery({ queryKey: ['public-storefront', slug], queryFn: () => getPublicStorefront(slug), staleTime: 60_000 });
  const setSfContext = useStorefrontContext((s) => s.setContext);
  const [shareOpen, setShareOpen] = useState(false);

  const sf = q.data;
  useEffect(() => {
    if (sf) setSfContext({ slug: sf.slug, referralCode: sf.type === 'CTV' ? sf.slug : null });
  }, [sf, setSfContext]);

  if (q.isLoading) return <Page className="page"><Box p={4}><Skeleton style={{ height: 180, borderRadius: 16 }} /></Box></Page>;
  if (q.isError || !sf) return <Page className="page"><Box p={6}><ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} /></Box></Page>;

  return (
    <Page className="page page-bleed" style={{ background: 'var(--neutral-50)', paddingBottom: 90 }}>
      <Box style={{ height: 84, background: sf.coverUrl ? `url(${sf.coverUrl}) center/cover` : (THEME[sf.theme] ?? THEME['leaf-orange']) }} />
      <Box px={4} style={{ marginTop: -28 }}>
        <Box style={{ width: 58, height: 58, borderRadius: '50%', background: 'var(--primary-600)', border: '3px solid var(--neutral-0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: '#fff', overflow: 'hidden' }}>
          {sf.avatarUrl ? <img src={sf.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌿'}
        </Box>
        <Text bold size="xLarge" style={{ marginTop: 8 }}>{sf.title}</Text>
        {sf.headerNote && <Text size="small" style={{ color: 'var(--neutral-600)' }}>{sf.headerNote}</Text>}
        <Box flex style={{ gap: 6, marginTop: 8 }}>
          <Text size="xSmall" style={{ background: 'var(--leaf-600)', color: '#fff', padding: '3px 9px', borderRadius: 'var(--radius-full)' }}>✓ CTV chính thức Tubu</Text>
        </Box>
      </Box>

      {sf.collections.map((col) => (
        <Box key={col.id} mt={4} px={4}>
          <Text bold style={{ marginBottom: 8 }}>{col.title}</Text>
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {col.items.map((it) => {
              const price = it.product.salePrice ?? it.product.basePrice;
              return (
                <Box key={it.id} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                  <Box style={{ aspectRatio: '1/1', background: 'var(--neutral-100)' }}>
                    {it.product.thumbnail && <img src={it.product.thumbnail} alt={it.product.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </Box>
                  <Box p={2}>
                    <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>{it.product.brand}</Text>
                    <Text size="small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 36 }}>{it.product.name}</Text>
                    {it.product.reviewCount > 0 && (
                      <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>★ {it.product.ratingAvg.toFixed(1)} ({it.product.reviewCount})</Text>
                    )}
                    <Text bold style={{ color: 'var(--primary-700)', fontSize: 15 }}>{formatVnd(price)}</Text>
                    {it.note && <Text size="xSmall" style={{ color: 'var(--leaf-700)', background: 'var(--leaf-50)', padding: '4px 8px', borderRadius: 10, marginTop: 4 }}>💬 {it.note}</Text>}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}

      <Box style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, display: 'flex', gap: 8 }}>
        <Button fullWidth style={{ background: 'var(--primary-600)' }} onClick={() => setShareOpen(true)}>
          ↗ Chia sẻ gian hàng
        </Button>
      </Box>

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
