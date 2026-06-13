import { useEffect, useMemo, useState } from 'react';
import { Box, Page, Input, Header, useLocation, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchProducts, fetchBrands } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import ProductCard from '../components/product-card';
import { ProductGridSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { brandAccent } from '../utils/brands';
import { useDebounced } from '../utils/use-debounced';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

const PAGE_LIMIT = 30;

export default function BrowsePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialBrand = useMemo(
    () => new URLSearchParams(location.search).get('brand') ?? undefined,
    [location.search],
  );

  const [q, setQ] = useState('');
  const [brand, setBrand] = useState<string | undefined>(initialBrand);
  const [sort, setSort] = useState<string | undefined>(undefined);
  const debouncedQ = useDebounced(q, 300);

  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands });
  const products = useQuery({
    queryKey: ['products', 'browse', debouncedQ, brand, sort],
    queryFn: () =>
      fetchProducts({
        limit: PAGE_LIMIT,
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(brand ? { brand } : {}),
        ...(sort ? { sort } : {}),
      }),
  });

  const SORTS = [
    { key: undefined, label: 'Gợi ý' },
    { key: 'newest', label: 'Mới nhất' },
    { key: 'price_asc', label: 'Giá thấp → cao' },
    { key: 'price_desc', label: 'Giá cao → thấp' },
  ] as const;

  // Deeplink từ Home (?brand=) thay đổi khi trang còn mounted → sync vào state.
  useEffect(() => {
    if (initialBrand) setBrand(initialBrand);
  }, [initialBrand]);

  const pick = (b?: string) => {
    haptic('light');
    setBrand(b);
    // User tự đổi filter → trả URL về sạch để query param cũ không dính lại.
    if (initialBrand && b !== initialBrand) navigate('/browse', { replace: true });
  };

  const list = products.data?.data ?? [];

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 72 }}>
      <Header title={vi.browse.title} showBackIcon={false} />
      <Box p={3}>
        <Input.Search
          placeholder={vi.browse.searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          clearable
        />
      </Box>

      <Box px={3} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10 }}>
        <Chip label={vi.home.allBrands} active={!brand} onClick={() => pick(undefined)} />
        {brands.data?.map((b) => (
          <Chip
            key={b.brand}
            label={b.brand}
            dotColor={brandAccent(b.brand)}
            active={brand === b.brand}
            onClick={() => pick(b.brand)}
          />
        ))}
      </Box>

      {/* Sắp xếp (backend orderBy: newest/price_asc/price_desc/featured) */}
      <Box px={3} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10 }}>
        {SORTS.map((s) => (
          <Chip
            key={s.label}
            label={s.label}
            active={sort === s.key}
            onClick={() => {
              haptic('light');
              setSort(s.key);
            }}
          />
        ))}
      </Box>

      <Box px={3} pb={6}>
        {products.isLoading ? (
          <ProductGridSkeleton count={6} />
        ) : products.isError ? (
          <ErrorState message={getErrorMessage(products.error)} onRetry={() => void products.refetch()} />
        ) : list.length === 0 ? (
          debouncedQ ? (
            <EmptyState
              art="search"
              heading={vi.browse.noResultHeading(debouncedQ)}
              body={vi.browse.noResultBody}
              ctaLabel={vi.home.allBrands}
              onCta={() => {
                setQ('');
                pick(undefined);
              }}
            />
          ) : (
            <EmptyState art="leaf" heading={vi.browse.emptyHeading} body={vi.browse.emptyBody} />
          )
        ) : (
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {list.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </Box>
        )}
      </Box>

    </Page>
  );
}

function Chip({
  label,
  active,
  onClick,
  dotColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dotColor?: string;
}) {
  return (
    <Box
      role="button"
      aria-pressed={active}
      className="tubu-press"
      onClick={onClick}
      style={{
        whiteSpace: 'nowrap',
        padding: '10px 14px',
        borderRadius: 'var(--radius-full)',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        background: active ? 'var(--primary-600)' : 'var(--neutral-0)',
        border: `1px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
        color: active ? 'white' : 'var(--neutral-600)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        boxSizing: 'border-box',
        flex: '0 0 auto',
      }}
    >
      {dotColor && (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: active ? 'white' : dotColor,
          }}
        />
      )}
      {label}
    </Box>
  );
}
