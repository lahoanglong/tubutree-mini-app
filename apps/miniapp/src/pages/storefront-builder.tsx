import { useState, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Input, Page, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Pin, Eye, EyeOff, Trash2, Target, Settings, Pencil, MessageSquarePlus, UserRoundCog, TrendingUp, Plus, Check, Share2, ImagePlus,
  type LucideIcon,
} from 'lucide-react';
import {
  getMyStorefront, publishStorefront, updateStorefront,
  createCollection, updateCollection, deleteCollection, updateItem, removeItem, pickerProducts,
  getQuests, claimQuest, getStorefrontStats,
  type StorefrontEdit, type PickerProduct,
} from '../services/storefront-api';
import { STOREFRONT_REVIEW_PROMISE, shouldStartSignupWizard, storefrontPublishCopy,
  storefrontPublishedMessage, storefrontStatusView } from '@tubutree/app-core/storefront-signup';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { formatVnd, formatPoints } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { DEFAULT_STOREFRONT_THEME_COLOR, STOREFRONT_THEME_COLORS } from '../utils/storefront-theme';
import { Badge } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
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
import { ShareSheet } from '../components/share-sheet';
import { PickerSheet } from '../components/storefront-pickers';
import { StorefrontPreview } from '../components/storefront-preview';
import { StorefrontSignupFlow } from './storefront-signup';
import { isPartnerStore } from '../utils/partner-store';

