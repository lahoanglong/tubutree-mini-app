import { useState, useMemo } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMyStorefront, createStorefront, publishStorefront,
  createCollection, addItem, updateItem, removeItem, pickerProducts,
  getQuests, claimQuest,
  type StorefrontEdit, type PickerProduct,
} from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { ContentKitSheet } from '../components/content-kit-sheet';

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
  const [contentKitSlug, setContentKitSlug] = useState<string | null>(null);

  const pickerQ = useQuery({
    queryKey: ['picker', ''],
    queryFn: () => pickerProducts(''),
    staleTime: 5 * 60 * 1000,
  });
  const productMap = useMemo(() => {
    const map = new Map<string, PickerProduct>();
    (pickerQ.data ?? []).forEach((p) => map.set(p.id, p));
    return map;
  }, [pickerQ.data]);

  const refresh = () => {
    // Cập nhật cả tiến trình "Hành trình gian hàng" sau khi thêm SP/đăng (quest đọc từ cùng dữ liệu).
    void qc.invalidateQueries({ queryKey: ['storefront-quests'] });
    return qc.invalidateQueries({ queryKey: ['my-storefront'] });
  };

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
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const delItemMut = useMutation({
    mutationFn: removeItem,
    onSuccess: () => { setConfirmDeleteItemId(null); void refresh(); },
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
          {col.items.map((it) => {
            const prod = it.product ?? productMap.get(it.productId);
            const name = prod?.name ?? 'Sản phẩm';
            const price = prod?.salePrice ?? prod?.basePrice ?? 0;
            const slug = prod?.slug;

            return (
              <Box key={it.id} flex alignItems="center" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
                <Box style={{ flex: 1 }}>
                  <Text size="small" style={{ opacity: it.isHidden ? 0.5 : 1 }}>{name}</Text>
                  <Text size="xSmall" style={{ color: 'var(--primary-700)' }}>{formatVnd(price)}</Text>
                </Box>
                {slug && (
                  <Text
                    size="xSmall"
                    bold
                    className="tubu-press"
                    style={{ color: 'var(--primary-700)' }}
                    onClick={() => setContentKitSlug(slug)}
                  >
                    {vi.contentKit.entryLabel}
                  </Text>
                )}
                <Box
                  role="button"
                  aria-label={it.isPinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
                  className="tubu-press"
                  style={{ minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onClick={() => itemMut.mutate({ id: it.id, dto: { isPinned: !it.isPinned } })}
                >
                  <Text size="xSmall">⤒</Text>
                </Box>
                <Box
                  role="button"
                  aria-label={it.isHidden ? 'Hiện sản phẩm' : 'Ẩn sản phẩm'}
                  className="tubu-press"
                  style={{ minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onClick={() => itemMut.mutate({ id: it.id, dto: { isHidden: !it.isHidden } })}
                >
                  <Text size="xSmall">{it.isHidden ? '🙈' : '👁'}</Text>
                </Box>
                <Box
                  role="button"
                  aria-label="Xoá khỏi bộ sưu tập"
                  className="tubu-press"
                  style={{ minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onClick={() => setConfirmDeleteItemId(it.id)}
                >
                  <Text size="xSmall" style={{ color: 'var(--danger)' }}>✕</Text>
                </Box>
              </Box>
            );
          })}
          <Button size="small" variant="secondary" style={{ marginTop: 8 }} onClick={() => setPickerCol(col.id)}>+ {vi.storefront.addProduct}</Button>
        </Box>
      ))}

      <Box mx={4} mb={3}>
        <Button fullWidth variant="secondary" onClick={() => newColMut.mutate()}>+ {vi.storefront.addCollection}</Button>
      </Box>

      <QuestSection />


      <Box style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: 'var(--neutral-50)', display: 'flex', gap: 8 }}>
        <Button variant="secondary" style={{ flex: 1 }} onClick={() => navigate(`/s/${sf.slug}`)}>{vi.storefront.preview}</Button>
        <Button style={{ flex: 1, background: 'var(--primary-600)' }} loading={publishMut.isPending} onClick={() => publishMut.mutate()}>{vi.storefront.publish}</Button>
      </Box>

      <Sheet visible={!!pickerCol} onClose={() => setPickerCol(null)} autoHeight>
        {pickerCol && <PickerSheet collectionId={pickerCol} onAdded={() => { void refresh(); }} onClose={() => setPickerCol(null)} />}
      </Sheet>

      <ContentKitSheet
        visible={!!contentKitSlug}
        onClose={() => setContentKitSlug(null)}
        productSlug={contentKitSlug ?? ''}
      />

      {/* Xác nhận xoá sản phẩm khỏi gian hàng (thao tác không hoàn tác) */}
      <Sheet visible={!!confirmDeleteItemId} onClose={() => setConfirmDeleteItemId(null)} autoHeight>
        <Box p={5} style={{ textAlign: 'center' }}>
          <Text.Title size="small">Xoá sản phẩm này khỏi gian hàng?</Text.Title>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
            <Button fullWidth variant="secondary" onClick={() => setConfirmDeleteItemId(null)}>
              Huỷ
            </Button>
            <Button
              fullWidth
              loading={delItemMut.isPending}
              onClick={() => delItemMut.mutate(confirmDeleteItemId!)}
              style={{ background: 'var(--danger)' }}
            >
              Xoá
            </Button>
          </Box>
        </Box>
      </Sheet>
    </Page>
  );
}

/** Section "Hành trình gian hàng" — chuỗi nhiệm vụ early-win thưởng TubuXu. */
function QuestSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const questsQ = useQuery({ queryKey: ['storefront-quests'], queryFn: getQuests });
  const claimMut = useMutation({
    mutationFn: (code: string) => claimQuest(code),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({ text: `+${r.rewardXu.toLocaleString('vi-VN')} TubuXu 🎉`, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['storefront-quests'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const data = questsQ.data;
  if (!data) return null;

  return (
    <Box mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
      <Box flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
        <Text bold>🎯 Hành trình gian hàng</Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>{data.level}/{data.levelMax}</Text>
      </Box>
      <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginBottom: 10 }}>
        Đã nhận {data.totalEarnedXu.toLocaleString('vi-VN')} TubuXu
      </Text>
      {data.quests.map((q) => (
        <Box key={q.code} style={{ padding: '8px 0', borderTop: '1px solid var(--neutral-100)' }}>
          <Box flex alignItems="center" justifyContent="space-between" style={{ gap: 8 }}>
            <Box style={{ flex: 1 }}>
              <Text size="small" style={{ opacity: q.claimed ? 0.6 : 1 }}>
                {q.claimed ? '✓ ' : ''}{q.title}
              </Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>{q.hint}</Text>
            </Box>
            {q.claimed ? (
              <Text size="xSmall" style={{ color: 'var(--leaf-700)', whiteSpace: 'nowrap' }}>Đã nhận</Text>
            ) : q.done ? (
              <Button
                size="small"
                style={{ background: 'var(--primary-600)', whiteSpace: 'nowrap' }}
                loading={claimMut.isPending && claimMut.variables === q.code}
                onClick={() => claimMut.mutate(q.code)}
              >
                +{q.rewardXu.toLocaleString('vi-VN')} xu
              </Button>
            ) : (
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', whiteSpace: 'nowrap' }}>{q.progress}/{q.goal}</Text>
            )}
          </Box>
          {/* thanh tiến trình mảnh */}
          <Box style={{ height: 4, background: 'var(--neutral-100)', borderRadius: 'var(--radius-full)', marginTop: 6, overflow: 'hidden' }}>
            <Box style={{ height: '100%', width: `${Math.round((q.progress / q.goal) * 100)}%`, background: q.done ? 'var(--leaf-600)' : 'var(--primary-400)' }} />
          </Box>
        </Box>
      ))}
    </Box>
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
