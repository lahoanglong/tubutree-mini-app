import { useEffect, useState } from 'react';
import { Box, Page, Text, Button, useParams, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Share2, Sprout, MessageSquare, MapPin, CreditCard, CheckCircle2 } from 'lucide-react';
import { getPublicStorefront } from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { formatVnd, formatSold } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { useStorefrontContext } from '../store/storefront-context';
import { ShareSheet } from '../components/share-sheet';
import { TierBadge } from '../components/ui/tier-badge';

const THEME: Record<string, string> = {
  'leaf-orange': 'linear-gradient(120deg, var(--leaf-600), var(--primary-600))',
};

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
    <Page className="page page-bleed" style={{ background: 'var(--neutral-50)', paddingBottom: 90 }}>
      <Box style={{ height: 84, background: sf.coverUrl ? `url(${sf.coverUrl}) center/cover` : (THEME[sf.theme] ?? THEME['leaf-orange']) }} />
      <Box px={4} style={{ marginTop: -28 }}>
        <Box style={{ width: 58, height: 58, borderRadius: '50%', background: 'var(--primary-600)', border: '3px solid var(--neutral-0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--neutral-0)', overflow: 'hidden' }}>
          {sf.avatarUrl ? <img src={sf.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Sprout size={28} color="var(--neutral-0)" />}
        </Box>
        <Text bold size="xLarge" style={{ marginTop: 8 }}>{sf.title}</Text>
        {sf.headerNote && <Text size="small" style={{ color: 'var(--neutral-600)' }}>{sf.headerNote}</Text>}
        <Box flex style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Text size="xSmall" style={{ background: 'var(--leaf-600)', color: 'var(--neutral-0)', padding: '3px 9px', borderRadius: 'var(--radius-full)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle2 size={12} />
            {sf.type === 'MERCHANT' ? 'Đối tác chính hãng Tubu' : 'CTV tuyển chọn Tubu'}
          </Text>
          {sf.ownerTier && <TierBadge name={sf.ownerTier.name} emoji={sf.ownerTier.emoji} />}
          {sf.warehouseCity && (
            <Text size="xSmall" style={{ background: 'var(--neutral-200)', color: 'var(--neutral-800)', padding: '3px 9px', borderRadius: 'var(--radius-full)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={12} />
              Kho: {sf.warehouseCity}
            </Text>
          )}
          {sf.bankBin && sf.bankAccountNo && (
            <Text size="xSmall" style={{ background: 'var(--primary-100)', color: 'var(--primary-900)', padding: '3px 9px', borderRadius: 'var(--radius-full)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CreditCard size={12} />
              VietQR trực tiếp
            </Text>
          )}
        </Box>
      </Box>


      {sf.collections.map((col) => (
        <Box key={col.id} mt={4} px={4}>
          <Text bold style={{ marginBottom: 8 }}>{col.title}</Text>
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {col.items.filter((it) => Boolean(it?.product)).map((it) => {
              const price = it.product.salePrice ?? it.product.basePrice;
              return (
                <Box
                  key={it.id}
                  role="button"
                  aria-label={`Xem ${it.product.name}`}
                  className="tubu-press"
                  onClick={() => navigate(`/product/${it.product.slug}`)}
                  style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', cursor: 'pointer' }}
                >
                  <Box style={{ aspectRatio: '1/1', background: 'var(--neutral-100)' }}>
                    {it.product.thumbnail && <img src={it.product.thumbnail} alt={it.product.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </Box>
                  <Box p={2}>
                    <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>{it.product.brand}</Text>
                    <Text size="small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 36 }}>{it.product.name}</Text>
                    {it.product.reviewCount > 0 && (
                      <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>★ {it.product.ratingAvg.toFixed(1)} ({it.product.reviewCount})</Text>
                    )}
                    {formatSold(it.product.sold) && (
                      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>{formatSold(it.product.sold)}</Text>
                    )}
                    <Text bold style={{ color: 'var(--primary-700)', fontSize: 15 }}>{formatVnd(price)}</Text>
                    {it.note && (
                      <Box flex alignItems="center" style={{ gap: 4, marginTop: 4, background: 'var(--leaf-50)', padding: '4px 8px', borderRadius: 10 }}>
                        <MessageSquare size={12} color="var(--leaf-700)" />
                        <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>{it.note}</Text>
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}

      <Box style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, display: 'flex', gap: 8 }}>
        <Button
          fullWidth
          prefixIcon={<Share2 size={16} />}
          style={{ background: 'var(--primary-600)' }}
          onClick={() => setShareOpen(true)}
        >
          Chia sẻ gian hàng
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
