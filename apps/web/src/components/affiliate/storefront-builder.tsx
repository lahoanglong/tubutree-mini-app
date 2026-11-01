'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Eye, Pencil, Pin, Plus, Settings, Share2, Sparkles, Trash2, UserRoundCog } from 'lucide-react';
import {
  createCollection,
  deleteCollection,
  publishStorefront,
  removeItem,
  reorderCollections,
  reorderItems,
  updateCollection,
  updateItem,
  type PickerProduct,
  type StorefrontEdit,
} from '@tubutree/app-core/api/storefront';
import { STOREFRONT_REORDER_MUTATION, moveInList, withReorderedCollections, withReorderedItems, type MoveDirection } from '@tubutree/app-core/storefront-order';
import { STOREFRONT_REVIEW_PROMISE, storefrontPublishCopy, storefrontPublishedMessage, storefrontStatusView } from '@tubutree/app-core/storefront-signup';
import {
  BUILDER_COPY, comboPctOutcome, moveAnnouncement, moveBlockReason, moveBlockedAnnouncement, overflowSectionsNotice, questStripView,
  sectionCardView, sectionHref, sectionIdFromSearch, sectionStyleOf, type newSectionDto,
} from '@tubutree/app-core/commerce/storefront-builder';
import { pickerQuery, storefrontQuestsQuery } from '@tubutree/app-core/queries/storefront';
import { coreHttp } from '@/lib/core-http';
import { formatCount } from '@/lib/checkout-points';
import { ui } from '@/lib/guest-ui';
import { phoneBrandText, phoneCaption, phoneFlatCard, phoneSecondary, phoneSectionTitle } from '@/lib/phone-ui';
import { cssUrl } from '@/lib/safe-color';
import { shallowPush, shallowReplace } from '@/lib/shallow-url';
import { Badge } from '@/components/ui/badge';
import { Sheet } from '@/components/ui/sheet';
import { MoveButtons } from '@/components/mini/move-buttons';
import { QuestStrip } from '@/components/mini/quest-strip';
import { SectionCard } from '@/components/mini/section-card';
import { StorefrontNewSection } from './storefront-new-section';
import { StorefrontPreview } from './storefront-preview';
import { StorefrontSectionDetail } from './storefront-section-detail';
import { useSectionStyle } from './use-section-style';
import { ContentKitSheet, StorefrontShareSheet } from './storefront-share';
import { QuestList, StatsSection } from './storefront-panels';
import { storefrontHost } from './storefront-rules';
import { CollectionSheet, ConfigSheet, actErrText, PickerSheet, ProfileSheet, type Notify } from './storefront-sheets';

type Notice = { text: string; error: boolean } | null;

interface MenuAction {
  key: string;
  label: string;
  icon: typeof Pin;
  danger?: boolean;
  onPress: () => void;
}

