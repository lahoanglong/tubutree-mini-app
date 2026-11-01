import { useState, useMemo, useRef, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Input, Page, useSnackbar, useNavigate, useLocation } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Pin, Eye, EyeOff, Trash2, Settings, Pencil, UserRoundCog, Plus, Share2,
  type LucideIcon,
} from 'lucide-react';
import {
  getMyStorefront, publishStorefront,
  createCollection, updateCollection, deleteCollection, updateItem, removeItem, pickerProducts,
  reorderCollections, reorderItems, getQuests,
  type StorefrontEdit, type PickerProduct,
} from '../services/storefront-api';
import { STOREFRONT_REORDER_MUTATION, moveInList, withReorderedCollections, withReorderedItems, type MoveDirection } from '@tubutree/app-core/storefront-order';
import { STOREFRONT_REVIEW_PROMISE, shouldStartSignupWizard, storefrontPublishCopy,
  storefrontPublishedMessage, storefrontStatusView } from '@tubutree/app-core/storefront-signup';
import {
  BUILDER_COPY, comboPctOutcome, moveAnnouncement, moveBlockReason, moveBlockedAnnouncement, overflowSectionsNotice, questStripView,
  sectionCardView, sectionHref, sectionIdFromSearch, sectionStyleOf, type newSectionDto,
} from '@tubutree/app-core/commerce/storefront-builder';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { formatPoints } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { announce, useNotify } from '../hooks/use-notify';
import { Badge } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { MoveButtons } from '../components/ui/move-buttons';
import { QuestStrip } from '../components/ui/quest-strip';
import { SectionCard } from '../components/ui/section-card';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Heading, Text } from '../components/ui/text';
import { ContentKitSheet } from '../components/content-kit-sheet';
import { ShareSheet } from '../components/share-sheet';
import { PickerSheet } from '../components/storefront-pickers';
import { StorefrontPreview } from '../components/storefront-preview';
import { MerchantConfigSheet } from '../components/storefront-builder/config-sheet';
import { NewSectionSheet } from '../components/storefront-builder/new-section-sheet';
import { ProfileSheet } from '../components/storefront-builder/profile-sheet';
import { QuestList } from '../components/storefront-builder/quest-panel';
import { SectionDetail } from '../components/storefront-builder/section-detail';
import { useSectionStyle } from '../components/storefront-builder/use-section-style';
import { CARD_MARGIN, SCROLL_BODY } from '../components/storefront-builder/shared';
import { StatsSection } from '../components/storefront-builder/stats-panel';
import { StorefrontSignupFlow } from './storefront-signup';

const CONFIG_TITLE = 'Cài đặt gian hàng';

/** Mỗi nhánh render có đúng một h1 và cùng nền; trang chi tiết khối tự vẽ h1 (tên khối) nên không dùng PageHeader. */
function BuilderShell({ children, style, bare }: { children: ReactNode; style?: CSSProperties; bare?: boolean }) {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)', ...style }}>
      {!bare && <PageHeader title={vi.storefront.title} />}
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

interface MenuAction { key: string; label: string; icon: LucideIcon; danger?: boolean; onPress: () => void }

