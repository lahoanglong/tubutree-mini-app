import { useState } from 'react';
import { Box, Page, Text, Input, Spinner, Header } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchProducts, fetchBrands } from '../services/shop-api';
import ProductCard from '../components/product-card';

export default function BrowsePage() {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState<string | undefined>();

  const { data: brands } = useQuery({ queryKey: ['brands'], queryFn: fetchBrands });
  const { data, isLoading } = useQuery({
    queryKey: ['products', 'browse', q, brand],
    queryFn: () =>
      fetchProducts({ limit: 30, ...(q ? { q } : {}), ...(brand ? { brand } : {}) }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Khám phá" showBackIcon={false} />
      <Box p={3}>
        <Input.Search
          placeholder="Tìm sản phẩm..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Box>

      <Box px={3} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
        <Chip label="Tất cả" active={!brand} onClick={() => setBrand(undefined)} />
        {brands?.map((b) => (
          <Chip key={b.brand} label={b.brand} active={brand === b.brand} onClick={() => setBrand(b.brand)} />
        ))}
      </Box>

      {isLoading ? (
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      ) : (
        <Box px={3} pb={6} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {data?.data.map((p) => <ProductCard key={p.id} product={p} />)}
          {data?.data.length === 0 && (
            <Text size="small" style={{ color: 'var(--neutral-400)' }}>
              Không tìm thấy sản phẩm.
            </Text>
          )}
        </Box>
      )}
    </Page>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      style={{
        whiteSpace: 'nowrap',
        padding: '6px 14px',
        borderRadius: 'var(--radius-full)',
        fontSize: 13,
        background: active ? 'var(--green-600)' : 'var(--neutral-100)',
        color: active ? 'white' : 'var(--neutral-600)',
        cursor: 'pointer',
      }}
    >
      {label}
    </Box>
  );
}
