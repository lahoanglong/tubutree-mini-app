import { useState, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Input, Page, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Pin, Eye, EyeOff, Trash2, Target, Settings, Pencil, MessageSquarePlus, UserRoundCog, TrendingUp, Plus, Check,
  type LucideIcon,
} from 'lucide-react';
import {
  getMyStorefront, createStorefront, publishStorefront, updateStorefront,
  createCollection, updateCollection, deleteCollection, addItem, updateItem, removeItem, pickerProducts,
  getQuests, claimQuest, getStorefrontStats, getStorefrontCategories, applyStorefrontTemplate,
  type StorefrontEdit, type PickerProduct, type StorefrontCategory,
} from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { formatVnd, formatPoints } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { DEFAULT_STOREFRONT_THEME_COLOR, STOREFRONT_THEME_COLORS } from '../utils/storefront-theme';
import { Badge } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { Icon, type IconProps } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { PriceTag } from '../components/ui/price-tag';
import { ProgressBar } from '../components/ui/progress-bar';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Heading, Text } from '../components/ui/text';
import { ContentKitSheet } from '../components/content-kit-sheet';
import { ImageUpload } from '../components/image-upload';

const TEMPLATE_TITLE = 'Bắt đầu nhanh với 1 mẫu có sẵn';
const TEMPLATE_HINT =
  'Chọn danh mục gần với sản phẩm bạn muốn giới thiệu — chúng tôi tự thêm sẵn 8 sản phẩm nổi bật, bạn chỉnh sửa sau cũng được.';
const CONFIG_TITLE = 'Cấu hình Subdomain, Kho & VietQR';

/** Thẻ cách mép trang 16px, cách thẻ kế 12px — dùng chung cho mọi khối trong trang. */
const CARD_MARGIN: CSSProperties = { margin: '0 16px 12px' };

/** Form dài trong sheet: giới hạn chiều cao để sheet không phủ kín tới đỉnh màn hình. */
const SCROLL_BODY: CSSProperties = { maxHeight: '70vh', overflowY: 'auto', overscrollBehavior: 'contain' };

/** Mỗi nhánh render có đúng một h1 (PageHeader) và cùng nền. */
function BuilderShell({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)', ...style }}>
      <PageHeader title={vi.storefront.title} />
      {children}
    </Page>
  );
}

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
    return (
      <BuilderShell>
        <div style={{ padding: 16 }}><Skeleton height={120} radius="var(--radius-card)" /></div>
      </BuilderShell>
    );
  }
  if (sfQ.isError) {
    // Chỉ 404 = chưa có gian hàng → mời tạo. Lỗi network/500/401 → ErrorState có retry
    // (không nuốt lỗi thành "Tạo gian hàng" vì bấm Tạo cũng sẽ fail). retry:false để 404 không retry.
    const status = (sfQ.error as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return (
        <BuilderShell>
          <div style={{ padding: 24 }}>
            <EmptyState art="sprout" heading={vi.storefront.title} body={vi.storefront.empty}
              ctaLabel={vi.storefront.create} onCta={() => setPickerOpen(true)} ctaLoading={createMut.isPending} />
          </div>
          <BottomSheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={TEMPLATE_TITLE} description={TEMPLATE_HINT}>
            <TemplatePickerSheet
              applying={createWithTemplateMut.isPending}
              applyingCategoryId={createWithTemplateMut.variables ?? null}
              onPick={(categoryId) => createWithTemplateMut.mutate(categoryId)}
              onSkip={() => { setPickerOpen(false); createMut.mutate(); }}
              skipLoading={createMut.isPending}
            />
          </BottomSheet>
        </BuilderShell>
      );
    }
    return (
      <BuilderShell>
        <div style={{ padding: 24 }}><ErrorState message={getErrorMessage(sfQ.error)} onRetry={() => void sfQ.refetch()} /></div>
      </BuilderShell>
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
        Bỏ qua, tự tạo gian hàng trống
      </Button>
    </>
  );
}