/** Menu "⋯": mỗi thao tác là một hàng có chữ, thao tác không hoàn tác đứng cuối và có màu cảnh báo. */
function ActionMenu({ open, title, actions, onClose }: { open: boolean; title: string; actions: MenuAction[]; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {actions.map((a) => (
          <Button
            key={a.key}
            fullWidth
            variant={a.danger ? 'danger' : 'secondary'}
            icon={a.icon}
            onPress={() => {
              onClose();
              a.onPress();
            }}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </BottomSheet>
  );
}

const samePinGroup = (a: { isPinned: boolean }, b: { isPinned: boolean }) => a.isPinned === b.isPinned;

function Builder({ sf }: { sf: StorefrontEdit }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { openSnackbar } = useSnackbar();
  const { notify } = useNotify();
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const [contentKitSlug, setContentKitSlug] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [questOpen, setQuestOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [itemMenuId, setItemMenuId] = useState<string | null>(null);
  const [colMenuId, setColMenuId] = useState<string | null>(null);
  // Trang chi tiết là một mục lịch sử của chính /storefront (`?khoi=`), không phải route mới: nút lùi nổi và nút lùi của máy trả về danh sách khối.
  const sectionId = sectionIdFromSearch(location.search);
  const [sectionSort, setSectionSort] = useState(false);
  const [itemSort, setItemSort] = useState(false);
  const view = storefrontStatusView(sf);
  const publishCopy = storefrontPublishCopy(sf);
  // Hành trình gian hàng thu thành một dải 56px; thưởng chờ nhận thì dải nói thẳng ra.
  const questsQ = useQuery({ queryKey: ['storefront-quests'], queryFn: getQuests });
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
  const menuItem = sf.collections.flatMap((c) => c.items).find((i) => i.id === itemMenuId) ?? null;
  const menuCol = sf.collections.find((c) => c.id === colMenuId) ?? null;
  const sectionCol = sf.collections.find((c) => c.id === sectionId) ?? null;
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<string | null>(null);

  const newColMut = useMutation({
    mutationFn: (dto: ReturnType<typeof newSectionDto>) => createCollection(dto),
    onSuccess: (created, dto) => {
      haptic('light');
      // Khối mới hiện ngay trong trang chi tiết, không chờ lần tải lại.
      qc.setQueryData<StorefrontEdit | null>(['my-storefront'], (old) => (old ? { ...old, collections: [...old.collections, { ...created, items: created.items ?? [] }] } : old));
      setNewOpen(false);
      openSection(created.id);
      setPickerCol(created.id);
      void refresh();
      // Máy chủ kẹp `%` theo trần cấu hình: thấp hơn số vừa nhập thì nói rõ, không để CTV tưởng đã được đúng số đó.
      if (dto.kind === 'COMBO' && typeof dto.comboDiscountPct === 'number') {
        const out = comboPctOutcome(dto.comboDiscountPct, created.comboDiscountPct);
        if (out.clamped) notify({ text: out.text, type: 'warning' });
      }
    },
    onError: (e) => notify({ text: getErrorMessage(e), type: 'error' }),
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
    onSuccess: (_d, id) => {
      setConfirmDeleteCol(null);
      if (id === sectionId) closeSection();
      void refresh();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  // Chỉ gửi trường đổi (không kèm kind/title): API nhận từng phần, và Thường ↔ Combo chưa đổi được sau khi tạo.
  const layoutMut = useMutation({
    mutationFn: (v: { id: string; layout: 'GRID' | 'CAROUSEL' | 'STACK' }) => updateCollection(v.id, { layout: v.layout }),
    onSuccess: (data, v) => {
      haptic('light');
      patchCollection(v.id, { layout: data?.layout ?? v.layout });
      announce('status', BUILDER_COPY.layoutSaved);
      void refresh();
    },
    onError: (e) => notify({ text: getErrorMessage(e), type: 'error' }),
    onSettled: (_d, _e, v) => sectionStyle.settled(v.id, v.layout),
  });
  const sectionStyle = useSectionStyle({
    send: (v) => layoutMut.mutate(v),
    isPending: () => layoutMut.isPending,
    currentOf: (id) => {
      const c = qc.getQueryData<StorefrontEdit | null>(['my-storefront'])?.collections.find((x) => x.id === id);
      return c ? sectionStyleOf(c) : null;
    },
  });
  const comboMut = useMutation({
    mutationFn: (v: { id: string; pct: number }) => updateCollection(v.id, { comboDiscountPct: v.pct }),
  });
  const patchCollection = (id: string, patch: Partial<{ layout: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct: number | null }>) =>
    qc.setQueryData<StorefrontEdit | null>(['my-storefront'], (old) => (old ? { ...old, collections: old.collections.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : old));
  /** Máy chủ kẹp `%` theo trần `storefront.max_combo_pct`; màn đọc lại số đã lưu và nói rõ khi nó thấp hơn số vừa nhập. */
  const saveComboPct = async (id: string, pct: number): Promise<number | null> => {
    try {
      const data = await comboMut.mutateAsync({ id, pct });
      const out = comboPctOutcome(pct, data?.comboDiscountPct);
      haptic('light');
      patchCollection(id, { comboDiscountPct: out.saved });
      notify({ text: out.text, type: out.clamped ? 'warning' : 'success' });
      void refresh();
      return out.saved;
    } catch (e) {
      notify({ text: getErrorMessage(e), type: 'error' });
      return null;
    }
  };
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
  // Trong onSuccess/onError, lần đang chạy vẫn được đếm.
  const hasOtherReorderPending = () => qc.isMutating({ mutationKey: STOREFRONT_REORDER_MUTATION.mutationKey }) > 1;
  // Cập nhật lạc quan: thứ tự mới hiện ngay, máy chủ từ chối thì trả về đúng thứ tự cũ.
  const optimisticOrder = {
    onMutate: async (update: (old: StorefrontEdit) => StorefrontEdit) => {
      await qc.cancelQueries({ queryKey: ['my-storefront'] });
      const previous = qc.getQueryData<StorefrontEdit | null>(['my-storefront']);
      qc.setQueryData<StorefrontEdit | null>(['my-storefront'], (old) => (old ? update(old) : old));
      return { previous };
    },
    // Mỗi lần lỗi chỉ trả về ảnh chụp lúc bấm (có thể đã là thứ tự lạc quan của lần trước), nên lần cuối phải tải lại từ máy chủ.
    onError: (e: unknown, _v: unknown, ctx: { previous: StorefrontEdit | null | undefined } | undefined) => {
      qc.setQueryData(['my-storefront'], ctx?.previous);
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      if (!hasOtherReorderPending()) void refresh();
    },
    // Còn lần đổi chỗ khác đang chờ thì để nó xong rồi mới tải lại, kẻo dữ liệu cũ đè lên thứ tự mới hơn đang hiện.
    onSuccess: () => {
      if (!hasOtherReorderPending()) void refresh();
    },
  };
  const moveColMut = useMutation({
    ...STOREFRONT_REORDER_MUTATION,
    mutationFn: (v: { ids: string[]; update: (old: StorefrontEdit) => StorefrontEdit }) => reorderCollections(v.ids),
    ...optimisticOrder,
    onMutate: (v) => optimisticOrder.onMutate(v.update),
  });
  const moveItemMut = useMutation({
    ...STOREFRONT_REORDER_MUTATION,
    mutationFn: (v: { collectionId: string; ids: string[]; update: (old: StorefrontEdit) => StorefrontEdit }) => reorderItems(v.collectionId, v.ids),
    ...optimisticOrder,
    onMutate: (v) => optimisticOrder.onMutate(v.update),
  });

  // Hàng đổi chỗ làm React gỡ-gắn nút nên trình duyệt đánh rơi focus; nhớ nút vừa bấm rồi trả focus sau khi danh sách vẽ lại.
  const pendingFocus = useRef<{ id: string; dir: MoveDirection } | null>(null);
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    const btn = Array.from(document.querySelectorAll<HTMLElement>('[data-move-id]')).find((b) => b.dataset.moveId === want.id && b.dataset.moveDir === want.dir);
    if (btn) {
      pendingFocus.current = null;
      btn.focus();
    }
  }, [sf.collections]);

  const moveCollection = (id: string, dir: MoveDirection) => {
    const next = moveInList(sf.collections, id, dir);
    if (!next) return;
    const ids = next.map((c) => c.id);
    pendingFocus.current = { id, dir };
    announce('status', moveAnnouncement({ name: sf.collections.find((c) => c.id === id)?.title ?? '', dir, index: ids.indexOf(id), total: ids.length }));
    moveColMut.mutate({ ids, update: (old) => withReorderedCollections(old, ids) });
  };
  const nameOfItem = (collectionId: string, itemId: string) => {
    const it = sf.collections.find((c) => c.id === collectionId)?.items.find((i) => i.id === itemId);
    return (it && (it.product ?? productMap.get(it.productId))?.name) || 'Sản phẩm';
  };
  const moveItem = (collectionId: string, itemId: string, dir: MoveDirection) => {
    const col = sf.collections.find((c) => c.id === collectionId);
    const next = col && moveInList(col.items, itemId, dir, samePinGroup);
    if (!next) return;
    const ids = next.map((i) => i.id);
    pendingFocus.current = { id: itemId, dir };
    announce('status', moveAnnouncement({ name: nameOfItem(collectionId, itemId), dir, index: ids.indexOf(itemId), total: ids.length }));
    moveItemMut.mutate({ collectionId, ids, update: (old) => withReorderedItems(old, collectionId, ids) });
  };
  const blockedMove = <T extends { id: string }>(list: readonly T[], id: string, dir: MoveDirection, name: string, same?: (a: T, b: T) => boolean) => {
    const reason = moveBlockReason(list, id, dir, same);
    if (reason) announce('status', moveBlockedAnnouncement({ name, dir, reason }));
  };
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const delItemMut = useMutation({
    mutationFn: removeItem,
    onSuccess: () => { setConfirmDeleteItemId(null); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  // Mở/đóng trang chi tiết: lên đầu trang và vào h1 khi mở; khi lùi lại thì về đúng thẻ vừa mở, đúng chỗ đang cuộn.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastOpened = useRef<string | null>(null);
  const savedScroll = useRef(0);
  const pageEl = () => document.querySelector<HTMLElement>('.zaui-page');
  const openSection = (id: string) => {
    savedScroll.current = pageEl()?.scrollTop ?? 0;
    lastOpened.current = id;
    setItemSort(false);
    // Mục lịch sử mới có đánh dấu để đóng lại bằng lùi một bước; không có `from` nên nút lùi nổi cũng chỉ lùi về đúng danh sách.
    navigate(sectionHref(location.pathname, id), { replace: sectionId !== null, state: { builderSection: true } });
  };
  function closeSection() {
    setItemSort(false);
    // Mở thẳng bằng link có ?khoi= (không có mục danh sách phía trước) thì thay mục hiện tại thay vì lùi ra khỏi màn dựng.
    if ((location.state as { builderSection?: boolean } | null)?.builderSection) navigate(-1);
    else navigate(location.pathname, { replace: true });
  }
  const inDetail = sectionCol !== null;
  useEffect(() => {
    if (inDetail) {
      pageEl()?.scrollTo?.({ top: 0 });
      headingRef.current?.focus({ preventScroll: true });
      return;
    }
    const id = lastOpened.current;
    if (!id) return;
    lastOpened.current = null;
    Array.from(document.querySelectorAll<HTMLElement>('[data-section-id]'))
      .find((el) => el.dataset.sectionId === id)
      ?.querySelector('button')
      ?.focus({ preventScroll: true });
    pageEl()?.scrollTo?.({ top: savedScroll.current });
  }, [inDetail]);

  const sheets = (
    <>
      <ActionMenu
        open={!!menuItem}
        title={menuItem?.product?.name ?? 'Sản phẩm'}
        onClose={() => setItemMenuId(null)}
        actions={
          menuItem
            ? [
                { key: 'pin', label: menuItem.isPinned ? vi.storefront.unpinItem : vi.storefront.pinItem, icon: Pin, onPress: () => itemMut.mutate({ id: menuItem.id, dto: { isPinned: !menuItem.isPinned } }) },
                { key: 'hide', label: menuItem.isHidden ? vi.storefront.showItem : vi.storefront.hideItem, icon: menuItem.isHidden ? Eye : EyeOff, onPress: () => itemMut.mutate({ id: menuItem.id, dto: { isHidden: !menuItem.isHidden } }) },
                { key: 'remove', label: BUILDER_COPY.removeItem, icon: Trash2, danger: true, onPress: () => setConfirmDeleteItemId(menuItem.id) },
              ]
            : []
        }
      />
      <ActionMenu
        open={!!menuCol}
        title={menuCol?.title ?? vi.storefront.title}
        onClose={() => setColMenuId(null)}
        actions={
          menuCol
            ? [
                { key: 'rename', label: BUILDER_COPY.renameSection, icon: Pencil, onPress: () => setRenaming({ id: menuCol.id, title: menuCol.title }) },
                { key: 'delete', label: BUILDER_COPY.deleteSection, icon: Trash2, danger: true, onPress: () => setConfirmDeleteCol(menuCol.id) },
              ]
            : []
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

      <BottomSheet open={questOpen} onClose={() => setQuestOpen(false)} title={BUILDER_COPY.questOpen}>
        {questsQ.data && <QuestList data={questsQ.data} />}
      </BottomSheet>

      <NewSectionSheet open={newOpen} onClose={() => setNewOpen(false)} pending={newColMut.isPending} onCreate={(dto) => newColMut.mutate(dto)} />

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

      <BottomSheet open={!!renaming} onClose={() => setRenaming(null)} title={BUILDER_COPY.renameSection}>
        {renaming && (
          <>
            <Input
              aria-label={BUILDER_COPY.renameSection}
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

      <BottomSheet open={!!confirmDeleteCol} onClose={() => setConfirmDeleteCol(null)} title={BUILDER_COPY.deleteSectionConfirm}>
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
            {BUILDER_COPY.deleteSection}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet open={configOpen} onClose={() => setConfigOpen(false)} title={CONFIG_TITLE}>
        <MerchantConfigSheet
          sf={sf}
          onSaved={() => void refresh()}
          onClose={() => setConfigOpen(false)}
          unpublishLabel={sf.isPublished ? (view.code === 'PENDING_APPROVAL' ? vi.storefront.withdrawSubmit : vi.storefront.unpublishStore) : null}
          onUnpublish={() => { setConfigOpen(false); setConfirmUnpublish(true); }}
        />
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
    </>
  );

  if (sectionCol) {
    const pickedStyle = sectionStyle.picked?.id === sectionCol.id ? sectionStyle.picked.style : null;
    return (
      <BuilderShell bare style={{ paddingBottom: 'calc(24px + var(--safe-bottom))' }}>
        <SectionDetail
          col={sectionCol}
          productMap={productMap}
          sortMode={itemSort}
          headingRef={headingRef}
          pickedStyle={pickedStyle}
          onBack={closeSection}
          onMenu={() => setColMenuId(sectionCol.id)}
          onStyle={(style) => {
            if (style !== 'COMBO') sectionStyle.choose(sectionCol.id, style);
          }}
          onComboPct={(pct) => saveComboPct(sectionCol.id, pct)}
          onAddItem={() => setPickerCol(sectionCol.id)}
          onToggleSort={() => setItemSort((v) => !v)}
          onMoveItem={(itemId, dir) => moveItem(sectionCol.id, itemId, dir)}
          onMoveBlocked={(itemId, dir) => blockedMove(sectionCol.items, itemId, dir, nameOfItem(sectionCol.id, itemId), samePinGroup)}
          onItemMenu={setItemMenuId}
          onNote={(itemId) => setNotingItem({ id: itemId, note: sectionCol.items.find((i) => i.id === itemId)?.note ?? '' })}
          onKit={setContentKitSlug}
        />
        {sheets}
      </BuilderShell>
    );
  }

  const overflow = overflowSectionsNotice(sf.collections);
  return (
    <BuilderShell style={{ paddingBottom: 'calc(100px + var(--safe-bottom))' }}>
      <div style={{ padding: '12px 16px 0' }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              aria-hidden="true"
              style={{
                width: 56, height: 56, flexShrink: 0, borderRadius: 'var(--radius-media)',
                background: sf.coverUrl
                  ? `center/cover no-repeat url(${sf.coverUrl})`
                  : 'linear-gradient(135deg, var(--color-bg-subtle), var(--color-action-secondary-bg-pressed))',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Heading variant="title-md" as="h2" style={{ overflowWrap: 'anywhere' }}>{sf.title}</Heading>
                {/* Nhãn theo trạng thái máy chủ tính: đã gửi duyệt chưa chắc khách đã thấy, nên không ghi "Đang hiển thị" khi còn chờ duyệt. */}
                <Badge tone={view.tone} size="sm">{view.label}</Badge>
              </div>
              <Text variant="caption" tone="tertiary" as="div" style={{ overflowWrap: 'anywhere' }}>
                {sf.subdomainEnabled && sf.subdomain ? `${sf.subdomain}.tubutree.com` : `/s/${sf.slug}`}
              </Text>
              {!sf.coverUrl && <Text variant="caption" tone="brand" as="div">{vi.storefront.addCover}</Text>}
            </div>
          </div>
          {view.code === 'LIVE' && (
            <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>{vi.storefront.webRefreshNote}</Text>
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
        </Card>
      </div>

      <div style={{ paddingTop: 12 }}>{view.code === 'LIVE' && <StatsSection />}</div>

      {questsQ.data && (
        <div style={CARD_MARGIN}>
          <QuestStrip {...questStripView(questsQ.data, formatPoints)} onOpen={() => setQuestOpen(true)} />
        </div>
      )}

      <div style={{ ...CARD_MARGIN, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Heading variant="title-sm" as="h2">{BUILDER_COPY.sections}</Heading>
        {sf.collections.length > 1 && (
          <Button variant="ghost" onPress={() => setSectionSort((v) => !v)}>{sectionSort ? BUILDER_COPY.sortDone : BUILDER_COPY.sort}</Button>
        )}
      </div>

      {sf.collections.length === 0 && (
        <Text variant="body-sm" tone="secondary" as="div" style={{ ...CARD_MARGIN }}>{BUILDER_COPY.empty}</Text>
      )}
      {sf.collections.map((col) =>
        sectionSort ? (
          <div
            key={col.id}
            data-testid="section-sort-row"
            style={{ ...CARD_MARGIN, minHeight: 56, display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 12, background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)' }}
          >
            <Text variant="body-sm" as="div" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.title}</Text>
            <MoveButtons
              id={col.id}
              name={col.title}
              scope="section"
              canUp={!!moveInList(sf.collections, col.id, 'up')}
              canDown={!!moveInList(sf.collections, col.id, 'down')}
              onMove={(dir) => moveCollection(col.id, dir)}
              onBlocked={(dir) => blockedMove(sf.collections, col.id, dir, col.title)}
            />
          </div>
        ) : (
          <div key={col.id} style={CARD_MARGIN}>
            <SectionCard view={sectionCardView(col, sf.collections)} onOpen={() => openSection(col.id)} />
          </div>
        ),
      )}

      {overflow && <Text variant="caption" tone="secondary" as="div" style={CARD_MARGIN}>{overflow}</Text>}

      <div style={CARD_MARGIN}>
        <Button fullWidth variant="secondary" icon={Plus} onPress={() => setNewOpen(true)}>{BUILDER_COPY.addSection}</Button>
      </div>

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
      {sheets}
    </BuilderShell>
  );
}
