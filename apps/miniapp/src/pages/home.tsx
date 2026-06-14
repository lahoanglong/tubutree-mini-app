import { Box, Page, Text, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchProducts, fetchBrands } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import ProductCard from '../components/product-card';
import { ProductGridSkeleton, Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { FlashSale } from '../components/flash-sale';
import { brandAccent } from '../utils/brands';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

const SECTION_LIMIT = 6;

/** Phân khúc mua sắm — khớp design PA2; key = forSegment (API lọc has(segment)). */
const SEGMENTS: { key: string; label: string; emoji: string }[] = [
  { key: 'mom_baby', label: 'Cho mẹ & bé', emoji: '🍼' },
  { key: 'home_clean', label: 'Nhà bếp xanh', emoji: '🧼' },
  { key: 'skincare', label: 'Chăm sóc cá nhân', emoji: '🧴' },
  { key: 'eco', label: 'Sống xanh', emoji: '♻️' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const featured = useQuery({
    queryKey: ['products', 'home-featured'],
    queryFn: () => fetchProducts({ limit: SECTION_LIMIT }),
  });
  const newest = useQuery({
    queryKey: ['products', 'home-newest'],
    queryFn: () => fetchProducts({ limit: SECTION_LIMIT, sort: 'newest' }),
  });
  // Persona chính (mẹ & bé) — gợi ý ưu tiên theo segment (spec §6.2).
  const momBaby = useQuery({
    queryKey: ['products', 'home-mombaby'],
    queryFn: () => fetchProducts({ limit: SECTION_LIMIT, segment: 'mom_baby' }),
  });
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands });

  const goBrand = (brand?: string) => {
    haptic('light');
    navigate(brand ? `/browse?brand=${encodeURIComponent(brand)}` : '/browse');
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 72 }}>
      {/* ── Hero ── */}
      <Box
        p={4}
        style={{
          background: 'linear-gradient(150deg, var(--primary-600), var(--primary-700))',
          borderRadius: '0 0 var(--radius-xl) var(--radius-xl)',
          paddingBottom: 24,
        }}
      >
        <Box flex justifyContent="space-between" alignItems="center">
          <Box>
            <Text.Title className="t-h1" style={{ color: 'white' }}>
              {user ? vi.home.greeting(user.fullName ?? vi.auth.greetingFallback) : 'Tubu Tree'}
            </Text.Title>
            <Text size="small" style={{ color: 'var(--primary-100)' }}>
              {vi.home.tagline}
            </Text>
          </Box>
          <Box flex alignItems="center" style={{ gap: 10 }}>
            {user && (
              <Box
                aria-label={vi.home.pointsChip(user.pointsBalance)}
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  borderRadius: 'var(--radius-full)',
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--leaf-400)' }} />
                <Text size="xSmall" bold style={{ color: 'white' }}>
                  {vi.home.pointsChip(user.pointsBalance)}
                </Text>
              </Box>
            )}
            <Box
              role="button"
              aria-label="Thông báo"
              className="tubu-press"
              onClick={() => navigate('/notifications')}
              style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
                <path d="M10 19a2 2 0 0 0 4 0" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </Box>
            <Box
              role="button"
              aria-label="Giỏ hàng"
              className="tubu-press"
              onClick={() => navigate('/cart')}
              style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M3 4h2l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h7.8a1.5 1.5 0 0 0 1.5-1.2L21 7H6" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="9.5" cy="20" r="1.4" fill="#fff" />
                <circle cx="17.5" cy="20" r="1.4" fill="#fff" />
              </svg>
            </Box>
          </Box>
        </Box>

        {/* Search entry — đưa thẳng sang Khám phá */}
        <Box
          role="button"
          aria-label={vi.home.searchPlaceholder}
          className="tubu-press"
          onClick={() => goBrand()}
          style={{
            background: 'white',
            borderRadius: 'var(--radius-full)',
            padding: '11px 16px',
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: 'var(--shadow-sm)',
            minHeight: 44,
            boxSizing: 'border-box',
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="var(--neutral-400)" strokeWidth="2" />
            <path d="M16.5 16.5L21 21" stroke="var(--neutral-400)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            {vi.home.searchPlaceholder}
          </Text>
        </Box>
      </Box>

      {/* ── Segment pills (theo phân khúc — design PA2) ── */}
      <Box
        px={4}
        pt={3}
        style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        {SEGMENTS.map((s) => (
          <Box
            key={s.key}
            role="button"
            aria-label={s.label}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              navigate(`/browse?segment=${s.key}`);
            }}
            style={{
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--leaf-50)',
              border: '1px solid var(--leaf-100)',
              borderRadius: 'var(--radius-full)',
              padding: '8px 14px',
              minHeight: 38,
              boxSizing: 'border-box',
            }}
          >
            <span aria-hidden style={{ fontSize: 16 }}>{s.emoji}</span>
            <Text size="xSmall" style={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--leaf-700)' }}>
              {s.label}
            </Text>
          </Box>
        ))}
      </Box>

      {/* ── Brand strip ── */}
      <Box pt={4} pb={1} px={4}>
        <Text.Title className="t-h2" size="small">{vi.home.brandsTitle}</Text.Title>
      </Box>
      <Box
        px={4}
        pb={2}
        style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        {brands.isLoading &&
          Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} width={92} height={36} radius="var(--radius-full)" style={{ flex: '0 0 auto' }} />
          ))}
        {brands.data?.map((b) => (
          <Box
            key={b.brand}
            role="button"
            className="tubu-press"
            onClick={() => goBrand(b.brand)}
            style={{
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: 'var(--neutral-0)',
              border: '1px solid var(--neutral-200)',
              borderRadius: 'var(--radius-full)',
              padding: '9px 14px',
              minHeight: 36,
              boxSizing: 'border-box',
            }}
          >
            <span
              aria-hidden
              style={{ width: 9, height: 9, borderRadius: '50%', background: brandAccent(b.brand) }}
            />
            <Text size="xSmall" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
              {b.brand}
            </Text>
          </Box>
        ))}
      </Box>

      {/* ── Hành trình nguyên liệu ── */}
      <Box px={4} pt={3}>
        <Box
          role="button"
          className="tubu-press"
          onClick={() => {
            haptic('light');
            navigate('/brand-story');
          }}
          flex
          alignItems="center"
          style={{
            gap: 12,
            padding: 14,
            borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(135deg, var(--leaf-600), var(--leaf-700))',
            color: '#fff',
          }}
        >
          <Text style={{ fontSize: 32 }}>🗺️</Text>
          <Box style={{ flex: 1 }}>
            <Text bold style={{ color: '#fff' }}>
              Hành trình nguyên liệu
            </Text>
            <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Khám phá 6 vùng đất làm nên sản phẩm Tubu
            </Text>
          </Box>
          <Text style={{ color: '#fff' }}>›</Text>
        </Box>
      </Box>

      {/* ── Flash Sale hôm nay ── */}
      <FlashSale />

      {/* ── Tubu chọn cho bạn ── */}
      <HomeSection
        title={vi.home.featured}
        query={featured}
        onRetry={() => void featured.refetch()}
      />

      {/* ── Cho mẹ và bé (persona chính) ── */}
      <HomeSection title="Cho mẹ và bé 🍼" query={momBaby} onRetry={() => void momBaby.refetch()} />

      {/* ── Mới về vườn ── */}
      <HomeSection title={vi.home.newArrivals} query={newest} onRetry={() => void newest.refetch()} />
    </Page>
  );
}

interface SectionQuery {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data?: { data: Parameters<typeof ProductCard>[0]['product'][] };
}

function HomeSection({
  title,
  query,
  onRetry,
}: {
  title: string;
  query: SectionQuery;
  onRetry: () => void;
}) {
  if (!query.isLoading && !query.isError && (query.data?.data.length ?? 0) === 0) return null;

  return (
    <>
      <Box pt={4} pb={2} px={4}>
        <Text.Title className="t-h2" size="small">{title}</Text.Title>
      </Box>
      <Box px={4}>
        {query.isLoading ? (
          <ProductGridSkeleton count={4} />
        ) : query.isError ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={onRetry} />
        ) : (
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {query.data?.data.map((p) => <ProductCard key={p.id} product={p} />)}
          </Box>
        )}
      </Box>
    </>
  );
}