/** Menu "⋯": mỗi thao tác là một hàng có chữ, thao tác không hoàn tác đứng cuối và có màu cảnh báo. */
function ActionMenu({ open, title, actions, onClose }: { open: boolean; title: string; actions: MenuAction[]; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-2">
        {actions.map(({ key, label, icon: Icon, danger, onPress }) => (
          <button
            key={key}
            type="button"
            className={danger ? 'inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0' : `${ui.btnSecondary} w-full`}
            onClick={() => {
              onClose();
              onPress();
            }}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

const samePinGroup = (a: { isPinned: boolean }, b: { isPinned: boolean }) => a.isPinned === b.isPinned;

/** Hộp xác nhận cho thao tác không hoàn tác: hai nút Huỷ / hành động, cùng kiểu với sheet của Mini App. */
function ConfirmSheet({
  open,
  title,
  description,
  actionLabel,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  actionLabel: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} description={description}>
      <div className="mt-1 flex gap-2">
        <button type="button" className={`${ui.btnSecondary} flex-1`} onClick={onClose}>
          Huỷ
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0 disabled:opacity-60"
          disabled={pending}
          onClick={onConfirm}
        >
          {actionLabel}
        </button>
      </div>
    </Sheet>
  );
}

/** `useLayoutEffect` chạy trước khi trình duyệt vẽ nhưng cảnh báo khi dựng ở máy chủ (không có gì để bố trí ở đó); máy chủ dùng `useEffect` (không chạy). */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Ô ở hàng tiêu đề của trang (`PageHeader.actions`) nhận "Xem trước" và nút chính từ lg; trang dựng ô, trình dựng gắn nút vào đó bằng portal. */
export const BUILDER_HEAD_SLOT = 'builder-head-actions';

export function StorefrontBuilder({ sf }: { sf: StorefrontEdit }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [notice, setNotice] = useState<Notice>(null);
  const notify: Notify = (text, error = false) => setNotice({ text, error });
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const [kitSlug, setKitSlug] = useState<string | null>(null);
  // Một bộ nút ở hai chỗ (thanh dính đáy `lg:hidden`, ô hàng tiêu đề `hidden lg:flex`): CSS chọn bản nhìn thấy theo khổ nên không có khung nào nút ở sai chỗ
  // (quyết định bằng JS media query từng làm nút tới trễ một khung và đẩy hàng tiêu đề ~14px). Cả hai bản đọc cùng `actions()` nên chung trạng thái "Đang gửi…".
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  // Chạy sau mỗi lần vẽ, trước khi trình duyệt vẽ: trang dựng lại hàng tiêu đề khi vào/ra chi tiết khối (ô mới là nút DOM khác), nên không giữ nút DOM cũ.
  useIsoLayoutEffect(() => {
    const el = document.getElementById(BUILDER_HEAD_SLOT);
    setHeadSlot((cur) => (cur === el ? cur : el));
  });
  const [configOpen, setConfigOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [questOpen, setQuestOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [itemMenuId, setItemMenuId] = useState<string | null>(null);
  const [colMenuId, setColMenuId] = useState<string | null>(null);
  // Trang chi tiết là một mục lịch sử của chính trang này (`?khoi=`), không phải route mới: nút lùi nổi (điện thoại) và nút lùi của trình duyệt
  // trả về danh sách khối. h1 của trang vẫn là "Gian hàng của tôi".
  const sectionId = sectionIdFromSearch(searchParams.toString());
  const [sectionSort, setSectionSort] = useState(false);
  const [itemSort, setItemSort] = useState(false);
  const view = storefrontStatusView(sf);
  const publishCopy = storefrontPublishCopy(sf);
  // Hành trình gian hàng thu thành một dải 56px; thưởng chờ nhận thì dải nói thẳng ra.
  const questsQ = useQuery(storefrontQuestsQuery(coreHttp));
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<string | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<string | null>(null);
  // Nhiệm vụ "Viết lý do cho 3 sản phẩm" đọc StorefrontItem.note nên builder phải có ô nhập lý do.
  const [noting, setNoting] = useState<{ id: string; note: string } | null>(null);

  const pickerQ = useQuery({ ...pickerQuery(coreHttp, ''), staleTime: 5 * 60_000 });
  const productMap = useMemo(() => {
    const map = new Map<string, PickerProduct>();
    (pickerQ.data ?? []).forEach((p) => map.set(p.id, p));
    return map;
  }, [pickerQ.data]);

  const refresh = () => {
    // Cập nhật cả tiến trình "Hành trình gian hàng" sau khi thêm sản phẩm / đăng (nhiệm vụ đọc từ cùng dữ liệu).
    void qc.invalidateQueries({ queryKey: storefrontQuestsQuery(coreHttp).queryKey });
    return qc.invalidateQueries({ queryKey: ['my-storefront'] });
  };
  const fail = (e: unknown) => notify(actErrText(e), true);

  // Vùng đọc riêng cho việc dời chỗ: câu vị trí mới không lẫn với thông báo thành công/lỗi. Xoá rồi ghi lại để cùng một câu hai lần liên tiếp vẫn được đọc.
  const [moveText, setMoveText] = useState('');
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(moveTimer.current), []);
  const announce = (text: string) => {
    clearTimeout(moveTimer.current);
    setMoveText('');
    moveTimer.current = setTimeout(() => setMoveText(text), 0);
  };

  const publishMut = useMutation({
    mutationFn: () => publishStorefront(coreHttp, true),
    onSuccess: (res) => {
      notify(storefrontPublishedMessage(res, sf));
      void refresh();
    },
    onError: fail,
  });
  const unpublishMut = useMutation({
    mutationFn: () => publishStorefront(coreHttp, false),
    onSuccess: () => {
      setConfirmUnpublish(false);
      notify('Đã gỡ đăng gian hàng');
      void refresh();
    },
    onError: (e) => {
      setConfirmUnpublish(false);
      fail(e);
    },
  });
  const newColMut = useMutation({
    mutationFn: (dto: ReturnType<typeof newSectionDto>) => createCollection(coreHttp, dto),
    onSuccess: (created, dto) => {
      // Khối mới hiện ngay trong trang chi tiết, không chờ lần tải lại.
      qc.setQueryData<StorefrontEdit | null>(['my-storefront'], (old) =>
        old && created?.id ? { ...old, collections: [...old.collections, { ...created, items: created.items ?? [] }] } : old,
      );
      setNewOpen(false);
      if (created?.id) {
        openSection(created.id);
        setPickerCol(created.id);
      }
      void refresh();
      // Máy chủ kẹp `%` theo trần cấu hình: thấp hơn số vừa nhập thì nói rõ, không để CTV tưởng đã được đúng số đó.
      if (dto.kind === 'COMBO' && typeof dto.comboDiscountPct === 'number') {
        const out = comboPctOutcome(dto.comboDiscountPct, created?.comboDiscountPct);
        if (out.clamped) notify(out.text, true);
      }
    },
    onError: fail,
  });
  const deleteColMut = useMutation({
    mutationFn: (id: string) => deleteCollection(coreHttp, id),
    onSuccess: (_d, id) => {
      setConfirmDeleteCol(null);
      if (id === sectionId) closeSection();
      void refresh();
    },
    onError: (e) => {
      setConfirmDeleteCol(null);
      fail(e);
    },
  });
  const patchCollection = (id: string, patch: Partial<{ layout: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct: number | null }>) =>
    qc.setQueryData<StorefrontEdit | null>(['my-storefront'], (old) => (old ? { ...old, collections: old.collections.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : old));
  // Chỉ gửi trường đổi (không kèm kind/title): API nhận từng phần, và Thường ↔ Combo chưa đổi được sau khi tạo.
  const layoutMut = useMutation({
    mutationFn: (v: { id: string; layout: 'GRID' | 'CAROUSEL' | 'STACK' }) => updateCollection(coreHttp, v.id, { layout: v.layout }),
    onSuccess: (data, v) => {
      patchCollection(v.id, { layout: data?.layout ?? v.layout });
      announce(BUILDER_COPY.layoutSaved);
      void refresh();
    },
    onError: fail,
    onSettled: (_d, _e, v) => sectionStyle.settled(v.id, v.layout),
  });
  const sectionStyle = useSectionStyle({
    send: (v) => layoutMut.mutate(v),
    currentOf: (id) => {
      const c = qc.getQueryData<StorefrontEdit | null>(['my-storefront'])?.collections.find((x) => x.id === id);
      return c ? sectionStyleOf(c) : null;
    },
  });
  const comboMut = useMutation({
    mutationFn: (v: { id: string; pct: number }) => updateCollection(coreHttp, v.id, { comboDiscountPct: v.pct }),
  });
  /** Máy chủ kẹp `%` theo trần `storefront.max_combo_pct`; màn đọc lại số đã lưu và nói rõ khi nó thấp hơn số vừa nhập. */
  const saveComboPct = async (id: string, pct: number): Promise<number | null> => {
    try {
      const data = await comboMut.mutateAsync({ id, pct });
      const out = comboPctOutcome(pct, data?.comboDiscountPct);
      patchCollection(id, { comboDiscountPct: out.saved });
      notify(out.text, out.clamped);
      void refresh();
      return out.saved;
    } catch (e) {
      fail(e);
      return null;
    }
  };
  const itemMut = useMutation({
    mutationFn: (v: { id: string; dto: { isPinned?: boolean; isHidden?: boolean } }) => updateItem(coreHttp, v.id, v.dto),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const noteMut = useMutation({
    mutationFn: (v: { id: string; note: string }) => updateItem(coreHttp, v.id, { note: v.note }),
    onSuccess: () => {
      setNoting(null);
      notify('Đã lưu lý do giới thiệu');
      void refresh();
    },
    onError: fail,
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
      fail(e);
      if (!hasOtherReorderPending()) void refresh();
    },
    // Còn lần đổi chỗ khác đang chờ thì để nó xong rồi mới tải lại, kẻo dữ liệu cũ đè lên thứ tự mới hơn đang hiện.
    onSuccess: () => {
      if (!hasOtherReorderPending()) void refresh();
    },
  };
  const moveColMut = useMutation({
    ...STOREFRONT_REORDER_MUTATION,
    mutationFn: (v: { ids: string[]; update: (old: StorefrontEdit) => StorefrontEdit }) => reorderCollections(coreHttp, v.ids),
    ...optimisticOrder,
    onMutate: (v) => optimisticOrder.onMutate(v.update),
  });
  const moveItemMut = useMutation({
    ...STOREFRONT_REORDER_MUTATION,
    mutationFn: (v: { collectionId: string; ids: string[]; update: (old: StorefrontEdit) => StorefrontEdit }) => reorderItems(coreHttp, v.collectionId, v.ids),
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
    announce(moveAnnouncement({ name: sf.collections.find((c) => c.id === id)?.title ?? '', dir, index: ids.indexOf(id), total: ids.length }));
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
    announce(moveAnnouncement({ name: nameOfItem(collectionId, itemId), dir, index: ids.indexOf(itemId), total: ids.length }));
    moveItemMut.mutate({ collectionId, ids, update: (old) => withReorderedItems(old, collectionId, ids) });
  };
  const blockedMove = <T extends { id: string }>(list: readonly T[], id: string, dir: MoveDirection, name: string, same?: (a: T, b: T) => boolean) => {
    const reason = moveBlockReason(list, id, dir, same);
    if (reason) announce(moveBlockedAnnouncement({ name, dir, reason }));
  };
  const delItemMut = useMutation({
    mutationFn: (id: string) => removeItem(coreHttp, id),
    onSuccess: () => {
      setConfirmDeleteItem(null);
      void refresh();
    },
    onError: (e) => {
      setConfirmDeleteItem(null);
      fail(e);
    },
  });

  // Mở/đóng trang chi tiết: vào tiêu đề khối khi mở; khi lùi lại thì về đúng thẻ vừa mở.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastOpened = useRef<string | null>(null);
  // Mục lịch sử của trang chi tiết có dấu `builderSection` trong history.state khi phía trước nó là danh sách khối: đóng bằng lùi một bước.
  // Dấu nằm ở state của mục (không ở biến trong bộ nhớ) nên F5 vẫn còn; Next giữ state tuỳ biến của mục qua F5 và lùi/tiến.
  const hasListBehind = () => (window.history.state as { builderSection?: boolean } | null)?.builderSection === true;
  const openSection = (id: string) => {
    lastOpened.current = id;
    setItemSort(false);
    if (sectionId !== null) {
      shallowReplace(sectionHref(pathname, id), hasListBehind() ? { builderSection: true } : {});
      return;
    }
    shallowPush(sectionHref(pathname, id), { builderSection: true });
  };
  function closeSection() {
    setItemSort(false);
    if (sectionId !== null && hasListBehind()) router.back();
    else shallowReplace(pathname);
  }

  // API từ chối đăng gian hàng chưa có sản phẩm; chặn ngay ở nút để CTV biết cần làm gì thay vì nhận lỗi.
  const itemCount = sf.collections.reduce((n, c) => n + c.items.length, 0);
  const editing = sf.collections.find((c) => c.id === editingCol) ?? null;
  const menuItem = sf.collections.flatMap((c) => c.items).find((i) => i.id === itemMenuId) ?? null;
  const menuCol = sf.collections.find((c) => c.id === colMenuId) ?? null;
  const sectionCol = sf.collections.find((c) => c.id === sectionId) ?? null;
  const inDetail = sectionCol !== null;
  useEffect(() => {
    if (inDetail) {
      headingRef.current?.focus();
      return;
    }
    const id = lastOpened.current;
    if (!id) return;
    lastOpened.current = null;
    Array.from(document.querySelectorAll<HTMLElement>('[data-section-id]'))
      .find((el) => el.dataset.sectionId === id)
      ?.querySelector('button')
      ?.focus();
  }, [inDetail]);

  // Mở thẳng bằng link `?khoi=` (chia sẻ, tab mới) thì phía trước chưa có mục danh sách: dựng sẵn để nút lùi nổi (`router.back()` khi có lịch sử
  // trong web, không thì lên trang cha) và "Gian hàng của tôi" cùng về danh sách. F5 còn dấu của mục nên không dựng lại.
  const seededList = useRef(false);
  useEffect(() => {
    if (seededList.current || !sectionCol) return;
    seededList.current = true;
    if (hasListBehind()) return;
    shallowReplace(pathname);
    shallowPush(sectionHref(pathname, sectionCol.id), { builderSection: true });
    // Một lần khi trang chi tiết đầu tiên xuất hiện; `hasListBehind` và `pathname` đọc ngay lúc đó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionCol?.id]);

  const pickedStyle = sectionCol && sectionStyle.picked?.id === sectionCol.id ? sectionStyle.picked.style : null;
  const overflow = overflowSectionsNotice(sf.collections);

  // "Xem trước" và nút chính (Chia sẻ / Đăng): một nguồn cho thanh dính đáy (`grow` = flex-1, hai nút bằng nhau) và hàng tiêu đề từ lg (bề rộng theo chữ).
  const actions = (grow: string) => (
    <>
      {view.canShare ? (
        <Link href={`/s/${sf.slug}`} className={`${ui.btnSecondary} ${phoneSecondary} ${grow}`}>
          Xem trước
        </Link>
      ) : (
        <button type="button" className={`${ui.btnSecondary} ${phoneSecondary} ${grow}`} onClick={() => setPreviewOpen(true)}>
          Xem trước
        </button>
      )}
      {view.canShare ? (
        <button type="button" className={`${ui.btnPrimary} min-w-0 ${grow} max-md:overflow-hidden max-md:whitespace-nowrap`} aria-label="Chia sẻ gian hàng" onClick={() => setShareOpen(true)}>
          <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Chia sẻ
        </button>
      ) : sf.isPublished ? (
        <button
          type="button"
          className={`${ui.btnPrimary} min-w-0 ${grow}`}
          disabled
          aria-label={view.code === 'PENDING_APPROVAL' ? 'Chia sẻ sau khi Tubu duyệt' : 'Chia sẻ gian hàng'}
        >
          {view.code === 'PENDING_APPROVAL' ? 'Chia sẻ sau' : 'Chia sẻ'}
        </button>
      ) : (
        <button type="button" className={`${ui.btnPrimary} ${grow}`} disabled={itemCount === 0 || publishMut.isPending} onClick={() => publishMut.mutate()}>
          {publishMut.isPending ? 'Đang gửi…' : publishCopy.button}
        </button>
      )}
    </>
  );

  return (
    <div className="pb-4">
      <div role="status" aria-live="polite">
        {notice && <p className={`mb-3 text-sm ${notice.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>{notice.text}</p>}
      </div>
      <div data-testid="move-status" role="status" aria-live="polite" className="sr-only">
        {moveText}
      </div>

      {sectionCol ? (
        <StorefrontSectionDetail
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
          onNote={(itemId) => setNoting({ id: itemId, note: sectionCol.items.find((i) => i.id === itemId)?.note ?? '' })}
        />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-x-6">
          <div className="lg:col-start-1">
            <div className={`${ui.card} ${phoneFlatCard} p-4`}>
              <div className="flex items-center gap-3">
                <div
                  aria-hidden="true"
                  data-testid="profile-cover"
                  className="h-14 w-14 shrink-0 rounded-control bg-forest-50 bg-cover bg-center max-md:bg-[linear-gradient(135deg,var(--sage-100),var(--forest-100))]"
                  style={sf.coverUrl ? { backgroundImage: cssUrl(sf.coverUrl) } : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="break-words font-display text-lg font-semibold text-stone-900">{sf.title}</h2>
                    {/* Không có nhãn này thì CTV không biết gian hàng đã đăng hay còn nháp: "Xem trước" ra trang lỗi mà không hiểu vì sao. */}
                    <Badge tone={view.tone} size="sm">
                      {view.label}
                    </Badge>
                  </div>
                  <div className={`break-words text-xs text-stone-600 ${phoneCaption}`}>{storefrontHost(sf)}</div>
                  {!sf.coverUrl && (
                    <button type="button" onClick={() => setProfileOpen(true)} className="tubu-hit-44 block text-left text-xs text-forest-700">
                      Thêm ảnh bìa
                    </button>
                  )}
                </div>
              </div>
              {view.code === 'LIVE' && <div className={`mt-2 text-xs text-stone-600 ${phoneCaption}`}>Gian hàng cập nhật sau vài phút khi bạn đổi nội dung.</div>}
              {(view.hint || sf.publicHiddenReason) && (
                <div data-testid="hidden-reason" role="status" className={`mt-2 rounded-control bg-warning-bg px-3 py-2 text-xs text-warning-fg ${phoneCaption}`}>
                  {view.code === 'PENDING_APPROVAL' ? view.hint : (sf.publicHiddenReason ?? view.hint)}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" className={`${ui.btnSecondary} ${phoneSecondary} flex-1`} onClick={() => setProfileOpen(true)}>
                  <UserRoundCog className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Sửa hồ sơ
                </button>
                <button type="button" className={`${ui.btnSecondary} ${phoneSecondary} flex-1`} onClick={() => setConfigOpen(true)}>
                  <Settings className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Cài đặt
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
            {view.code === 'LIVE' && <StatsSection />}
            {questsQ.data && <QuestStrip {...questStripView(questsQ.data, (n) => `${formatCount(n)} điểm`)} onOpen={() => setQuestOpen(true)} />}
          </div>

          <div className="mt-3 space-y-3 lg:col-start-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className={`${ui.sectionTitle} ${phoneSectionTitle}`}>{BUILDER_COPY.sections}</h2>
              {sf.collections.length > 1 && (
                <button type="button" className={`${ui.btnText} ${phoneBrandText}`} onClick={() => setSectionSort((v) => !v)}>
                  {sectionSort ? BUILDER_COPY.sortDone : BUILDER_COPY.sort}
                </button>
              )}
            </div>
            {sf.collections.length === 0 && <p className="text-sm text-stone-700">{BUILDER_COPY.empty}</p>}
            {sf.collections.map((col) =>
              sectionSort ? (
                <div key={col.id} data-testid="section-sort-row" className="flex min-h-14 items-center gap-1 rounded-card bg-stone-0 pl-3 shadow-card">
                  <div className="min-w-0 flex-1 truncate text-sm text-stone-900">{col.title}</div>
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
                <SectionCard key={col.id} view={sectionCardView(col, sf.collections)} onOpen={() => openSection(col.id)} />
              ),
            )}
            {overflow && <p className="text-xs text-stone-700">{overflow}</p>}
            <button type="button" className={`${ui.btnSecondary} ${phoneSecondary} w-full`} onClick={() => setNewOpen(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {BUILDER_COPY.addSection}
            </button>
          </div>
        </div>
      )}

      {!sectionCol && (
        <div data-testid="builder-bar" className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-stone-200 bg-stone-0 px-4 py-3 lg:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
          {!sf.isPublished && itemCount === 0 && <p className="mb-2 text-xs text-stone-700">Thêm ít nhất 1 sản phẩm để đăng gian hàng.</p>}
          <div className="mx-auto flex max-w-5xl gap-2">{actions('flex-1')}</div>
        </div>
      )}
      {!sectionCol && headSlot && createPortal(
        <>
          {!sf.isPublished && itemCount === 0 && <p className="text-xs text-stone-700">Thêm ít nhất 1 sản phẩm để đăng gian hàng.</p>}
          {actions('')}
        </>,
        headSlot,
      )}

      <StorefrontShareSheet open={shareOpen} onClose={() => setShareOpen(false)} slug={sf.slug} title={sf.title} referralCode={sf.referralCode ?? null} />
      <ContentKitSheet open={!!kitSlug} onClose={() => setKitSlug(null)} productSlug={kitSlug ?? ''} />
      <PickerSheet open={!!pickerCol} collectionId={pickerCol} onClose={() => setPickerCol(null)} onAdded={() => void refresh()} />
      <ProfileSheet open={profileOpen} sf={sf} onClose={() => setProfileOpen(false)} onSaved={(t) => { notify(t); void refresh(); }} />
      <ConfigSheet
        open={configOpen}
        sf={sf}
        onClose={() => setConfigOpen(false)}
        onSaved={(t) => { notify(t); void refresh(); }}
        unpublishLabel={sf.isPublished ? (view.code === 'PENDING_APPROVAL' ? 'Huỷ gửi duyệt' : 'Gỡ đăng gian hàng') : null}
        onUnpublish={() => { setConfigOpen(false); setConfirmUnpublish(true); }}
      />
      <ActionMenu
        open={!!menuItem}
        title={menuItem?.product?.name ?? 'Sản phẩm'}
        onClose={() => setItemMenuId(null)}
        actions={
          menuItem
            ? [
                { key: 'pin', label: menuItem.isPinned ? 'Bỏ ghim' : 'Ghim lên đầu', icon: Pin, onPress: () => itemMut.mutate({ id: menuItem.id, dto: { isPinned: !menuItem.isPinned } }) },
                { key: 'hide', label: menuItem.isHidden ? 'Hiện sản phẩm' : 'Ẩn sản phẩm', icon: menuItem.isHidden ? Eye : EyeOff, onPress: () => itemMut.mutate({ id: menuItem.id, dto: { isHidden: !menuItem.isHidden } }) },
                ...(menuItem.product?.slug ? [{ key: 'kit', label: 'Bài đăng mẫu', icon: Sparkles, onPress: () => setKitSlug(menuItem.product!.slug) }] : []),
                { key: 'remove', label: BUILDER_COPY.removeItem, icon: Trash2, danger: true, onPress: () => setConfirmDeleteItem(menuItem.id) },
              ]
            : []
        }
      />
      <ActionMenu
        open={!!menuCol}
        title={menuCol?.title ?? BUILDER_COPY.sections}
        onClose={() => setColMenuId(null)}
        actions={
          menuCol
            ? [
                { key: 'rename', label: BUILDER_COPY.renameSection, icon: Pencil, onPress: () => setEditingCol(menuCol.id) },
                { key: 'delete', label: BUILDER_COPY.deleteSection, icon: Trash2, danger: true, onPress: () => setConfirmDeleteCol(menuCol.id) },
              ]
            : []
        }
      />
      <CollectionSheet collection={editing} onClose={() => setEditingCol(null)} onSaved={(t) => { notify(t); void refresh(); }} />
      <StorefrontNewSection open={newOpen} onClose={() => setNewOpen(false)} pending={newColMut.isPending} onCreate={(dto) => newColMut.mutate(dto)} />

      <ConfirmSheet
        open={confirmUnpublish}
        title="Gỡ đăng gian hàng này?"
        description="Khách mở link gian hàng sẽ không thấy gì cho tới khi bạn đăng lại."
        actionLabel="Gỡ đăng"
        pending={unpublishMut.isPending}
        onClose={() => setConfirmUnpublish(false)}
        onConfirm={() => unpublishMut.mutate()}
      />
      <ConfirmSheet
        open={!!confirmDeleteCol}
        title={BUILDER_COPY.deleteSectionConfirm}
        actionLabel={BUILDER_COPY.deleteSection}
        pending={deleteColMut.isPending}
        onClose={() => setConfirmDeleteCol(null)}
        onConfirm={() => confirmDeleteCol && deleteColMut.mutate(confirmDeleteCol)}
      />
      <ConfirmSheet
        open={!!confirmDeleteItem}
        title="Xoá sản phẩm này khỏi gian hàng?"
        actionLabel="Xoá"
        pending={delItemMut.isPending}
        onClose={() => setConfirmDeleteItem(null)}
        onConfirm={() => confirmDeleteItem && delItemMut.mutate(confirmDeleteItem)}
      />

      <Sheet open={questOpen} onClose={() => setQuestOpen(false)} title={BUILDER_COPY.questOpen}>
        {questsQ.data && <QuestList data={questsQ.data} onNotice={notify} />}
      </Sheet>

      <Sheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Xem trước"
        description={view.code === 'DRAFT' ? publishCopy.previewHint : STOREFRONT_REVIEW_PROMISE}
      >
        <StorefrontPreview sf={sf} />
        <button type="button" className={`${ui.btnSecondary} mt-3 w-full`} onClick={() => setPreviewOpen(false)}>
          Đóng
        </button>
      </Sheet>

      <Sheet
        open={!!noting}
        onClose={() => setNoting(null)}
        title="Vì sao mình giới thiệu"
        description="Lời thật của bạn thuyết phục hơn mọi mô tả sản phẩm — khách thấy ngay dưới tên món."
      >
        {noting && (
          <div>
            <textarea
              className={`${ui.field} py-2`}
              rows={3}
              aria-label="Lý do giới thiệu"
              maxLength={200}
              placeholder="VD: Mình dùng 3 tháng, da đỡ khô hẳn."
              value={noting.note}
              onChange={(e) => setNoting({ ...noting, note: e.target.value })}
            />
            <div className="mt-1 text-xs text-stone-600">{noting.note.length}/200</div>
            <div className="mt-4 flex gap-2">
              <button type="button" className={`${ui.btnSecondary} flex-1`} onClick={() => setNoting(null)}>
                Huỷ
              </button>
              <button type="button" className={`${ui.btnPrimary} flex-1`} disabled={noteMut.isPending} onClick={() => noteMut.mutate({ id: noting.id, note: noting.note.trim() })}>
                Lưu
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
