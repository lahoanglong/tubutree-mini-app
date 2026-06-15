import { useEffect, useMemo, useState } from 'react';
import { Box, Page, Text, Input, useLocation, useNavigate } from 'zmp-ui';
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
const SEGMENT_LABELS: Record<string, string> = {
  mom_baby: '🍼 Cho mẹ & bé',
  home_clean: '🧼 Nhà bếp xanh',
  skincare: '🧴 Chăm sóc cá nhân',
  eco: '♻️ Sống xanh',
};
const RECENT_KEY = 'tubu_recent_searches';
const RECENT_MAX = 8;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function pushRecent(term: string): string[] {
  const t = term.trim();
  if (t.length < 2) return readRecent();
  const next = [t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export default function BrowsePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialBrand = useMemo(
    () => new URLSearchParams(location.search).get('brand') ?? undefined,
    [location.search],
  );
  const initialSegment = useMemo(
    () => new URLSearchParams(location.search).get('segment') ?? undefined,
    [location.search],
  );

  const [q, setQ] = useState('');
  const [brand, setBrand] = useState<string | undefined>(initialBrand);
  const [segment, setSegment] = useState<string | undefined>(initialSegment);
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const debouncedQ = useDebounced(q, 300);

  // Lưu từ khoá vào "tìm gần đây" khi user gõ một truy vấn có nghĩa (≥2 ký tự).
  useEffect(() => {
    if (debouncedQ.trim().length >= 2) setRecent(pushRecent(debouncedQ));
  }, [debouncedQ]);

  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands });
  const products = useQuery({
    queryKey: ['products', 'browse', debouncedQ, brand, segment, sort],
    queryFn: () =>
      fetchProducts({
        limit: PAGE_LIMIT,
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(brand ? { brand } : {}),
        ...(segment ? { segment } : {}),
        ...(sort ? { sort } : {}),
      }),
  });

  const SORTS = [
    { key: undefined, label: 'Gợi ý' },
    { key: 'newest', label: 'Mới nhất' },
    { key: 'price_asc', label: 'Giá thấp → cao' },
    { key: 'price_desc', label: 'Giá cao → thấp' },
  ] as const;

  // Deeplink từ Home (?brand= / ?segment=) thay đổi khi trang còn mounted → sync vào state.
  useEffect(() => {
    if (initialBrand) setBrand(initialBrand);
  }, [initialBrand]);
  useEffect(() => {
    setSegment(initialSegment);
  }, [initialSegment]);

  const pick = (b?: string) => {
    haptic('light');
    setBrand(b);
    // User tự đổi filter → trả URL về sạch để query param cũ không dính lại.
    if (initialBrand && b !== initialBrand) navigate('/browse', { replace: true });
  };

  const list = products.data?.data ?? [];

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 72 }}>
      <Box p={3}>
        <Input.Search
          placeholder={vi.browse.searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          clearable
        />
      </Box>

      {/* Tìm gần đây + Xu hướng — chỉ hiện khi chưa gõ gì (màn tìm kiếm §6.12). */}
      {!q.trim() && (
        <Box px={3} pb={1}>
          {recent.length > 0 && (
            <Box mb={2}>
              <Box flex alignItems="center" justifyContent="space-between" mb={1}>
                <Text size="xSmall" bold style={{ color: 'var(--neutral-600)' }}>
                  Tìm gần đây
                </Text>
                <Text
                  size="xSmall"
                  className="tubu-press"
                  onClick={() => {
                    try {
                      localStorage.removeItem(RECENT_KEY);
                    } catch {
                      /* ignore */
                    }
                    setRecent([]);
                  }}
                  style={{ color: 'var(--neutral-400)' }}
                >
                  Xoá
                </Text>
              </Box>
              <Box style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {recent.map((t) => (
                  <Chip key={t} label={`🕘 ${t}`} active={false} onClick={() => setQ(t)} />
                ))}
              </Box>
            </Box>
          )}
          {(brands.data?.length ?? 0) > 0 && (
            <Box>
              <Text size="xSmall" bold style={{ color: 'var(--neutral-600)', display: 'block', marginBottom: 6 }}>
                Xu hướng
              </Text>
              <Box style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {brands.data?.slice(0, 6).map((b) => (
                  <Chip
                    key={b.brand}
                    label={`🔥 ${b.brand}`}
                    dotColor={brandAccent(b.brand)}
                    active={false}
                    onClick={() => setQ(b.brand)}
                  />
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {segment && (
        <Box px={3} pb={2}>
          <Box
            role="button"
            className="tubu-press"
            onClick={() => {
              setSegment(undefined);
              navigate('/browse', { replace: true });
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--leaf-600)',
              color: '#fff',
              borderRadius: 'var(--radius-full)',
              padding: '6px 12px',
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {SEGMENT_LABELS[segment] ?? segment} ✕
          </Box>
        </Box>
      )}

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
