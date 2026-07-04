import { useState } from 'react';
import { Box, Text, Input } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { suggestProducts, type ProductSuggestion } from '../../services/shop-api';
import { useDebounced } from '../../utils/use-debounced';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';

/** Chọn sản phẩm để gắn vào bài đăng cộng đồng — tìm + chip đã chọn (cap `max`). */
export function ProductPicker({
  value,
  onChange,
  max = 5,
}: {
  value: ProductSuggestion[];
  onChange: (v: ProductSuggestion[]) => void;
  max?: number;
}) {
  const [q, setQ] = useState('');
  const [maxWarning, setMaxWarning] = useState(false);
  const dq = useDebounced(q, 300);

  const suggestQ = useQuery({
    queryKey: ['suggest', dq],
    queryFn: () => suggestProducts(dq),
    enabled: dq.trim().length >= 1,
  });

  const results = (suggestQ.data ?? []).filter((p) => !value.some((v) => v.slug === p.slug));

  const add = (p: ProductSuggestion) => {
    if (value.some((v) => v.slug === p.slug)) return;
    if (value.length >= max) {
      haptic('light');
      setMaxWarning(true);
      return;
    }
    haptic('light');
    setMaxWarning(false);
    onChange([...value, p]);
    setQ('');
  };

  const remove = (slug: string) => {
    haptic('light');
    setMaxWarning(false);
    onChange(value.filter((v) => v.slug !== slug));
  };

  return (
    <Box mt={3}>
      <Text size="xSmall" bold style={{ marginBottom: 4 }}>
        {vi.community.tagProducts}
      </Text>

      {value.length > 0 && (
        <Box flex style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {value.map((p) => (
            <Box
              key={p.slug}
              flex
              alignItems="center"
              style={{
                gap: 6,
                padding: '4px 8px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--neutral-100)',
                background: 'var(--neutral-0)',
              }}
            >
              {p.thumbnail && (
                <img src={p.thumbnail} alt="" width={24} height={24} style={{ borderRadius: 4, objectFit: 'cover' }} />
              )}
              <Text size="xSmall" style={{ maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </Text>
              <X size={14} onClick={() => remove(p.slug)} style={{ cursor: 'pointer', color: 'var(--neutral-400)', flex: '0 0 auto' }} />
            </Box>
          ))}
        </Box>
      )}

      <Input.Search
        placeholder={vi.community.searchProduct}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        clearable
      />

      {maxWarning && (
        <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 4 }}>
          {vi.community.maxProducts}
        </Text>
      )}

      {dq.trim().length >= 1 && (
        <Box mt={2}>
          {results.map((p) => (
            <Box
              key={p.slug}
              className="tubu-press"
              onClick={() => add(p)}
              flex
              alignItems="center"
              style={{ gap: 8, padding: '6px 0', cursor: 'pointer' }}
            >
              {p.thumbnail && (
                <img src={p.thumbnail} alt="" width={32} height={32} style={{ borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }} />
              )}
              <Box style={{ flex: 1, overflow: 'hidden' }}>
                <Text size="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </Text>
                <Text size="xSmall" bold style={{ color: 'var(--primary-700)' }}>
                  {formatVnd(p.basePrice)}
                </Text>
              </Box>
            </Box>
          ))}
          {results.length === 0 && !suggestQ.isFetching && (
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', padding: '6px 0' }}>
              {vi.community.noProductsFound}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
