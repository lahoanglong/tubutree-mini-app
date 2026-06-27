import { useState } from 'react';
import { Box, Page, Text, Button, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPublicBrand, getBrandShareToEarn,
  getBrandFollowState, followBrand, unfollowBrand,
} from '../services/brand-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { ShareSheet } from '../components/share-sheet';

const HEADER_BG = 'linear-gradient(120deg, var(--leaf-600), var(--primary-600))';

export default function BrandViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [shareOpen, setShareOpen] = useState(false);
  const q = useQuery({ queryKey: ['public-brand', slug], queryFn: () => getPublicBrand(slug), staleTime: 60_000 });
  // Trạng thái theo dõi (cần đăng nhập; lỗi/401 coi như chưa theo dõi).
  const followQ = useQuery({ queryKey: ['brand-follow', slug], queryFn: () => getBrandFollowState(slug), retry: false });
  const followMut = useMutation({
    mutationFn: () => (followQ.data?.following ? unfollowBrand(slug) : followBrand(slug)),
    onSuccess: (r) => {
      qc.setQueryData(['brand-follow', slug], r);
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
      <Page className="page">
        <Box p={4}>
          <Skeleton style={{ height: 180, borderRadius: 16 }} />
        </Box>
      </Page>
    );
  }
  if (q.isError || !b) {
    return (
      <Page className="page">
        <Box p={6}>
          <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        </Box>
      </Page>
    );
  }

  return (
    <Page className="page page-bleed" style={{ background: 'var(--neutral-50)', paddingBottom: 90 }}>
      <Box style={{ height: 96, background: b.coverUrl ? `url(${b.coverUrl}) center/cover` : HEADER_BG }} />
      <Box px={4} style={{ marginTop: -28 }}>
        <Box
          style={{
            width: 64, height: 64, borderRadius: '50%', background: 'var(--neutral-0)',
            border: '3px solid var(--neutral-0)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
          }}
        >
          {b.logoUrl ? <img src={b.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌿'}
        </Box>
        <Box flex alignItems="center" style={{ gap: 6, marginTop: 8 }}>
          <Text bold size="xLarge">{b.name}</Text>
          {b.isVerified && (
            <Text size="xSmall" style={{ background: 'var(--leaf-600)', color: '#fff', padding: '3px 9px', borderRadius: 'var(--radius-full)' }}>
              ✓ Chính hãng
            </Text>
          )}
        </Box>
        {b.tagline && <Text size="small" style={{ color: 'var(--neutral-600)' }}>{b.tagline}</Text>}
        {b.followerCount > 0 && (
          <Text size="xSmall" style={{ color: 'var(--neutral-500)', marginTop: 2 }}>{b.followerCount} người theo dõi</Text>
        )}
      </Box>

      {eligible && ste?.eligible && (
        <Box mt={3} px={4}>
          <Box
            className="tubu-press"
            onClick={() => setShareOpen(true)}
            style={{ background: 'var(--leaf-50)', border: '1px solid var(--leaf-200)', borderRadius: 'var(--radius-lg)', padding: 12 }}
          >
            <Text bold size="small" style={{ color: 'var(--leaf-800)' }}>
              💰 Chia sẻ nhãn này — nhận tới {ste.maxAffiliateRate}% hoa hồng
            </Text>
            <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginTop: 2 }}>
              Bấm để lấy link + caption gắn mã giới thiệu của bạn.
            </Text>
          </Box>
        </Box>
      )}

      {b.certifications.length > 0 && (
        <Box mt={4} px={4}>
          <Text bold style={{ marginBottom: 8 }}>Chứng nhận</Text>
          <Box flex style={{ gap: 8, overflowX: 'auto' }}>
            {b.certifications.map((c) => (
              <Text
                key={c.code}
                size="xSmall"
                style={{ whiteSpace: 'nowrap', background: 'var(--leaf-50)', color: 'var(--leaf-800)', padding: '6px 12px', borderRadius: 'var(--radius-sm)' }}
              >
                🌿 {c.label}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {b.promotions.length > 0 && (
        <Box mt={4} px={4}>
          <Text bold style={{ marginBottom: 8 }}>🎉 Khuyến mãi</Text>
          {b.promotions.map((p) => (
            <Box
              key={p.id}
              mb={2}
              style={{ background: 'var(--clay-50)', border: '1px solid var(--clay-200)', borderRadius: 'var(--radius-lg)', padding: 12, borderColor: p.themeColor ?? undefined }}
            >
              <Text bold size="small" style={{ color: 'var(--clay-800)' }}>{p.title}</Text>
              {p.subtitle && <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>{p.subtitle}</Text>}
            </Box>
          ))}
        </Box>
      )}

      {b.products.length > 0 && (
        <Box mt={4} px={4}>
          <Text bold style={{ marginBottom: 8 }}>Sản phẩm</Text>
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {b.products.map((p) => {
              const price = p.salePrice ?? p.basePrice;
              return (
                <Box
                  key={p.id}
                  className="tubu-press"
                  onClick={() => navigate(`/product/${p.slug}`)}
                  style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}
                >
                  <Box style={{ aspectRatio: '1/1', background: 'var(--neutral-100)' }}>
                    {p.thumbnail && <img src={p.thumbnail} alt={p.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </Box>
                  <Box p={2}>
                    <Text size="small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 36 }}>{p.name}</Text>
                    {p.reviewCount > 0 && (
                      <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>★ {p.ratingAvg.toFixed(1)} ({p.reviewCount})</Text>
                    )}
                    <Text bold style={{ color: 'var(--primary-700)', fontSize: 15 }}>{formatVnd(price)}</Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {b.dealerRewards.length > 0 && (
        <Box mt={4} px={4}>
          <Text bold style={{ marginBottom: 8 }}>🏪 Chương trình đại lý</Text>
          {b.dealerRewards.map((d) => (
            <Box key={d.id} mb={2} style={{ background: 'var(--neutral-0)', border: '1px solid var(--neutral-200)', borderRadius: 'var(--radius-lg)', padding: 12 }}>
              <Text bold size="small">{d.title}</Text>
              {d.description && <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>{d.description}</Text>}
              <Text size="xSmall" style={{ color: 'var(--neutral-500)', marginTop: 2 }}>
                Đạt doanh số {formatVnd(d.threshold)} / {d.period === 'YEAR' ? 'năm' : 'quý'}
              </Text>
            </Box>
          ))}
          <Button variant="secondary" size="small" onClick={() => navigate('/dealer')}>Đăng ký đại lý</Button>
        </Box>
      )}

      {b.story && (
        <Box mt={4} px={4}>
          <Text bold style={{ marginBottom: 8 }}>Câu chuyện thương hiệu</Text>
          <Text size="small" style={{ color: 'var(--neutral-700)', whiteSpace: 'pre-line' }}>{b.story}</Text>
        </Box>
      )}

      <Box style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, display: 'flex', gap: 8 }}>
        <Button
          variant="secondary"
          style={{ flex: 1 }}
          loading={followMut.isPending}
          onClick={() => followMut.mutate()}
        >
          {followQ.data?.following ? '✓ Đang theo dõi' : '+ Theo dõi'}
        </Button>
        <Button style={{ flex: 1, background: 'var(--primary-600)' }} onClick={() => setShareOpen(true)}>
          ↗ Chia sẻ
        </Button>
      </Box>

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
