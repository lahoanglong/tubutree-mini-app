import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMyStorefront, createStorefront, publishStorefront,
  createCollection, addItem, updateItem, removeItem, pickerProducts,
  type StorefrontEdit, type PickerProduct,
} from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';

export default function StorefrontBuilderPage() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const sfQ = useQuery({ queryKey: ['my-storefront'], queryFn: getMyStorefront, retry: false });

  const createMut = useMutation({
    mutationFn: createStorefront,
    onSuccess: () => { haptic('medium'); void qc.invalidateQueries({ queryKey: ['my-storefront'] }); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (sfQ.isLoading) {
    return <Page className="page"><Box p={4}><Skeleton style={{ height: 120, borderRadius: 16 }} /></Box></Page>;
  }
  if (sfQ.isError) {
    // Chỉ 404 = chưa có gian hàng → mời tạo. Lỗi network/500/401 → ErrorState có retry
    // (không nuốt lỗi thành "Tạo gian hàng" vì bấm Tạo cũng sẽ fail). retry:false để 404 không retry.
    const status = (sfQ.error as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return (
        <Page className="page" style={{ background: 'var(--neutral-50)' }}>
          <Box p={6}>
            <EmptyState art="sprout" heading={vi.storefront.title} body={vi.storefront.empty}
              ctaLabel={vi.storefront.create} onCta={() => createMut.mutate()} />
          </Box>
        </Page>
      );
    }
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box p={6}><ErrorState message={getErrorMessage(sfQ.error)} onRetry={() => void sfQ.refetch()} /></Box>
      </Page>
    );
  }
  return <Builder sf={sfQ.data!} />;
}

function Builder({ sf }: { sf: StorefrontEdit }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-storefront'] });

  const publishMut = useMutation({
    mutationFn: () => publishStorefront(true),
    onSuccess: () => { haptic('medium'); openSnackbar({ text: vi.storefront.published, type: 'success' }); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const newColMut = useMutation({
    mutationFn: () => createCollection({ title: 'Bộ sưu tập mới' }),
    onSuccess: () => void refresh(),
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const itemMut = useMutation({
    mutationFn: (v: { id: string; dto: { isPinned?: boolean; isHidden?: boolean } }) => updateItem(v.id, v.dto),
    onSuccess: () => { haptic('light'); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const delItemMut = useMutation({
    mutationFn: removeItem,
    onSuccess: () => void refresh(),
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>
      <Box p={4}>
        <Text bold size="large">{sf.title}</Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>/{sf.slug}</Text>
      </Box>

      {sf.collections.map((col) => (
        <Box key={col.id} mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
          <Text bold style={{ marginBottom: 8 }}>{col.title}</Text>
          {col.items.map((it) => (
            <Box key={it.id} flex alignItems="center" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
              <Box style={{ flex: 1 }}>
                <Text size="small" style={{ opacity: it.isHidden ? 0.5 : 1 }}>{it.product.name}</Text>
                <Text size="xSmall" style={{ color: 'var(--primary-700)' }}>{formatVnd(it.product.salePrice ?? it.product.basePrice)}</Text>
              </Box>
              <Text size="xSmall" className="tubu-press" onClick={() => itemMut.mutate({ id: it.id, dto: { isPinned: !it.isPinned } })}>⤒</Text>
              <Text size="xSmall" className="tubu-press" onClick={() => itemMut.mutate({ id: it.id, dto: { isHidden: !it.isHidden } })}>{it.isHidden ? '🙈' : '👁'}</Text>
              <Text size="xSmall" className="tubu-press" style={{ color: 'var(--danger)' }} onClick={() => delItemMut.mutate(it.id)}>✕</Text>
            </Box>
          ))}
          <Button size="small" variant="secondary" style={{ marginTop: 8 }} onClick={() => setPickerCol(col.id)}>+ {vi.storefront.addProduct}</Button>
        </Box>
      ))}

      <Box mx={4} mb={3}>
        <Button fullWidth variant="secondary" onClick={() => newColMut.mutate()}>+ {vi.storefront.addCollection}</Button>
      </Box>

      <Box style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: 'var(--neutral-50)', display: 'flex', gap: 8 }}>
        <Button variant="secondary" style={{ flex: 1 }} onClick={() => navigate(`/s/${sf.slug}`)}>{vi.storefront.preview}</Button>
        <Button style={{ flex: 1, background: 'var(--primary-600)' }} loading={publishMut.isPending} onClick={() => publishMut.mutate()}>{vi.storefront.publish}</Button>
      </Box>

      <Sheet visible={!!pickerCol} onClose={() => setPickerCol(null)} autoHeight>
        {pickerCol && <PickerSheet collectionId={pickerCol} onAdded={() => { void refresh(); }} onClose={() => setPickerCol(null)} />}
      </Sheet>
    </Page>
  );
}

function PickerSheet({ collectionId, onAdded, onClose }: { collectionId: string; onAdded: () => void; onClose: () => void }) {
  const { openSnackbar } = useSnackbar();
  const [search, setSearch] = useState('');
  const listQ = useQuery({ queryKey: ['picker', search], queryFn: () => pickerProducts(search) });
  const addMut = useMutation({
    mutationFn: (p: PickerProduct) => addItem(collectionId, { productId: p.id }),
    onSuccess: () => { haptic('light'); onAdded(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <Text bold size="large" style={{ marginBottom: 12 }}>{vi.storefront.addProduct}</Text>
      <Input placeholder={vi.storefront.pickerSearch} value={search} onChange={(e) => setSearch(e.target.value)} />
      <Box mt={3} style={{ maxHeight: 360, overflowY: 'auto' }}>
        {listQ.isError ? <ErrorState message={getErrorMessage(listQ.error)} onRetry={() => void listQ.refetch()} /> :
          (listQ.data ?? []).map((p) => (
            <Box key={p.id} flex alignItems="center" style={{ gap: 8, padding: '8px 0', borderBottom: '1px solid var(--neutral-100)' }}>
              <Box style={{ flex: 1 }}>
                <Text size="small">{p.name}</Text>
                <Box flex alignItems="center" style={{ gap: 6 }}>
                  <Text size="xSmall" style={{ color: 'var(--primary-700)' }}>{formatVnd(p.salePrice ?? p.basePrice)}</Text>
                  {p.maxAffiliateRate > 0 && (
                    <Text size="xSmall" style={{ color: 'var(--leaf-700)', background: 'var(--leaf-50)', padding: '1px 6px', borderRadius: 'var(--radius-full)' }}>
                      +{p.maxAffiliateRate}% {vi.storefront.commission}
                    </Text>
                  )}
                </Box>
              </Box>
              <Button size="small" style={{ background: 'var(--primary-600)' }} onClick={() => addMut.mutate(p)}>+ Thêm</Button>
            </Box>
          ))}
      </Box>
      <Button fullWidth variant="secondary" style={{ marginTop: 12 }} onClick={onClose}>Xong</Button>
    </Box>
  );
}