/** Nút chỉ-icon trong hàng/thẻ: vùng chạm 44px và cho chỉnh tông icon (IconButton của DS chưa có `tone`). */
function RowIconButton({
  icon, label, tone = 'muted', onPress,
}: { icon: LucideIcon; label: string; tone?: NonNullable<IconProps['tone']>; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="tubu-press touch-target"
      onClick={onPress}
      style={{ minWidth: 44, minHeight: 44, flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 'var(--radius-pill)' }}
    >
      <Icon icon={icon} size="sm" tone={tone} />
    </button>
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
  // Nhiệm vụ "Viết lý do cho 3 sản phẩm" đọc StorefrontItem.note, nhưng builder
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
    <BuilderShell style={{ paddingBottom: 'calc(100px + var(--safe-bottom))' }}>
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <Heading variant="title-md" as="h2">{sf.title}</Heading>
          {/* Không có badge này thì CTV không biết gian hàng đã đăng hay còn nháp — bấm
              "Xem trước" ra trang lỗi mà không hiểu vì sao (P0-2 audit mạch lạc CTV). */}
          <Badge tone={sf.isPublished ? 'success' : 'neutral'} size="sm">
            {sf.isPublished ? vi.storefront.statusPublished : vi.storefront.statusDraft}
          </Badge>
        </div>
        <Text variant="caption" tone="tertiary" as="div">
          {sf.subdomain ? `${sf.subdomain}.tubutree.com` : `/${sf.slug}`}
        </Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button variant="secondary" icon={UserRoundCog} style={{ flex: 1 }} onPress={() => setProfileOpen(true)}>
            {vi.storefront.editProfile}
          </Button>
          <Button variant="secondary" icon={Settings} style={{ flex: 1 }} onPress={() => setConfigOpen(true)}>
            Cấu hình
          </Button>
        </div>
      </div>

      {/* Hồ sơ gian hàng — đúng thứ khách nhìn thấy đầu tiên, và là điều kiện của nhiệm vụ
          "Hoàn thiện hồ sơ gian hàng". */}
      <div
        role="button"
        aria-label={vi.storefront.editProfile}
        className="tubu-press"
        onClick={() => setProfileOpen(true)}
        {...rowKeyboardProps()}
        style={{ ...CARD_MARGIN, background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)', overflow: 'hidden' }}
      >
        <div
          style={{
            height: 84,
            background: sf.coverUrl
              ? `center/cover no-repeat url(${sf.coverUrl})`
              : 'linear-gradient(135deg, var(--sage-100), var(--forest-100))',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              flexShrink: 0,
              border: '2px solid var(--color-bg-surface)',
              marginTop: -28,
              background: sf.avatarUrl
                ? `center/cover no-repeat url(${sf.avatarUrl})`
                : 'var(--stone-200)',
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text variant="body-sm" tone={sf.headerNote ? 'primary' : 'tertiary'} as="div">
              {sf.headerNote || vi.storefront.profileHint}
            </Text>
          </div>
          <Icon icon={Pencil} size="sm" tone="muted" />
        </div>
      </div>

      {sf.collections.map((col) => (
        <Card key={col.id} style={CARD_MARGIN}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Heading variant="title-sm" as="h2" style={{ flex: 1, minWidth: 0 }}>{col.title}</Heading>
            <RowIconButton icon={Pencil} label={vi.storefront.renameCollection} onPress={() => setRenaming({ id: col.id, title: col.title })} />
            <RowIconButton icon={Trash2} tone="danger" label={vi.storefront.deleteCollection} onPress={() => setConfirmDeleteCol(col.id)} />
          </div>
          {col.items.map((it) => {
            const prod = it.product ?? productMap.get(it.productId);
            const name = prod?.name ?? 'Sản phẩm';
            const price = prod?.salePrice ?? prod?.basePrice ?? 0;
            const slug = prod?.slug;

            return (
              <div key={it.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body-sm" as="div" style={{ opacity: it.isHidden ? 0.5 : 1 }}>{name}</Text>
                    <PriceTag value={price} size="sm" />
                  </div>
                  <RowIconButton
                    icon={Pin}
                    tone={it.isPinned ? 'brand' : 'muted'}
                    label={it.isPinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
                    onPress={() => itemMut.mutate({ id: it.id, dto: { isPinned: !it.isPinned } })}
                  />
                  <RowIconButton
                    icon={it.isHidden ? EyeOff : Eye}
                    tone={it.isHidden ? 'muted' : 'brand'}
                    label={it.isHidden ? 'Hiện sản phẩm' : 'Ẩn sản phẩm'}
                    onPress={() => itemMut.mutate({ id: it.id, dto: { isHidden: !it.isHidden } })}
                  />
                  <RowIconButton icon={Trash2} tone="danger" label="Xoá khỏi bộ sưu tập" onPress={() => setConfirmDeleteItemId(it.id)} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <button
                    type="button"
                    className="tubu-press"
                    onClick={() => setNotingItem({ id: it.id, note: it.note ?? '' })}
                    style={{
                      flex: 1, minWidth: 0, minHeight: 44, padding: 0, display: 'flex', alignItems: 'center', gap: 4,
                      border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <Icon icon={MessageSquarePlus} size="sm" tone={it.note ? 'muted' : 'brand'} style={{ flexShrink: 0 }} />
                    <Text variant="caption" tone={it.note ? 'secondary' : 'brand'} style={{ fontStyle: it.note ? 'italic' : 'normal' }}>
                      {it.note ? `“${it.note}”` : vi.storefront.itemNoteEmpty}
                    </Text>
                  </button>
                  {slug && (
                    <Button variant="ghost" onPress={() => setContentKitSlug(slug)}>
                      {vi.contentKit.entryLabel}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          <Button variant="secondary" icon={Plus} style={{ marginTop: 8 }} onPress={() => setPickerCol(col.id)}>
            {vi.storefront.addProduct}
          </Button>
        </Card>
      ))}

      <div style={{ ...CARD_MARGIN, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Input
          value={newColTitle}
          placeholder={vi.storefront.collectionNamePlaceholder}
          onChange={(e) => setNewColTitle(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          variant="secondary"
          icon={Plus}
          disabled={!newColTitle.trim()}
          loading={newColMut.isPending}
          onPress={() => newColMut.mutate(newColTitle.trim())}
        >
          {vi.storefront.addCollection}
        </Button>
      </div>

      <StatsSection />
      <QuestSection />

      <StickyActionBar
        secondary={
          <Button
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => {
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
        }
        primary={
          <Button fullWidth loading={publishMut.isPending} onPress={() => publishMut.mutate()}>
            {vi.storefront.publish}
          </Button>
        }
      />

      <BottomSheet open={!!pickerCol} onClose={() => setPickerCol(null)} title={vi.storefront.addProduct}>
        {pickerCol && <PickerSheet collectionId={pickerCol} onAdded={() => { void refresh(); }} onClose={() => setPickerCol(null)} />}
      </BottomSheet>

      <BottomSheet open={!!renaming} onClose={() => setRenaming(null)} title={vi.storefront.renameCollection}>
        {renaming && (
          <>
            <Input
              value={renaming.title}
              onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
            />
            <Button
              fullWidth
              disabled={!renaming.title.trim()}
              loading={renameColMut.isPending}
              onPress={() => renameColMut.mutate({ id: renaming.id, title: renaming.title.trim() })}
              style={{ marginTop: 12 }}
            >
              {vi.common.save}
            </Button>
          </>
        )}
      </BottomSheet>

      <BottomSheet open={!!confirmDeleteCol} onClose={() => setConfirmDeleteCol(null)} title={vi.storefront.deleteCollectionConfirm}>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Button variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmDeleteCol(null)}>
            {vi.common.cancel}
          </Button>
          <Button
            variant="danger"
            style={{ flex: 1 }}
            loading={deleteColMut.isPending}
            onPress={() => confirmDeleteCol && deleteColMut.mutate(confirmDeleteCol)}
          >
            {vi.storefront.deleteCollection}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet open={configOpen} onClose={() => setConfigOpen(false)} title={CONFIG_TITLE}>
        <MerchantConfigSheet sf={sf} onSaved={() => void refresh()} onClose={() => setConfigOpen(false)} />
      </BottomSheet>

      <BottomSheet open={profileOpen} onClose={() => setProfileOpen(false)} title={vi.storefront.profileTitle} description={vi.storefront.profileHint}>
        {profileOpen && (
          <ProfileSheet sf={sf} onClose={() => setProfileOpen(false)} onSaved={() => void refresh()} />
        )}
      </BottomSheet>

      <BottomSheet
        open={!!notingItem}
        onClose={() => setNotingItem(null)}
        title={vi.storefront.itemNote}
        description="Lời thật của bạn thuyết phục hơn mọi mô tả sản phẩm — khách thấy ngay dưới tên món."
      >
        {notingItem && (
          <>
            <Input.TextArea
              value={notingItem.note}
              maxLength={200}
              placeholder={vi.storefront.itemNotePlaceholder}
              onChange={(e) => setNotingItem({ ...notingItem, note: e.target.value })}
            />
            <Text variant="label" tone="tertiary" as="div" style={{ marginTop: 4 }}>
              {notingItem.note.length}/200
            </Text>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" style={{ flex: 1 }} onPress={() => setNotingItem(null)}>
                Huỷ
              </Button>
              <Button
                style={{ flex: 1 }}
                loading={noteMut.isPending}
                onPress={() => noteMut.mutate({ id: notingItem.id, note: notingItem.note.trim() })}
              >
                Lưu
              </Button>
            </div>
          </>
        )}
      </BottomSheet>

      <ContentKitSheet
        visible={!!contentKitSlug}
        onClose={() => setContentKitSlug(null)}
        productSlug={contentKitSlug ?? ''}
      />

      {/* Xác nhận xoá sản phẩm khỏi gian hàng (thao tác không hoàn tác) */}
      <BottomSheet open={!!confirmDeleteItemId} onClose={() => setConfirmDeleteItemId(null)} title="Xoá sản phẩm này khỏi gian hàng?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
          <Button fullWidth variant="secondary" onPress={() => setConfirmDeleteItemId(null)}>
            Huỷ
          </Button>
          <Button
            fullWidth
            variant="danger"
            loading={delItemMut.isPending}
            onPress={() => delItemMut.mutate(confirmDeleteItemId!)}
          >
            Xoá
          </Button>
        </div>
      </BottomSheet>
    </BuilderShell>
  );
}

function StatBox({ value, label, tone }: { value: string; label: string; tone?: 'brand' }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)', padding: 10, textAlign: 'center' }}>
      <Text variant="body-md" tone={tone} as="div" style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{value}</Text>
      <Text variant="caption" tone="tertiary" as="div">{label}</Text>
    </div>
  );
}

/** Section "Thống kê" — sản phẩm nào trong gian hàng đang bán chạy, để CTV biết mà tối ưu. */
function StatsSection() {
  const statsQ = useQuery({ queryKey: ['storefront-stats'], queryFn: getStorefrontStats });
  const data = statsQ.data;
  if (!data) return null;

  return (
    <Card style={CARD_MARGIN}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon icon={TrendingUp} size="md" tone="brand" />
        <Heading variant="title-sm" as="h2">Thống kê 30 ngày</Heading>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <StatBox value={String(data.orders30d)} label={`Đơn (7 ngày: ${data.orders7d})`} />
        <StatBox value={formatVnd(data.revenue30d)} label="Doanh thu" />
        <StatBox value={formatVnd(data.commission30d)} label="Hoa hồng" tone="brand" />
      </div>
      {data.byProduct.length === 0 ? (
        <Text variant="caption" tone="tertiary" as="div">Chưa có đơn nào qua gian hàng — chia sẻ link để bắt đầu bán nhé.</Text>
      ) : (
        data.byProduct.slice(0, 5).map((p) => (
          <div key={p.productSlug || p.productName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
            <Text variant="body-sm" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.productName}</Text>
            <Text variant="caption" tone="tertiary" style={{ whiteSpace: 'nowrap', marginLeft: 8 }}>{p.qty} món · {formatVnd(p.revenue)}</Text>
          </div>
        ))
      )}
    </Card>
  );
}

/** Section "Hành trình gian hàng" — chuỗi nhiệm vụ early-win thưởng Điểm Xanh. */
function QuestSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const questsQ = useQuery({ queryKey: ['storefront-quests'], queryFn: getQuests });
  const claimMut = useMutation({
    mutationFn: (code: string) => claimQuest(code),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({ text: `+${formatPoints(r.rewardPoints)} 🎉`, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['storefront-quests'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const data = questsQ.data;
  if (!data) return null;

  return (
    <Card style={CARD_MARGIN}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon icon={Target} size="md" tone="brand" />
          <Heading variant="title-sm" as="h2">Hành trình gian hàng</Heading>
        </div>
        <Text variant="caption" tone="tertiary">{data.level}/{data.levelMax}</Text>
      </div>
      <Text variant="caption" tone="brand" as="div" style={{ marginBottom: 10 }}>
        Đã nhận {formatPoints(data.totalEarnedPoints)}
      </Text>
      {data.quests.map((q) => {
        // Guard chia-0: goal=0 (nhiệm vụ đã đạt sẵn) → 0/0=NaN hoặc x/0=Infinity → width lỗi. Đạt ngay = 100%.
        const pct = q.goal > 0 ? Math.min(100, Math.round((q.progress / q.goal) * 100)) : 100;
        return (
          <div key={q.code} style={{ padding: '8px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body-sm" as="div" style={{ opacity: q.claimed ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {q.claimed && <Icon icon={Check} size="sm" tone="brand" />}
                  {q.title}
                </Text>
                <Text variant="caption" tone="tertiary" as="div">{q.hint}</Text>
              </div>
              {q.claimed ? (
                <Badge tone="success" size="sm">Đã nhận</Badge>
              ) : q.done ? (
                <Button
                  loading={claimMut.isPending && claimMut.variables === q.code}
                  disabled={claimMut.isPending && claimMut.variables !== q.code}
                  onPress={() => claimMut.mutate(q.code)}
                >
                  +{formatPoints(q.rewardPoints)}
                </Button>
              ) : (
                <Text variant="caption" tone="tertiary" style={{ whiteSpace: 'nowrap' }}>{q.progress}/{q.goal}</Text>
              )}
            </div>
            <div style={{ marginTop: 6 }}>
              <ProgressBar value={pct} max={100} />
            </div>
          </div>
        );
      })}
    </Card>
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
  const products = listQ.data ?? [];

  return (
    <>
      <Input placeholder={vi.storefront.pickerSearch} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto' }}>
        {listQ.isError ? <ErrorState message={getErrorMessage(listQ.error)} onRetry={() => void listQ.refetch()} variant="inline" /> :
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

/**
 * Hồ sơ gian hàng: ảnh đại diện, ảnh bìa, lời nhắn. Ba trường này quyết định nhiệm vụ
 * "Hoàn thiện hồ sơ gian hàng" nhưng trước đây không có màn nào nhập được.
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
    <div style={SCROLL_BODY}>
      {/* Ảnh đại diện nhỏ nên nén mạnh hơn ảnh bìa — cả hai đi kèm mọi lượt xem gian hàng. */}
      <ImageUpload label={vi.storefront.avatar} value={avatarUrl} onChange={setAvatarUrl} maxDim={400} quality={0.8} />
      <ImageUpload label={vi.storefront.cover} value={coverUrl} onChange={setCoverUrl} maxDim={1000} quality={0.75} />

      <Text variant="label" as="div" style={{ marginBottom: 4 }}>{vi.storefront.headerNote}</Text>
      <Input.TextArea
        value={headerNote}
        maxLength={200}
        placeholder={vi.storefront.headerNotePlaceholder}
        onChange={(e) => setHeaderNote(e.target.value)}
      />
      <Text variant="label" tone="tertiary" as="div" style={{ marginTop: 4 }}>
        {headerNote.length}/200
      </Text>

      {!complete && (
        <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 10 }}>
          Đủ cả ba mục sẽ hoàn thành nhiệm vụ “{vi.storefront.profileTitle.toLowerCase()}”.
        </Text>
      )}

      <Button fullWidth loading={saveMut.isPending} onPress={() => saveMut.mutate()} style={{ marginTop: 16 }}>
        Lưu hồ sơ
      </Button>
      <Button fullWidth variant="secondary" style={{ marginTop: 8 }} onPress={onClose}>
        Đóng
      </Button>
    </div>
  );
}

/** Ô chọn màu: hình tròn 32px nhưng vùng chạm 44px, là nút thật có trạng thái chọn. */
function ThemeSwatch({ code, label, selected, onPress }: { code: string; label: string; selected: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      className="tubu-press"
      onClick={onPress}
      style={{ minWidth: 44, minHeight: 44, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          backgroundColor: code,
          border: selected ? '3px solid var(--color-text-primary)' : '2px solid var(--color-bg-surface)',
          boxShadow: 'var(--elevation-1)',
        }}
      />
    </button>
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
    themeColor: sf.themeColor ?? DEFAULT_STOREFRONT_THEME_COLOR,
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

  return (
    <div style={SCROLL_BODY}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Tên gian hàng">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>

        <div>
          <Field label="Subdomain riêng">
            <Input
              placeholder="vd: brand1"
              value={form.subdomain}
              onChange={(e) => setForm({ ...form, subdomain: e.target.value })}
            />
          </Field>
          <Text variant="label" tone="tertiary" as="div" style={{ marginTop: 2 }}>
            URL: {form.subdomain ? `${form.subdomain}.tubutree.com` : 'ten-ban.tubutree.com'}
          </Text>
        </div>

        <div>
          <Text variant="caption" tone="secondary" as="div" style={{ marginBottom: 2 }}>Màu sắc thương hiệu</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {STOREFRONT_THEME_COLORS.map((c) => (
              <ThemeSwatch
                key={c.code}
                code={c.code}
                label={c.label}
                selected={form.themeColor === c.code}
                onPress={() => setForm({ ...form, themeColor: c.code })}
              />
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
          <Heading variant="title-sm" as="h3" style={{ marginBottom: 8 }}>Tài khoản nhận tiền (VietQR 0đ phí)</Heading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              aria-label="Mã BIN ngân hàng"
              placeholder="Mã BIN ngân hàng (vd: 970436 - VCB)"
              value={form.bankBin}
              onChange={(e) => setForm({ ...form, bankBin: e.target.value })}
            />
            <Input
              aria-label="Tên ngân hàng"
              placeholder="Tên ngân hàng (vd: Vietcombank)"
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
            />
            <Input
              aria-label="Số tài khoản ngân hàng"
              placeholder="Số tài khoản ngân hàng"
              value={form.bankAccountNo}
              onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })}
            />
            <Input
              aria-label="Tên chủ tài khoản"
              placeholder="Tên chủ tài khoản (in hoa)"
              value={form.bankAccountName}
              onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
            />
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
          <Heading variant="title-sm" as="h3" style={{ marginBottom: 8 }}>Địa chỉ kho hàng & Hotline</Heading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              aria-label="Địa chỉ kho xuất hàng"
              placeholder="Địa chỉ kho xuất hàng"
              value={form.warehouseAddress}
              onChange={(e) => setForm({ ...form, warehouseAddress: e.target.value })}
            />
            <Input
              aria-label="Tỉnh / Thành phố"
              placeholder="Tỉnh / Thành phố"
              value={form.warehouseCity}
              onChange={(e) => setForm({ ...form, warehouseCity: e.target.value })}
            />
            <Input
              aria-label="Hotline kho liên hệ"
              placeholder="Hotline kho liên hệ"
              value={form.warehousePhone}
              onChange={(e) => setForm({ ...form, warehousePhone: e.target.value })}
            />
          </div>
        </div>

        <Button fullWidth style={{ marginTop: 12 }} loading={saveMut.isPending} onPress={() => saveMut.mutate()}>
          Lưu cấu hình gian hàng
        </Button>
      </div>
    </div>
  );
}
