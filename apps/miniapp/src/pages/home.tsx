import { Box, Page, Text, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Bell, ShoppingCart, Search, ChevronRight, Baby, SprayCan, Droplets, Recycle, Map, Sparkles, type LucideIcon } from 'lucide-react';
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
import logo from '../assets/tubu-logo.png';

const SECTION_LIMIT = 6;

/** Phân khúc mua sắm — khớp design PA2; key = forSegment (API lọc has(segment)). */
const SEGMENTS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: 'mom_baby', label: 'Cho mẹ & bé', Icon: Baby },
  { key: 'home_clean', label: 'Nhà bếp xanh', Icon: SprayCan },
  { key: 'skincare', label: 'Chăm sóc cá nhân', Icon: Droplets },
  { key: 'eco', label: 'Sống xanh', Icon: Recycle },
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
  // Brand/category chậm đổi (sync Pancake ~15p/lần) → cache 60s, override default 10s.
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands, staleTime: 60_000 });

  const goBrand = (brand?: string) => {
    haptic('light');
    navigate(brand ? `/browse?brand=${encodeURIComponent(brand)}` : '/browse');
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 72 }}>
      {/* ── Top bar: logo + actions (immersive — actionBar Zalo đã ẩn) ── */}
      <Box
        px={4}
        flex
        justifyContent="space-between"
        alignItems="center"
        style={{ paddingTop: 14, paddingBottom: 10 }}
      >
        <img src={logo} alt="Tubu Tree" style={{ height: 30, objectFit: 'contain' }} />
        <Box flex alignItems="center" style={{ gap: 8 }}>
          <Box
            role="button"
            aria-label="Thông báo"
            className="tubu-press"
            onClick={() => navigate('/notifications')}
            style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--leaf-50)', display: 'grid', placeItems: 'center' }}
          >
            <Bell size={20} color="var(--leaf-700)" strokeWidth={1.8} />
          </Box>
          <Box
            role="button"
            aria-label="Giỏ hàng"
            className="tubu-press"
            onClick={() => navigate('/cart')}
            style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--leaf-50)', display: 'grid', placeItems: 'center' }}
          >
            <ShoppingCart size={20} color="var(--leaf-700)" strokeWidth={1.8} />
          </Box>
        </Box>
      </Box>

      {/* ── Search ── */}
      <Box px={4} pb={3}>
        <Box
          role="button"
          aria-label={vi.home.searchPlaceholder}
          className="tubu-press"
          onClick={() => goBrand()}
          style={{
            background: 'var(--neutral-0)',
            border: '1px solid var(--neutral-200)',
            borderRadius: 'var(--radius-full)',
            padding: '11px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: 'var(--shadow-xs)',
            minHeight: 46,
            boxSizing: 'border-box',
          }}
        >
          <Search size={18} color="var(--neutral-400)" strokeWidth={2} />
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            {vi.home.searchPlaceholder}
          </Text>
        </Box>
      </Box>

      {/* ── Trợ lý AI tư vấn 24/7 (§6.14.3) ── */}
      <Box px={4} pb={3}>
        <Box
          role="button"
          aria-label="Hỏi trợ lý AI"
          className="tubu-press"
          onClick={() => { haptic('light'); navigate('/ai-advisor'); }}
          style={{
            background: 'linear-gradient(120deg, var(--leaf-50), var(--primary-50, #eef7ff))',
            border: '1px solid var(--leaf-400)',
            borderRadius: 'var(--radius-full)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minHeight: 46,
            boxSizing: 'border-box',
          }}
        >
          <Sparkles size={18} color="var(--leaf-700)" strokeWidth={2} />
          <Box style={{ flex: 1 }}>
            <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>Hỏi trợ lý AI 24/7</Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Tư vấn sản phẩm xanh phù hợp cho bạn</Text>
          </Box>
          <ChevronRight size={18} color="var(--leaf-700)" strokeWidth={2} />
        </Box>
      </Box>

      {/* ── Hero card (green, bo tròn — design PA2) ── */}
      <Box px={4} pb={1}>
        <Box
          style={{
            background: 'linear-gradient(150deg, var(--primary-600), var(--primary-700))',
            borderRadius: 'var(--radius-xl)',
            padding: '20px 18px',
            color: '#fff',
            overflow: 'hidden',
          }}
        >
          <Text size="xSmall" bold style={{ color: '#d7eec2', letterSpacing: 1 }}>
            SỐNG XANH AN LÀNH
          </Text>
          <Text.Title className="t-h1" style={{ color: '#fff', marginTop: 6, maxWidth: '80%' }}>
            Thiên nhiên Việt cho cả nhà
          </Text.Title>
          {user && (
            <Text size="xSmall" style={{ color: 'var(--primary-100)', marginTop: 6 }}>
              {vi.home.greeting(user.fullName ?? vi.auth.greetingFallback)}
              {user.pointsBalance != null ? ` · ${vi.home.pointsChip(user.pointsBalance)}` : ''}
            </Text>
          )}
          <Box
            role="button"
            className="tubu-press"
            onClick={() => goBrand()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 14,
              background: '#fff',
              color: 'var(--primary-700)',
              borderRadius: 'var(--radius-full)',
              padding: '9px 16px',
              fontWeight: 700,
              fontSize: 13.5,
            }}
          >
            Khám phá vườn <ChevronRight size={16} strokeWidth={2.4} />
          </Box>
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
            <s.Icon size={16} color="var(--leaf-700)" strokeWidth={1.9} />
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
          <Box style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
            <Map size={22} color="#fff" strokeWidth={1.9} />
          </Box>
          <Box style={{ flex: 1 }}>
            <Text bold style={{ color: '#fff' }}>
              Hành trình nguyên liệu
            </Text>
            <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Khám phá 6 vùng đất làm nên sản phẩm Tubu
            </Text>
          </Box>
          <ChevronRight size={20} color="#fff" strokeWidth={2} />
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
      <HomeSection title="Cho mẹ và bé" query={momBaby} onRetry={() => void momBaby.refetch()} />

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
