import { Box, Page, Text, Button, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchProducts, fetchBrands } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import ProductCard from '../components/product-card';
import { ProductGridSkeleton, Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { brandAccent } from '../utils/brands';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

const SECTION_LIMIT = 6;

export default function HomePage() {
  const navigate = useNavigate();
  const { user, status, login } = useAuthStore();

  const featured = useQuery({
    queryKey: ['products', 'home-featured'],
    queryFn: () => fetchProducts({ limit: SECTION_LIMIT }),
  });
  const newest = useQuery({
    queryKey: ['products', 'home-newest'],
    queryFn: () => fetchProducts({ limit: SECTION_LIMIT, sort: 'newest' }),
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
            <Text.Title style={{ color: 'white' }}>
              {user ? vi.home.greeting(user.fullName ?? vi.auth.greetingFallback) : 'Tubu Tree'}
            </Text.Title>
            <Text size="small" style={{ color: 'var(--primary-100)' }}>
              {vi.home.tagline}
            </Text>
          </Box>
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
        </Box>

        {status !== 'authenticated' && status !== 'loading' && (
          <Button
            size="small"
            onClick={() => void login()}
            style={{
              background: 'white',
              color: 'var(--primary-700)',
              marginTop: 14,
              minHeight: 44,
              fontWeight: 600,
            }}
          >
            {vi.auth.loginCta}
          </Button>
        )}

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

      {/* ── Brand strip ── */}
      <Box pt={4} pb={1} px={4}>
        <Text.Title size="small">{vi.home.brandsTitle}</Text.Title>
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

      {/* ── Tubu chọn cho bạn ── */}
      <HomeSection
        title={vi.home.featured}
        query={featured}
        onRetry={() => void featured.refetch()}
      />

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
        <Text.Title size="small">{title}</Text.Title>
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