const CONFIG_TITLE = 'Cài đặt gian hàng';

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
  const sfQ = useQuery({ queryKey: ['my-storefront'], queryFn: getMyStorefront, retry: false });
  const [fullEditor, setFullEditor] = useState(false);
  // Quyết định vào luồng 4 bước đúng một lần, lúc dữ liệu về: giữa chừng (đã tạo, còn nháp) không bị đá sang trình dựng.
  const wizardRef = useRef<boolean | null>(null);

  if (sfQ.isLoading) {
    return (
      <BuilderShell>
        <div style={{ padding: 16 }}><Skeleton height={120} radius="var(--radius-card)" /></div>
      </BuilderShell>
    );
  }
  // Chỉ 404 = chưa có gian hàng. Lỗi network/500/401 → ErrorState có retry (không nuốt lỗi thành màn tạo gian hàng
  // vì bấm tạo cũng sẽ fail). retry:false để 404 không retry.
  const status = (sfQ.error as { response?: { status?: number } } | null)?.response?.status;
  if (sfQ.isError && !sfQ.data && status !== 404) {
    return (
      <BuilderShell>
        <div style={{ padding: 24 }}><ErrorState message={getLoadErrorMessage(sfQ.error)} onRetry={() => void sfQ.refetch()} /></div>
      </BuilderShell>
    );
  }
  const sf = sfQ.data ?? null;
  // Luồng 4 bước dành cho gian hàng mới hoặc còn phải qua duyệt; đã duyệt (hoặc cờ duyệt tắt) mà bị gỡ thì vào thẳng trình dựng để đăng lại.
  wizardRef.current ??= shouldStartSignupWizard(sf);
  if (sf && (!wizardRef.current || sf.status !== 'DRAFT' || fullEditor)) return <Builder sf={sf} />;
  return (
    <BuilderShell>
      <StorefrontSignupFlow sf={sf} onOpenEditor={() => setFullEditor(true)} />
    </BuilderShell>
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
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const view = storefrontStatusView(sf);
  const publishCopy = storefrontPublishCopy(sf);
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
    onSuccess: (res) => { haptic('medium'); openSnackbar({ text: storefrontPublishedMessage(res, sf), type: 'success' }); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const unpublishMut = useMutation({
    mutationFn: () => publishStorefront(false),
    onSuccess: () => {
      haptic('medium');
      setConfirmUnpublish(false);
      openSnackbar({ text: vi.storefront.unpublished, type: 'success' });
      void refresh();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  // API từ chối đăng gian hàng chưa có sản phẩm; chặn ngay ở nút để CTV biết cần làm gì thay vì nhận lỗi.
  const itemCount = sf.collections.reduce((n, c) => n + c.items.length, 0);
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
          {/* Nhãn theo trạng thái máy chủ tính: đã gửi duyệt chưa chắc khách đã thấy, nên không ghi "Đang hiển thị" khi còn chờ duyệt. */}
          <Badge tone={view.tone} size="sm">{view.label}</Badge>
        </div>
        <Text variant="caption" tone="tertiary" as="div">
          {sf.subdomainEnabled && sf.subdomain ? `${sf.subdomain}.tubutree.com` : `/s/${sf.slug}`}
        </Text>
        {view.code === 'LIVE' && (
          <Text variant="caption" tone="tertiary" as="div">{vi.storefront.webRefreshNote}</Text>
        )}
        {(view.hint || sf.publicHiddenReason) && (
          <div
            data-testid="hidden-reason"
            role="status"
            style={{ marginTop: 8, padding: '8px 12px', background: 'var(--color-status-warning-bg)', borderRadius: 'var(--radius-control)' }}
          >
            <Text variant="caption" as="div" style={{ color: 'var(--color-status-warning-fg)' }}>
              {view.code === 'PENDING_APPROVAL' ? view.hint : (sf.publicHiddenReason ?? view.hint)}
            </Text>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button variant="secondary" icon={UserRoundCog} style={{ flex: 1 }} onPress={() => setProfileOpen(true)}>
            {vi.storefront.editProfile}
          </Button>
          <Button variant="secondary" icon={Settings} style={{ flex: 1 }} onPress={() => setConfigOpen(true)}>
            {vi.storefront.settings}
          </Button>
        </div>
        {sf.isPublished && (
          <Button variant="secondary" icon={EyeOff} fullWidth style={{ marginTop: 8 }} onPress={() => setConfirmUnpublish(true)}>
            {view.code === 'PENDING_APPROVAL' ? vi.storefront.withdrawSubmit : vi.storefront.unpublish}
          </Button>
        )}
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            background: sf.coverUrl
              ? `center/cover no-repeat url(${sf.coverUrl})`
              : 'linear-gradient(135deg, var(--sage-100), var(--forest-100))',
          }}
        >
          {!sf.coverUrl && (
            <>
              <Icon icon={ImagePlus} size="sm" tone="brand" />
              <Text variant="caption" tone="brand">{vi.storefront.addCover}</Text>
            </>
          )}
        </div>
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
                    <Text variant="body-sm" as="div" tone={it.isHidden || it.hiddenReason ? 'tertiary' : 'primary'}>{name}</Text>
                    <PriceTag value={price} size="sm" />
                    {it.hiddenReason && (
                      <Badge tone="warning" size="sm" style={{ marginTop: 2, maxWidth: '100%', whiteSpace: 'normal' }}>
                        Khách không thấy: {it.hiddenReason}
                      </Badge>
                    )}
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
          aria-label={vi.storefront.collectionNamePlaceholder}
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
        summary={!sf.isPublished && itemCount === 0 ? <Text variant="caption" tone="secondary" as="div">{vi.storefront.publishNeedsProduct}</Text> : undefined}
        secondary={
          <Button
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => {
              // Trang /s/:slug chỉ trả gian hàng khách đang thấy: chưa thì chủ xem bản xem trước ngay trong app.
              if (!view.canShare) {
                setPreviewOpen(true);
                return;
              }
              navigate(`/s/${sf.slug}`);
            }}
          >
            {vi.storefront.preview}
          </Button>
        }
        primary={
          view.canShare ? (
            <Button fullWidth icon={Share2} aria-label={vi.storefront.shareStore} onPress={() => setShareOpen(true)}>
              {vi.storefront.shareShort}
            </Button>
          ) : sf.isPublished ? (
            <Button fullWidth disabled aria-label={view.code === 'PENDING_APPROVAL' ? vi.storefront.shareAfterApproval : vi.storefront.shareStore}>
              {view.code === 'PENDING_APPROVAL' ? vi.storefront.shareAfterApprovalShort : vi.storefront.shareShort}
            </Button>
          ) : (
            <Button fullWidth disabled={itemCount === 0} loading={publishMut.isPending} onPress={() => publishMut.mutate()}>
              {publishCopy.button}
            </Button>
          )
        }
      />

      <ShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        slug={sf.slug}
        title={sf.title}
        referralCode={sf.referralCode ?? null}
        thumbnail={sf.collections[0]?.items[0]?.product.thumbnail ?? undefined}
      />

      <BottomSheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={vi.storefront.preview} description={view.code === 'DRAFT' ? publishCopy.previewHint : STOREFRONT_REVIEW_PROMISE}>
        <div style={SCROLL_BODY}>
          <StorefrontPreview sf={sf} />
          <Button fullWidth variant="secondary" style={{ marginTop: 12 }} onPress={() => setPreviewOpen(false)}>{vi.common.close}</Button>
        </div>
      </BottomSheet>

      <BottomSheet open={confirmUnpublish} onClose={() => setConfirmUnpublish(false)} title={vi.storefront.unpublishConfirm} description={vi.storefront.unpublishHint}>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Button variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmUnpublish(false)}>
            {vi.common.cancel}
          </Button>
          <Button variant="danger" style={{ flex: 1 }} loading={unpublishMut.isPending} onPress={() => unpublishMut.mutate()}>
            {vi.storefront.unpublish}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet open={!!pickerCol} onClose={() => setPickerCol(null)} title={vi.storefront.addProduct}>
        {pickerCol && <PickerSheet collectionId={pickerCol} onAdded={() => { void refresh(); }} onClose={() => setPickerCol(null)} />}
      </BottomSheet>

      <BottomSheet open={!!renaming} onClose={() => setRenaming(null)} title={vi.storefront.renameCollection}>
        {renaming && (
          <>
            <Input
              aria-label={vi.storefront.renameCollection}
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
              aria-label={vi.storefront.itemNotePlaceholder}
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
  // Các dòng dưới cộng đúng ô Doanh thu: top 5 sản phẩm, phần còn lại gộp một dòng, phần cấp đơn (ship, giảm giá, chênh lệch
  // giữa tiền hoàn thực tế và phần trừ theo tỷ lệ dòng) một dòng.
  const lines = data.byProduct.filter((p) => p.qty > 0);
  const rest = lines.slice(5);
  const orderLevel = data.shippingAndOrderDiscount30d ?? 0;

  return (
    <Card style={CARD_MARGIN}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon icon={TrendingUp} size="md" tone="brand" />
        <Heading variant="title-sm" as="h2">Thống kê 30 ngày</Heading>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <StatBox value={String(data.orders30d)} label="Đơn 30 ngày" />
        <StatBox value={formatVnd(data.revenue30d)} label="Doanh thu" />
        <StatBox value={formatVnd(data.commission30d)} label="Hoa hồng" tone="brand" />
      </div>
      {lines.length === 0 && !orderLevel ? (
        <Text variant="caption" tone="tertiary" as="div">Chưa có đơn nào qua gian hàng — chia sẻ link để bắt đầu bán nhé.</Text>
      ) : (
        <>
          {lines.slice(0, 5).map((p) => (
            <StatLine key={p.productSlug || p.productName} name={p.productName} value={`${p.qty} món · ${formatVnd(p.revenue)}`} />
          ))}
          {rest.length > 0 && (
            <StatLine
              name={vi.storefront.statsOtherProducts(rest.length)}
              value={`${rest.reduce((t, p) => t + p.qty, 0)} món · ${formatVnd(rest.reduce((t, p) => t + p.revenue, 0))}`}
            />
          )}
          {orderLevel !== 0 && <StatLine name={vi.storefront.statsOrderLevel} value={formatVnd(orderLevel)} />}
        </>
      )}
    </Card>
  );
}

function StatLine({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
      <Text variant="body-sm" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Text>
      <Text variant="caption" tone="tertiary" style={{ whiteSpace: 'nowrap', marginLeft: 8 }}>{value}</Text>
    </div>
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
        aria-label={vi.storefront.headerNote}
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
    warehouseAddress: sf.warehouseAddress ?? '',
    warehouseCity: sf.warehouseCity ?? '',
    warehousePhone: sf.warehousePhone ?? '',
  });

  // Kho/hotline chỉ có nghĩa với gian hàng tự giao (D4); chuỗi rỗng = xoá (BE đổi '' thành null).
  const selfFulfils = isPartnerStore(sf);
  // Chỉ gửi subdomain khi người dùng đã đổi: API kiểm từ khoá và trùng tên mỗi khi nhận subdomain.
  const typedSubdomain = form.subdomain.trim().toLowerCase();
  const subdomainChanged = typedSubdomain !== '' && typedSubdomain !== (sf.subdomain ?? '');
  const saveMut = useMutation({
    mutationFn: () =>
      updateStorefront({
        title: form.title.trim() || undefined,
        subdomain: sf.subdomainEnabled && subdomainChanged ? form.subdomain.trim().toLowerCase() : undefined,
        themeColor: form.themeColor,
        ...(selfFulfils && {
          warehouseAddress: form.warehouseAddress.trim(),
          warehouseCity: form.warehouseCity.trim(),
          warehousePhone: form.warehousePhone.trim(),
        }),
      }),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Đã lưu cấu hình gian hàng!', type: 'success' });
      onSaved();
      onClose();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  // Tài khoản ngân hàng nhập trước đây không được dùng để thu tiền (khách luôn trả cho Tubu Tree) — chỉ cho gỡ đi.
  const clearBankMut = useMutation({
    mutationFn: () => updateStorefront({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' }),
    onSuccess: () => {
      openSnackbar({ text: 'Đã gỡ tài khoản ngân hàng khỏi gian hàng', type: 'success' });
      onSaved();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <div style={SCROLL_BODY}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Tên gian hàng">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>

        {sf.subdomainEnabled && (
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
        )}

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
          <Heading variant="title-sm" as="h3" style={{ marginBottom: 4 }}>Thanh toán</Heading>
          <Text variant="caption" tone="secondary" as="p" style={{ margin: 0 }}>
            Khách luôn thanh toán cho Tubu Tree.{' '}
            {selfFulfils
              ? 'Tiền hàng của bạn được đối soát và chuyển theo kỳ trên cổng người bán.'
              : 'Hoa hồng của bạn chuyển vào Ví Tubu ngay trong mục Cộng tác viên.'}
          </Text>
          {sf.bankAccountNo && (
            <div style={{ marginTop: 8 }}>
              <Text variant="caption" tone="secondary" as="p" style={{ margin: '0 0 6px' }}>
                Gian hàng đang lưu tài khoản {sf.bankName ?? 'ngân hàng'} ****{sf.bankAccountNo.slice(-4)} nhưng tài khoản này
                không được dùng để thu tiền.
              </Text>
              <Button
                variant="secondary"
                loading={clearBankMut.isPending}
                onPress={() => clearBankMut.mutate()}
              >
                Gỡ tài khoản đã lưu
              </Button>
            </div>
          )}
        </div>

        {selfFulfils && (
          <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
            <Heading variant="title-sm" as="h3" style={{ marginBottom: 4 }}>Kho gửi hàng & hotline</Heading>
            <Text variant="caption" tone="secondary" as="p" style={{ margin: '0 0 8px' }}>
              Dùng cho đơn gian hàng tự giao: khách thấy hotline này trong chi tiết đơn để liên hệ.
            </Text>
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
        )}

        <Button fullWidth style={{ marginTop: 12 }} loading={saveMut.isPending} onPress={() => saveMut.mutate()}>
          Lưu cấu hình gian hàng
        </Button>
      </div>
    </div>
  );
}
