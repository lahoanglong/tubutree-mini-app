import { useState, useMemo } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pin, Eye, EyeOff, Trash2, Target, Settings, Pencil, MessageSquarePlus, UserRoundCog, TrendingUp } from 'lucide-react';
import {
  getMyStorefront, createStorefront, publishStorefront, updateStorefront,
  createCollection, updateCollection, deleteCollection, addItem, updateItem, removeItem, pickerProducts,
  getQuests, claimQuest, getStorefrontStats, getStorefrontCategories, applyStorefrontTemplate,
  type StorefrontEdit, type PickerProduct, type StorefrontCategory,
} from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { ContentKitSheet } from '../components/content-kit-sheet';
import { ImageUpload } from '../components/image-upload';

export default function StorefrontBuilderPage() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const sfQ = useQuery({ queryKey: ['my-storefront'], queryFn: getMyStorefront, retry: false });
  const [pickerOpen, setPickerOpen] = useState(false);

  const createMut = useMutation({
    mutationFn: createStorefront,
    onSuccess: () => { haptic('medium'); void qc.invalidateQueries({ queryKey: ['my-storefront'] }); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  // Tạo gian hàng RỒI áp mẫu — tách 2 bước để lỗi ở bước áp mẫu (vd hết SP gợi ý) không
  // chặn gian hàng đã tạo, CTV vẫn vào được Builder để tự thêm collection.
  const createWithTemplateMut = useMutation({
    mutationFn: async (categoryId: string) => {
      await createStorefront();
      return applyStorefrontTemplate(categoryId);
    },
    onSuccess: () => {
      haptic('medium');
      setPickerOpen(false);
      void qc.invalidateQueries({ queryKey: ['my-storefront'] });
    },
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
              ctaLabel={vi.storefront.create} onCta={() => setPickerOpen(true)} ctaLoading={createMut.isPending} />
          </Box>
          <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} autoHeight>
            <TemplatePickerSheet
              applying={createWithTemplateMut.isPending}
              applyingCategoryId={createWithTemplateMut.variables ?? null}
              onPick={(categoryId) => createWithTemplateMut.mutate(categoryId)}
              onSkip={() => { setPickerOpen(false); createMut.mutate(); }}
              skipLoading={createMut.isPending}
            />
          </Sheet>
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

/**
 * Chọn mẫu dựng sẵn theo danh mục khi tạo gian hàng mới — mỗi mẫu tạo sẵn 1 collection + tối
 * đa 8 sản phẩm nổi bật của danh mục đó (POST /storefront/me/apply-template), giảm ma sát cho
 * CTV mới thay vì bắt đầu từ gian hàng trắng hoàn toàn. Luôn có lối "Bỏ qua" để giữ đúng hành
 * vi cũ (tự tạo, tự dựng tay) — không ép buộc.
 */
function TemplatePickerSheet({
  applying, applyingCategoryId, onPick, onSkip, skipLoading,
}: {
  applying: boolean;
  applyingCategoryId: string | null;
  onPick: (categoryId: string) => void;
  onSkip: () => void;
  skipLoading: boolean;
}) {
  const catQ = useQuery({ queryKey: ['storefront-categories'], queryFn: getStorefrontCategories });
  const busy = applying || skipLoading;

  return (
    <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <Text bold size="large">Bắt đầu nhanh với 1 mẫu có sẵn</Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-500)', marginTop: 2, marginBottom: 12 }}>
        Chọn danh mục gần với sản phẩm bạn muốn giới thiệu — chúng tôi tự thêm sẵn 8 sản phẩm nổi bật, bạn chỉnh sửa sau cũng được.
      </Text>
      {catQ.isLoading && <Skeleton style={{ height: 120, borderRadius: 16 }} />}
      {catQ.data && (
        <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {catQ.data.map((c: StorefrontCategory) => (
            <Box
              key={c.id}
              role="button"
              aria-label={`Dùng mẫu ${c.name}`}
              className="tubu-press"
              onClick={() => !busy && onPick(c.id)}
              style={{
                border: '1px solid var(--neutral-200)', borderRadius: 'var(--radius-lg)', padding: 12,
                textAlign: 'center', cursor: busy ? 'default' : 'pointer', opacity: busy && applyingCategoryId !== c.id ? 0.5 : 1,
              }}
            >
              {c.image ? (
                <img src={c.image} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 10, margin: '0 auto 6px' }} />
              ) : (
                <Box style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--leaf-50)', margin: '0 auto 6px' }} />
              )}
              <Text size="small">{applying && applyingCategoryId === c.id ? 'Đang dựng...' : c.name}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Button
        variant="secondary"
        fullWidth
        disabled={busy}
        loading={skipLoading}
        style={{ marginTop: 16 }}
        onClick={onSkip}
      >
        Bỏ qua, tự tạo gian hàng trống
      </Button>
    </Box>
  );
}

function Builder({ sf }: { sf: StorefrontEdit }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const [contentKitSlug, setContentKitSlug] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Nhiệm vụ "Viết lý do cho 3 sản phẩm" (1.500 xu) đọc StorefrontItem.note, nhưng builder
  // chưa từng có ô nhập note — CTV không thể hoàn thành dù thanh tiến trình vẫn hiện (P0-5).
  const [notingItem, setNotingItem] = useState<{ id: string; note: string } | null>(null);

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
  // Tạo bộ sưu tập phải có TÊN do CTV đặt: trước đây mọi bộ đều tên "Bộ sưu tập mới" và
  // không sửa/xoá được (dù API đã có sẵn) — bấm nhầm 2-3 lần là gian hàng công khai có 3 mục
  // trùng tên vĩnh viễn (P1-6 audit mạch lạc CTV).
  const [newColTitle, setNewColTitle] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<string | null>(null);

  const newColMut = useMutation({
    mutationFn: (title: string) => createCollection({ title }),
    onSuccess: () => {
      setNewColTitle('');
      void refresh();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const renameColMut = useMutation({
    mutationFn: (v: { id: string; title: string }) => updateCollection(v.id, { title: v.title }),
    onSuccess: () => {
      setRenaming(null);
      void refresh();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const deleteColMut = useMutation({
    mutationFn: (id: string) => deleteCollection(id),
    onSuccess: () => {
      setConfirmDeleteCol(null);
      void refresh();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const itemMut = useMutation({
    mutationFn: (v: { id: string; dto: { isPinned?: boolean; isHidden?: boolean } }) => updateItem(v.id, v.dto),
    onSuccess: () => { haptic('light'); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const noteMut = useMutation({
    mutationFn: (v: { id: string; note: string }) => updateItem(v.id, { note: v.note }),
    onSuccess: () => {
      haptic('light');
      setNotingItem(null);
      openSnackbar({ text: vi.storefront.itemNoteSaved, type: 'success' });
      void refresh();
    },
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
      <Box p={4} flex alignItems="center" justifyContent="space-between">
        <Box>
          <Box flex alignItems="center" style={{ gap: 6 }}>
            <Text bold size="large">{sf.title}</Text>
            {/* Không có badge này thì CTV không biết gian hàng đã đăng hay còn nháp — bấm
                "Xem trước" ra trang lỗi mà không hiểu vì sao (P0-2 audit mạch lạc CTV). */}
            <span
              style={{
                background: sf.isPublished ? 'var(--success-bg)' : 'var(--neutral-100)',
                color: sf.isPublished ? 'var(--leaf-700)' : 'var(--neutral-600)',
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {sf.isPublished ? vi.storefront.statusPublished : vi.storefront.statusDraft}
            </span>
          </Box>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {sf.subdomain ? `${sf.subdomain}.tubutree.com` : `/${sf.slug}`}
          </Text>
        </Box>
        <Box flex style={{ gap: 6 }}>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setProfileOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <UserRoundCog size={14} /> {vi.storefront.editProfile}
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setConfigOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Settings size={14} /> Cấu hình
          </Button>
        </Box>
      </Box>

      {/* Hồ sơ gian hàng — đúng thứ khách nhìn thấy đầu tiên, và là điều kiện của nhiệm vụ
          "Hoàn thiện hồ sơ gian hàng" (2.000 xu). */}
      <Box
        mx={4}
        mb={3}
        role="button"
        aria-label={vi.storefront.editProfile}
        className="tubu-press"
        onClick={() => setProfileOpen(true)}
        style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}
      >
        <Box
          style={{
            height: 84,
            background: sf.coverUrl
              ? `center/cover no-repeat url(${sf.coverUrl})`
              : 'linear-gradient(135deg, var(--leaf-100), var(--primary-100))',
          }}
        />
        <Box flex alignItems="center" p={3} style={{ gap: 10 }}>
          <Box
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              flexShrink: 0,
              border: '2px solid var(--neutral-0)',
              marginTop: -28,
              background: sf.avatarUrl
                ? `center/cover no-repeat url(${sf.avatarUrl})`
                : 'var(--neutral-200)',
            }}
          />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="small" style={{ color: sf.headerNote ? 'var(--neutral-900)' : 'var(--neutral-400)' }}>
              {sf.headerNote || vi.storefront.profileHint}
            </Text>
          </Box>
          <Pencil size={15} color="var(--neutral-400)" />
        </Box>
      </Box>

      {sf.collections.map((col) => (
        <Box key={col.id} mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
          <Box flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 8, gap: 8 }}>
            <Text bold style={{ flex: 1, minWidth: 0 }}>{col.title}</Text>
            <Box
              role="button"
              aria-label={vi.storefront.renameCollection}
              className="tubu-press touch-target"
              onClick={() => setRenaming({ id: col.id, title: col.title })}
            >
              <Pencil size={15} color="var(--neutral-400)" />
            </Box>
            <Box
              role="button"
              aria-label={vi.storefront.deleteCollection}
              className="tubu-press touch-target"
              onClick={() => setConfirmDeleteCol(col.id)}
            >
              <Trash2 size={15} color="var(--danger)" />
            </Box>
          </Box>
          {col.items.map((it) => {
            const prod = it.product ?? productMap.get(it.productId);
            const name = prod?.name ?? 'Sản phẩm';
            const price = prod?.salePrice ?? prod?.basePrice ?? 0;
            const slug = prod?.slug;

            return (
              <Box key={it.id} flex alignItems="center" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="small" style={{ opacity: it.isHidden ? 0.5 : 1 }}>{name}</Text>
                  <Text size="xSmall" style={{ color: 'var(--primary-700)' }}>{formatVnd(price)}</Text>
                  <Text
                    size="xSmall"
                    className="tubu-press"
                    onClick={() => setNotingItem({ id: it.id, note: it.note ?? '' })}
                    style={{
                      color: it.note ? 'var(--neutral-600)' : 'var(--leaf-700)',
                      fontStyle: it.note ? 'italic' : 'normal',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      marginTop: 2,
                    }}
                  >
                    <MessageSquarePlus size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
                    {it.note ? `“${it.note}”` : vi.storefront.itemNoteEmpty}
                  </Text>
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
                  <Pin size={15} color={it.isPinned ? 'var(--primary-700)' : 'var(--neutral-400)'} strokeWidth={2} />
                </Box>
                <Box
                  role="button"
                  aria-label={it.isHidden ? 'Hiện sản phẩm' : 'Ẩn sản phẩm'}
                  className="tubu-press"
                  style={{ minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onClick={() => itemMut.mutate({ id: it.id, dto: { isHidden: !it.isHidden } })}
                >
                  {it.isHidden ? <EyeOff size={16} color="var(--neutral-400)" /> : <Eye size={16} color="var(--leaf-700)" />}
                </Box>
                <Box
                  role="button"
                  aria-label="Xoá khỏi bộ sưu tập"
                  className="tubu-press"
                  style={{ minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onClick={() => setConfirmDeleteItemId(it.id)}
                >
                  <Trash2 size={15} color="var(--danger)" />
                </Box>
              </Box>
            );
          })}
          <Button size="small" variant="secondary" style={{ marginTop: 8 }} onClick={() => setPickerCol(col.id)}>+ {vi.storefront.addProduct}</Button>
        </Box>
      ))}

      <Box mx={4} mb={3}>
        <Box flex style={{ gap: 8 }}>
          <Input
            value={newColTitle}
            placeholder={vi.storefront.collectionNamePlaceholder}
            onChange={(e) => setNewColTitle(e.target.value)}
            style={{ flex: 1 }}
          />
          <Button
            variant="secondary"
            disabled={!newColTitle.trim() || newColMut.isPending}
            loading={newColMut.isPending}
            onClick={() => newColMut.mutate(newColTitle.trim())}
          >
            + {vi.storefront.addCollection}
          </Button>
        </Box>
      </Box>

      <StatsSection />
      <QuestSection />


      <Box style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: 'var(--neutral-50)', display: 'flex', gap: 8 }}>
        <Button
          variant="secondary"
          style={{ flex: 1 }}
          onClick={() => {
            // Trang /s/:slug chỉ trả gian hàng ĐÃ ĐĂNG. Trước đây bấm "Xem trước" lúc còn nháp
            // là rơi thẳng vào màn lỗi "Gian hàng không tồn tại hoặc chưa đăng".
            if (!sf.isPublished) {
              openSnackbar({ text: vi.storefront.previewNeedsPublish, type: 'warning' });
              return;
            }
            navigate(`/s/${sf.slug}`);
          }}
        >
          {vi.storefront.preview}
        </Button>
        <Button style={{ flex: 1, background: 'var(--primary-600)' }} loading={publishMut.isPending} disabled={publishMut.isPending} onClick={() => publishMut.mutate()}>{vi.storefront.publish}</Button>
      </Box>

      <Sheet visible={!!pickerCol} onClose={() => setPickerCol(null)} autoHeight>
        {pickerCol && <PickerSheet collectionId={pickerCol} onAdded={() => { void refresh(); }} onClose={() => setPickerCol(null)} />}
      </Sheet>

      <Sheet visible={!!renaming} onClose={() => setRenaming(null)} autoHeight>
        {renaming && (
          <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
            <Text bold size="large" style={{ marginBottom: 12 }}>{vi.storefront.renameCollection}</Text>
            <Input
              value={renaming.title}
              onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
            />
            <Button
              fullWidth
              disabled={!renaming.title.trim() || renameColMut.isPending}
              loading={renameColMut.isPending}
              onClick={() => renameColMut.mutate({ id: renaming.id, title: renaming.title.trim() })}
              style={{ marginTop: 12, background: 'var(--primary-600)' }}
            >
              {vi.common.save}
            </Button>
          </Box>
        )}
      </Sheet>

      <Sheet visible={!!confirmDeleteCol} onClose={() => setConfirmDeleteCol(null)} autoHeight>
        <Box p={5} style={{ textAlign: 'center', paddingBottom: 'calc(20px + var(--safe-bottom))' }}>
          <Text bold size="large">{vi.storefront.deleteCollectionConfirm}</Text>
          <Box flex style={{ gap: 8, marginTop: 16 }}>
            <Button variant="secondary" style={{ flex: 1 }} onClick={() => setConfirmDeleteCol(null)}>
              {vi.common.cancel}
            </Button>
            <Button
              style={{ flex: 1, background: 'var(--danger)' }}
              loading={deleteColMut.isPending} disabled={deleteColMut.isPending}
              onClick={() => confirmDeleteCol && deleteColMut.mutate(confirmDeleteCol)}
            >
              {vi.storefront.deleteCollection}
            </Button>
          </Box>
        </Box>
      </Sheet>

      <Sheet visible={configOpen} onClose={() => setConfigOpen(false)} autoHeight>
        <MerchantConfigSheet sf={sf} onClose={() => setConfigOpen(false)} onSaved={() => void refresh()} />
      </Sheet>

      <Sheet visible={profileOpen} onClose={() => setProfileOpen(false)} autoHeight>
        {profileOpen && (
          <ProfileSheet sf={sf} onClose={() => setProfileOpen(false)} onSaved={() => void refresh()} />
        )}
      </Sheet>

      <Sheet visible={!!notingItem} onClose={() => setNotingItem(null)} autoHeight>
        {notingItem && (
          <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
            <Text bold size="large">{vi.storefront.itemNote}</Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-500)', marginTop: 2, marginBottom: 12 }}>
              Lời thật của bạn thuyết phục hơn mọi mô tả sản phẩm — khách thấy ngay dưới tên món.
            </Text>
            <Input.TextArea
              value={notingItem.note}
              maxLength={200}
              placeholder={vi.storefront.itemNotePlaceholder}
              onChange={(e) => setNotingItem({ ...notingItem, note: e.target.value })}
            />
            <Text size="xxxxSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
              {notingItem.note.length}/200
            </Text>
            <Box flex style={{ gap: 8, marginTop: 16 }}>
              <Button variant="secondary" style={{ flex: 1 }} onClick={() => setNotingItem(null)}>
                Huỷ
              </Button>
              <Button
                style={{ flex: 1, background: 'var(--primary-600)' }}
                loading={noteMut.isPending} disabled={noteMut.isPending}
                onClick={() => noteMut.mutate({ id: notingItem.id, note: notingItem.note.trim() })}
              >
                Lưu
              </Button>
            </Box>
          </Box>
        )}
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
              loading={delItemMut.isPending} disabled={delItemMut.isPending}
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

/** Section "Thống kê" — sản phẩm nào trong gian hàng đang bán chạy, để CTV biết mà tối ưu. */
function StatsSection() {
  const statsQ = useQuery({ queryKey: ['storefront-stats'], queryFn: getStorefrontStats });
  const data = statsQ.data;
  if (!data) return null;

  return (
    <Box mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
      <Box flex alignItems="center" style={{ gap: 6, marginBottom: 10 }}>
        <TrendingUp size={18} color="var(--primary-700)" strokeWidth={2} />
        <Text bold>Thống kê 30 ngày</Text>
      </Box>
      <Box flex style={{ gap: 8, marginBottom: 12 }}>
        <Box style={{ flex: 1, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: 10, textAlign: 'center' }}>
          <Text bold size="large">{data.orders30d}</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Đơn (7 ngày: {data.orders7d})</Text>
        </Box>
        <Box style={{ flex: 1, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: 10, textAlign: 'center' }}>
          <Text bold size="large">{formatVnd(data.revenue30d)}</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Doanh thu</Text>
        </Box>
        <Box style={{ flex: 1, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: 10, textAlign: 'center' }}>
          <Text bold size="large" style={{ color: 'var(--leaf-700)' }}>{formatVnd(data.commission30d)}</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>Hoa hồng</Text>
        </Box>
      </Box>
      {data.byProduct.length === 0 ? (
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>Chưa có đơn nào qua gian hàng — chia sẻ link để bắt đầu bán nhé.</Text>
      ) : (
        data.byProduct.slice(0, 5).map((p) => (
          <Box key={p.productSlug || p.productName} flex alignItems="center" justifyContent="space-between" style={{ padding: '6px 0', borderTop: '1px solid var(--neutral-100)' }}>
            <Text size="small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.productName}</Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-500)', whiteSpace: 'nowrap', marginLeft: 8 }}>{p.qty} món · {formatVnd(p.revenue)}</Text>
          </Box>
        ))
      )}
    </Box>
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
        <Box flex alignItems="center" style={{ gap: 6 }}>
          <Target size={18} color="var(--primary-700)" strokeWidth={2} />
          <Text bold>Hành trình gian hàng</Text>
        </Box>
        <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>{data.level}/{data.levelMax}</Text>
      </Box>
      <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginBottom: 10 }}>
        Đã nhận {data.totalEarnedXu.toLocaleString('vi-VN')} TubuXu
      </Text>
      {data.quests.map((q) => {
        // Guard chia-0: goal=0 (nhiệm vụ đã đạt sẵn) → 0/0=NaN hoặc x/0=Infinity → width lỗi. Đạt ngay = 100%.
        const pct = q.goal > 0 ? Math.min(100, Math.round((q.progress / q.goal) * 100)) : 100;
        return (
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
                loading={claimMut.isPending && claimMut.variables === q.code} disabled={claimMut.isPending}
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
            <Box style={{ height: '100%', width: `${pct}%`, background: q.done ? 'var(--leaf-600)' : 'var(--primary-400)' }} />
          </Box>
        </Box>
        );
      })}
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

/**
 * Hồ sơ gian hàng: ảnh đại diện, ảnh bìa, lời nhắn. Ba trường này quyết định nhiệm vụ
 * "Hoàn thiện hồ sơ gian hàng" (2.000 xu) nhưng trước đây không có màn nào nhập được.
 */
function ProfileSheet({
  sf,
  onClose,
  onSaved,
}: {
  sf: StorefrontEdit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const [avatarUrl, setAvatarUrl] = useState(sf.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(sf.coverUrl ?? '');
  const [headerNote, setHeaderNote] = useState(sf.headerNote ?? '');

  const saveMut = useMutation({
    mutationFn: () =>
      // Gửi chuỗi RỖNG (không phải undefined) khi CTV chủ động xoá: undefined bị PATCH bỏ qua,
      // nên trước đây xoá ảnh bìa rồi bấm Lưu là snackbar báo thành công mà ảnh cũ vẫn còn trên
      // gian hàng công khai, thử lại bao nhiêu lần cũng vậy.
      updateStorefront({
        avatarUrl: avatarUrl.trim(),
        coverUrl: coverUrl.trim(),
        headerNote: headerNote.trim(),
      }),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: vi.storefront.profileSaved, type: 'success' });
      onSaved();
      onClose();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const complete = !!(avatarUrl.trim() && coverUrl.trim() && headerNote.trim());

  return (
    <Box p={4} style={{ maxHeight: '80vh', overflowY: 'auto', paddingBottom: 'calc(24px + var(--safe-bottom))' }}>
      <Text.Title size="small">{vi.storefront.profileTitle}</Text.Title>
      <Text size="xSmall" style={{ color: 'var(--neutral-500)', marginTop: 2, marginBottom: 14 }}>
        {vi.storefront.profileHint}
      </Text>

      {/* Ảnh đại diện nhỏ nên nén mạnh hơn ảnh bìa — cả hai đi kèm mọi lượt xem gian hàng. */}
      <ImageUpload label={vi.storefront.avatar} value={avatarUrl} onChange={setAvatarUrl} maxDim={400} quality={0.8} />
      <ImageUpload label={vi.storefront.cover} value={coverUrl} onChange={setCoverUrl} maxDim={1000} quality={0.75} />

      <Text size="xSmall" bold style={{ marginBottom: 4 }}>{vi.storefront.headerNote}</Text>
      <Input.TextArea
        value={headerNote}
        maxLength={200}
        placeholder={vi.storefront.headerNotePlaceholder}
        onChange={(e) => setHeaderNote(e.target.value)}
      />
      <Text size="xxxxSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
        {headerNote.length}/200
      </Text>

      {!complete && (
        <Text size="xSmall" style={{ color: 'var(--neutral-500)', marginTop: 10 }}>
          Đủ cả ba mục sẽ hoàn thành nhiệm vụ “{vi.storefront.profileTitle.toLowerCase()}”.
        </Text>
      )}

      <Button
        fullWidth
        loading={saveMut.isPending} disabled={saveMut.isPending}
        onClick={() => saveMut.mutate()}
        style={{ marginTop: 16, background: 'var(--primary-600)' }}
      >
        Lưu hồ sơ
      </Button>
      <Button fullWidth variant="secondary" style={{ marginTop: 8 }} onClick={onClose}>
        Đóng
      </Button>
    </Box>
  );
}

function MerchantConfigSheet({
  sf,
  onClose,
  onSaved,
}: {
  sf: StorefrontEdit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const [form, setForm] = useState({
    title: sf.title ?? '',
    subdomain: sf.subdomain ?? '',
    themeColor: sf.themeColor ?? '#16a34a',
    bankName: sf.bankName ?? '',
    bankBin: sf.bankBin ?? '',
    bankAccountNo: sf.bankAccountNo ?? '',
    bankAccountName: sf.bankAccountName ?? '',
    warehouseAddress: sf.warehouseAddress ?? '',
    warehouseCity: sf.warehouseCity ?? '',
    warehousePhone: sf.warehousePhone ?? '',
  });

  const saveMut = useMutation({
    mutationFn: () =>
      updateStorefront({
        title: form.title.trim() || undefined,
        subdomain: form.subdomain.trim() ? form.subdomain.trim().toLowerCase() : undefined,
        themeColor: form.themeColor,
        bankName: form.bankName.trim() || undefined,
        bankBin: form.bankBin.trim() || undefined,
        bankAccountNo: form.bankAccountNo.trim() || undefined,
        bankAccountName: form.bankAccountName.trim() || undefined,
        warehouseAddress: form.warehouseAddress.trim() || undefined,
        warehouseCity: form.warehouseCity.trim() || undefined,
        warehousePhone: form.warehousePhone.trim() || undefined,
      }),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Đã lưu cấu hình gian hàng!', type: 'success' });
      onSaved();
      onClose();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const PRESET_COLORS = [
    { code: '#16a34a', label: 'Xanh lá' },
    { code: '#0d9488', label: 'Ngọc' },
    { code: '#2563eb', label: 'Xanh dương' },
    { code: '#7c3aed', label: 'Tím' },
    { code: '#ea580c', label: 'Đất nung' },
  ];

  return (
    <Box p={4} style={{ maxHeight: '80vh', overflowY: 'auto', paddingBottom: 'calc(24px + var(--safe-bottom))' }}>
      <Text.Title size="small" style={{ marginBottom: 16 }}>
        Cấu hình Subdomain, Kho & VietQR
      </Text.Title>

      <Box style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Box>
          <Text size="xSmall" bold style={{ marginBottom: 4 }}>Tên gian hàng</Text>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Box>

        <Box>
          <Text size="xSmall" bold style={{ marginBottom: 4 }}>Subdomain riêng</Text>
          <Input
            placeholder="vd: brand1"
            value={form.subdomain}
            onChange={(e) => setForm({ ...form, subdomain: e.target.value })}
          />
          <Text size="xxxxSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
            URL: {form.subdomain ? `${form.subdomain}.tubutree.com` : 'ten-ban.tubutree.com'}
          </Text>
        </Box>

        <Box>
          <Text size="xSmall" bold style={{ marginBottom: 6 }}>Màu sắc thương hiệu</Text>
          <Box flex style={{ gap: 8 }}>
            {PRESET_COLORS.map((c) => (
              <Box
                key={c.code}
                onClick={() => setForm({ ...form, themeColor: c.code })}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: c.code,
                  cursor: 'pointer',
                  border: form.themeColor === c.code ? '3px solid #000' : '2px solid #fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            ))}
          </Box>
        </Box>

        <Box style={{ borderTop: '1px solid var(--neutral-100)', paddingTop: 12 }}>
          <Text bold size="small" style={{ marginBottom: 8 }}>Tài khoản nhận tiền (VietQR 0đ phí)</Text>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              placeholder="Mã BIN ngân hàng (vd: 970436 - VCB)"
              value={form.bankBin}
              onChange={(e) => setForm({ ...form, bankBin: e.target.value })}
            />
            <Input
              placeholder="Tên ngân hàng (vd: Vietcombank)"
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
            />
            <Input
              placeholder="Số tài khoản ngân hàng"
              value={form.bankAccountNo}
              onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })}
            />
            <Input
              placeholder="Tên chủ tài khoản (in hoa)"
              value={form.bankAccountName}
              onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
            />
          </Box>
        </Box>

        <Box style={{ borderTop: '1px solid var(--neutral-100)', paddingTop: 12 }}>
          <Text bold size="small" style={{ marginBottom: 8 }}>Địa chỉ kho hàng & Hotline</Text>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              placeholder="Địa chỉ kho xuất hàng"
              value={form.warehouseAddress}
              onChange={(e) => setForm({ ...form, warehouseAddress: e.target.value })}
            />
            <Input
              placeholder="Tỉnh / Thành phố"
              value={form.warehouseCity}
              onChange={(e) => setForm({ ...form, warehouseCity: e.target.value })}
            />
            <Input
              placeholder="Hotline kho liên hệ"
              value={form.warehousePhone}
              onChange={(e) => setForm({ ...form, warehousePhone: e.target.value })}
            />
          </Box>
        </Box>

        <Button
          fullWidth
          style={{ marginTop: 12, background: 'var(--primary-600)' }}
          loading={saveMut.isPending} disabled={saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          Lưu cấu hình gian hàng
        </Button>
      </Box>
    </Box>
  );
}

