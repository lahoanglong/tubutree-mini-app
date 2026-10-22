import { useState } from 'react';
import { Input } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Text } from '../ui/text';
import { IconButton } from '../ui/icon-button';
import { ListRow } from '../ui/list-row';
import { suggestProducts, type ProductSuggestion } from '../../services/shop-api';
import { isSuggestable } from '../../hooks/use-suggest';
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

  // Cổng xét cả từ khoá đang gõ (chưa debounce): xoá bớt xuống dưới 2 ký tự thì ẩn gợi ý ngay.
  const canSuggest = isSuggestable(q) && isSuggestable(dq);
  const tooShort = q.trim() !== '' && !isSuggestable(q);

  const suggestQ = useQuery({
    queryKey: ['suggest', dq],
    queryFn: () => suggestProducts(dq),
    enabled: canSuggest,
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
    <div style={{ marginTop: 12 }}>
      <Text variant="label" as="div" style={{ marginBottom: 4 }}>
        {vi.community.tagProducts}
      </Text>

      {value.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {value.map((p) => (
            <div
              key={p.slug}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 0 0 8px',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-surface)',
              }}
            >
              {p.thumbnail && (
                <img src={p.thumbnail} alt="" width={24} height={24} style={{ borderRadius: 4, objectFit: 'cover' }} />
              )}
              <Text variant="caption" style={{ maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </Text>
              <IconButton icon={X} size="sm" label={vi.common.cancel} onPress={() => remove(p.slug)} />
            </div>
          ))}
        </div>
      )}

      <Input.Search
        aria-label={vi.community.searchProduct}
        placeholder={vi.community.searchProduct}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setMaxWarning(false);
        }}
        clearable
      />

      {maxWarning && (
        <Text variant="caption" tone="danger" as="div" style={{ marginTop: 4 }}>
          {vi.community.maxProducts}
        </Text>
      )}

      {tooShort && (
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
          {vi.common.suggestMinChars}
        </Text>
      )}

      {canSuggest && (
        <div style={{ marginTop: 8 }}>
          {results.map((p) => (
            <ListRow
              key={p.slug}
              icon={
                p.thumbnail ? (
                  <img src={p.thumbnail} alt="" width={32} height={32} style={{ borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }} />
                ) : undefined
              }
              title={p.name}
              subtitle={<Text variant="price-sm" tone="brand">{formatVnd(p.basePrice)}</Text>}
              onPress={() => add(p)}
              style={{ padding: '6px 0' }}
            />
          ))}
          {results.length === 0 && !suggestQ.isFetching && (
            <Text variant="caption" tone="tertiary" as="div" style={{ padding: '6px 0' }}>
              {vi.community.noProductsFound}
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
