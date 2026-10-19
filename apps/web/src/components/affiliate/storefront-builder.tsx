'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, ImagePlus, MessageSquarePlus, Pencil, Pin, Eye, Plus, Settings, Share2, Trash2, UserRoundCog } from 'lucide-react';
import {
  createCollection,
  deleteCollection,
  publishStorefront,
  removeItem,
  updateItem,
  type PickerProduct,
  type StorefrontEdit,
} from '@tubutree/app-core/api/storefront';
import { pickerQuery, storefrontQuestsQuery } from '@tubutree/app-core/queries/storefront';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { Badge } from '@/components/ui/badge';
import { Sheet } from '@/components/ui/sheet';
import { ContentKitSheet, StorefrontShareSheet } from './storefront-share';
import { QuestSection, StatsSection } from './storefront-panels';
import { KIND_LABEL, LAYOUT_LABEL, storefrontHost } from './storefront-rules';
import { CollectionSheet, ConfigSheet, errText, NewCollectionForm, PickerSheet, ProfileSheet, type Notify } from './storefront-sheets';

type Notice = { text: string; error: boolean } | null;

function IconButton({ icon: Icon, label, active, danger, onPress }: { icon: typeof Pin; label: string; active?: boolean; danger?: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-stone-100 ${danger ? 'text-danger-fg' : active ? 'text-forest-700' : 'text-stone-600'}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

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

export function StorefrontBuilder({ sf }: { sf: StorefrontEdit }) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<Notice>(null);
  const notify: Notify = (text, error = false) => setNotice({ text, error });
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const [kitSlug, setKitSlug] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
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
  const fail = (e: unknown) => notify(errText(e), true);

  const publishMut = useMutation({
    mutationFn: () => publishStorefront(coreHttp, true),
    onSuccess: () => {
      notify('Đã đăng gian hàng 🎉');
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
    mutationFn: (dto: Parameters<typeof createCollection>[1]) => createCollection(coreHttp, dto),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const deleteColMut = useMutation({
    mutationFn: (id: string) => deleteCollection(coreHttp, id),
    onSuccess: () => {
      setConfirmDeleteCol(null);
      void refresh();
    },
    onError: (e) => {
      setConfirmDeleteCol(null);
      fail(e);
    },
  });
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

  // API từ chối đăng gian hàng chưa có sản phẩm; chặn ngay ở nút để CTV biết cần làm gì thay vì nhận lỗi.
  const itemCount = sf.collections.reduce((n, c) => n + c.items.length, 0);
  const editing = sf.collections.find((c) => c.id === editingCol) ?? null;

  return (
    <div className="pb-4">
      <div role="status" aria-live="polite">
        {notice && <p className={`mb-3 text-sm ${notice.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>{notice.text}</p>}
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="space-y-3">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="font-display text-lg font-semibold text-stone-900">{sf.title}</h2>
              {/* Không có nhãn này thì CTV không biết gian hàng đã đăng hay còn nháp: "Xem trước" ra trang lỗi mà không hiểu vì sao. */}
              <Badge tone={sf.isPublished ? 'success' : 'neutral'} size="sm">
                {sf.isPublished ? 'Đang hiển thị' : 'Nháp — chưa đăng'}
              </Badge>
            </div>
            <div className="text-xs text-stone-600">{storefrontHost(sf)}</div>
            {sf.isPublished && <div className="text-xs text-stone-600">Trang web cập nhật sau vài phút khi bạn đổi nội dung.</div>}
            {sf.publicHiddenReason && (
              <div data-testid="hidden-reason" role="status" className="mt-2 rounded-control bg-warning-bg px-3 py-2 text-xs text-warning-fg">
                {sf.publicHiddenReason}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button type="button" className={`${ui.btnSecondary} flex-1`} onClick={() => setProfileOpen(true)}>
                <UserRoundCog className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Sửa hồ sơ
              </button>
              <button type="button" className={`${ui.btnSecondary} flex-1`} onClick={() => setConfigOpen(true)}>
                <Settings className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Cấu hình
              </button>
            </div>
            {sf.isPublished && (
              <button type="button" className={`${ui.btnSecondary} mt-2 w-full`} onClick={() => setConfirmUnpublish(true)}>
                <EyeOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Gỡ đăng
              </button>
            )}
          </div>

          {/* Hồ sơ gian hàng: đúng thứ khách nhìn thấy đầu tiên, và là điều kiện của nhiệm vụ "Hoàn thiện hồ sơ gian hàng". */}
          <button
            type="button"
            aria-label="Sửa hồ sơ gian hàng"
            onClick={() => setProfileOpen(true)}
            className="block w-full overflow-hidden rounded-card bg-stone-0 text-left shadow-card"
          >
            <div
              data-testid="profile-cover"
              className="flex h-24 items-center justify-center gap-1.5 bg-forest-50 bg-cover bg-center"
              style={sf.coverUrl ? { backgroundImage: `url(${sf.coverUrl})` } : undefined}
            >
              {!sf.coverUrl && (
                <>
                  <ImagePlus className="h-4 w-4 text-forest-700" aria-hidden="true" />
                  <span className="text-xs font-semibold text-forest-700">Thêm ảnh bìa</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2.5 p-3">
              <div
                className="-mt-7 h-12 w-12 shrink-0 rounded-full border-2 border-stone-0 bg-stone-200 bg-cover bg-center"
                style={sf.avatarUrl ? { backgroundImage: `url(${sf.avatarUrl})` } : undefined}
              />
              <div className={`min-w-0 flex-1 text-sm ${sf.headerNote ? 'text-stone-900' : 'text-stone-600'}`}>
                {sf.headerNote || 'Ảnh đại diện, ảnh bìa và lời nhắn là thứ khách nhìn thấy đầu tiên.'}
              </div>
              <Pencil className="h-4 w-4 text-stone-600" aria-hidden="true" />
            </div>
          </button>

          {sf.collections.map((col) => (
            <section key={col.id} aria-label={col.title} className={`${ui.card} p-4`}>
              <div className="mb-1 flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <h2 className={ui.sectionTitle}>{col.title}</h2>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {col.kind === 'COMBO' && (
                      <Badge tone="promo" size="sm">
                        {KIND_LABEL.COMBO}
                        {col.comboDiscountPct != null ? ` ${col.comboDiscountPct}%` : ''}
                      </Badge>
                    )}
                    <Badge tone="neutral" size="sm">
                      {LAYOUT_LABEL[col.layout] ?? LAYOUT_LABEL.GRID}
                    </Badge>
                  </div>
                </div>
                <IconButton icon={Pencil} label="Sửa bộ sưu tập" onPress={() => setEditingCol(col.id)} />
                <IconButton icon={Trash2} danger label="Xoá bộ sưu tập" onPress={() => setConfirmDeleteCol(col.id)} />
              </div>
              <div className="grid gap-x-6 md:grid-cols-2">
                {col.items.map((it) => {
                  const prod = it.product ?? productMap.get(it.productId);
                  const name = prod?.name ?? 'Sản phẩm';
                  const price = prod?.salePrice ?? prod?.basePrice ?? 0;
                  const slug = prod?.slug;
                  return (
                    <div key={it.id} className="border-b border-stone-200 py-1">
                      <div className="flex items-center">
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm text-stone-900 ${it.isHidden || it.hiddenReason ? 'opacity-60' : ''}`}>{name}</div>
                          <div className="text-sm font-semibold tabular-nums text-stone-900">{formatVnd(price)}</div>
                          {it.hiddenReason && (
                            <Badge tone="warning" size="sm" className="mt-0.5">
                              Khách không thấy: {it.hiddenReason}
                            </Badge>
                          )}
                        </div>
                        <IconButton
                          icon={Pin}
                          active={it.isPinned}
                          label={it.isPinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
                          onPress={() => itemMut.mutate({ id: it.id, dto: { isPinned: !it.isPinned } })}
                        />
                        <IconButton
                          icon={it.isHidden ? EyeOff : Eye}
                          active={!it.isHidden}
                          label={it.isHidden ? 'Hiện sản phẩm' : 'Ẩn sản phẩm'}
                          onPress={() => itemMut.mutate({ id: it.id, dto: { isHidden: !it.isHidden } })}
                        />
                        <IconButton icon={Trash2} danger label="Xoá khỏi bộ sưu tập" onPress={() => setConfirmDeleteItem(it.id)} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setNoting({ id: it.id, note: it.note ?? '' })}
                          className={`flex min-h-11 min-w-0 flex-1 items-center gap-1 text-left text-xs ${it.note ? 'italic text-stone-700' : 'text-forest-700'}`}
                        >
                          <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {it.note ? `“${it.note}”` : 'Thêm lý do giới thiệu'}
                        </button>
                        {slug && (
                          <button type="button" className={ui.btnText} onClick={() => setKitSlug(slug)}>
                            Nội dung
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button type="button" className={`${ui.btnSecondary} mt-2`} onClick={() => setPickerCol(col.id)}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Thêm sản phẩm
              </button>
            </section>
          ))}

          <NewCollectionForm pending={newColMut.isPending} onCreate={(dto, onSuccess) => newColMut.mutate(dto, { onSuccess })} />
        </div>

        <div className="mt-3 space-y-3 lg:mt-0">
          <StatsSection />
          <QuestSection onNotice={notify} />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-stone-200 bg-stone-0 px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
        {!sf.isPublished && itemCount === 0 && <p className="mb-2 text-xs text-stone-700">Thêm ít nhất 1 sản phẩm để đăng gian hàng.</p>}
        <div className="mx-auto flex max-w-5xl gap-2">
          {sf.isPublished ? (
            <Link href={`/s/${sf.slug}`} className={`${ui.btnSecondary} flex-1`}>
              Xem trước
            </Link>
          ) : (
            <button type="button" className={`${ui.btnSecondary} flex-1`} onClick={() => notify('Gian hàng đang là nháp — bấm "Lưu & Đăng" để khách xem được.', true)}>
              Xem trước
            </button>
          )}
          {sf.isPublished ? (
            <button type="button" className={`${ui.btnPrimary} flex-1`} onClick={() => setShareOpen(true)}>
              <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Chia sẻ gian hàng
            </button>
          ) : (
            <button type="button" className={`${ui.btnPrimary} flex-1`} disabled={itemCount === 0 || publishMut.isPending} onClick={() => publishMut.mutate()}>
              {publishMut.isPending ? 'Đang đăng…' : 'Lưu & Đăng'}
            </button>
          )}
        </div>
      </div>

      <StorefrontShareSheet open={shareOpen} onClose={() => setShareOpen(false)} slug={sf.slug} title={sf.title} referralCode={sf.referralCode ?? null} />
      <ContentKitSheet open={!!kitSlug} onClose={() => setKitSlug(null)} productSlug={kitSlug ?? ''} />
      <PickerSheet open={!!pickerCol} collectionId={pickerCol} onClose={() => setPickerCol(null)} onAdded={() => void refresh()} />
      <ProfileSheet open={profileOpen} sf={sf} onClose={() => setProfileOpen(false)} onSaved={(t) => { notify(t); void refresh(); }} />
      <ConfigSheet open={configOpen} sf={sf} onClose={() => setConfigOpen(false)} onSaved={(t) => { notify(t); void refresh(); }} />
      <CollectionSheet collection={editing} onClose={() => setEditingCol(null)} onSaved={(t) => { notify(t); void refresh(); }} />

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
        title="Xoá bộ sưu tập này?"
        actionLabel="Xoá bộ sưu tập"
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
