import { useState } from 'react';
import { Input, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { addItem, getStorefrontCategories, pickerProducts, type PickerProduct, type StorefrontCategory } from '../services/storefront-api';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { EmptyState, ErrorState } from './ui/empty-state';
import { PriceTag } from './ui/price-tag';
import { Skeleton } from './ui/skeleton';
import { Text } from './ui/text';

export const TEMPLATE_TITLE = 'Bắt đầu nhanh với 1 mẫu có sẵn';
export const TEMPLATE_HINT =
  'Chọn danh mục gần với sản phẩm bạn muốn giới thiệu — chúng tôi tự thêm sẵn 8 sản phẩm nổi bật, bạn chỉnh sửa sau cũng được.';

/**
 * Chọn mẫu dựng sẵn theo danh mục khi tạo gian hàng mới — mỗi mẫu tạo sẵn 1 collection + tối
 * đa 8 sản phẩm nổi bật của danh mục đó (POST /storefront/me/apply-template), giảm ma sát cho
 * CTV mới thay vì bắt đầu từ gian hàng trắng hoàn toàn. Luôn có lối "Bỏ qua" để giữ đúng hành
 * vi cũ (tự tạo, tự dựng tay) — không ép buộc.
 */
export function TemplatePickerSheet({
  applying, applyingCategoryId, onPick, onSkip, skipLoading, skipLabel,
}: {
  applying: boolean;
  applyingCategoryId: string | null;
  onPick: (categoryId: string) => void;
  onSkip: () => void;
  skipLoading: boolean;
  skipLabel?: string;
}) {
  const catQ = useQuery({ queryKey: ['storefront-categories'], queryFn: getStorefrontCategories });
  const busy = applying || skipLoading;

  return (
    <>
      {catQ.isLoading && <Skeleton height={120} radius="var(--radius-card)" />}
      {catQ.data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {catQ.data.map((c: StorefrontCategory) => (
            <button
              key={c.id}
              type="button"
              aria-label={`Dùng mẫu ${c.name}`}
              aria-disabled={busy || undefined}
              className="tubu-press"
              onClick={() => !busy && onPick(c.id)}
              style={{
                minHeight: 44, padding: 12, textAlign: 'center', cursor: busy ? 'default' : 'pointer',
                opacity: busy && applyingCategoryId !== c.id ? 0.5 : 1,
                background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-card)',
              }}
            >
              {c.image ? (
                <img src={c.image} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 'var(--radius-media)', margin: '0 auto 6px', display: 'block' }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-media)', background: 'var(--color-bg-subtle)', margin: '0 auto 6px' }} />
              )}
              <Text variant="body-sm">{applying && applyingCategoryId === c.id ? 'Đang dựng...' : c.name}</Text>
            </button>
          ))}
        </div>
      )}
      <Button variant="secondary" fullWidth disabled={applying} loading={skipLoading} style={{ marginTop: 16 }} onPress={onSkip}>
        {skipLabel ?? 'Bỏ qua, tự tạo gian hàng trống'}
      </Button>
    </>
  );
}

export function PickerSheet({ collectionId, onAdded, onClose }: { collectionId: string; onAdded: () => void; onClose: () => void }) {
  const { openSnackbar } = useSnackbar();
  const [search, setSearch] = useState('');
  const listQ = useQuery({ queryKey: ['picker', search], queryFn: () => pickerProducts(search) });
  const addMut = useMutation({
    mutationFn: (p: PickerProduct) => addItem(collectionId, { productId: p.id }),
    onSuccess: () => { haptic('light'); onAdded(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const products = listQ.data ?? [];

  return (
    <>
      <Input aria-label={vi.storefront.pickerSearch} placeholder={vi.storefront.pickerSearch} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto' }}>
        {listQ.isError ? <ErrorState message={getLoadErrorMessage(listQ.error)} onRetry={() => void listQ.refetch()} variant="inline" /> :
          listQ.isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : products.length === 0 ? (
            <EmptyState art="search" heading={vi.ctvOrder.noProductsFound} variant="inline" />
          ) : (
            products.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="body-sm" as="div">{p.name}</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <PriceTag value={p.salePrice ?? p.basePrice} size="sm" />
                    {p.maxAffiliateRate > 0 && (
                      <Badge tone="success" size="sm">
                        +{p.maxAffiliateRate}% {vi.storefront.commission}
                      </Badge>
                    )}
                  </div>
                </div>
                <Button icon={Plus} onPress={() => addMut.mutate(p)}>Thêm</Button>
              </div>
            ))
          )}
      </div>
      <Button fullWidth variant="secondary" style={{ marginTop: 12 }} onPress={onClose}>Xong</Button>
    </>
  );
}

