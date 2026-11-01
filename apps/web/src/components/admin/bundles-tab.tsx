'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteAdminBundle, getAdminBundle, listAdminBundles, updateAdminBundle, type AdminBundle, type AdminBundleStatus } from '@/lib/admin-bundles-client';
import { formatVnRange } from '@/lib/admin-campaign-form';
import type { Tone } from '@/lib/recycling';
import { BundleForm, KIND_LABELS } from './bundle-form';
import { useConfirm } from './confirm-dialog';
import { BTN_LINK, BTN_PRIMARY, BTN_SECONDARY, BTN_LINK_DANGER, LoadError, ToneBadge, chipClass } from './ui';

type Filter = AdminBundleStatus | '';
const STATUS: Record<AdminBundleStatus, { label: string; tone: Tone }> = {
  live: { label: 'Đang chạy', tone: 'success' },
  scheduled: { label: 'Sắp chạy', tone: 'info' },
  ended: { label: 'Đã kết thúc', tone: 'neutral' },
  off: { label: 'Đang tắt', tone: 'warning' },
};
const FILTERS: { k: Filter; label: string }[] = [{ k: '', label: 'Tất cả' }, ...(Object.keys(STATUS) as AdminBundleStatus[]).map((k) => ({ k, label: STATUS[k].label }))];
const STAFF_LOCK = 'Bộ do quản trị viên tạo, nhờ quản trị viên chỉnh sửa.';
const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function summary(b: AdminBundle): string {
  const names = b.items.map((i) => i.productName).join(', ');
  return b.kind === 'ADDON'
    ? `${KIND_LABELS.ADDON} · khi mua ${b.anchorProductName ?? 'sản phẩm chính'} · ${names}`
    : `${KIND_LABELS.BUNDLE_PCT} · giảm ${b.pct ?? 0}% mỗi món · ${names}`;
}

function BundleRow({ row, locked, onEdit, onError }: { row: AdminBundle; locked: boolean; onEdit: () => void; onError: (id: string, text: string | null) => void }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-bundles'] });
  const toggle = useMutation({
    mutationFn: () => updateAdminBundle(row.id, { isActive: !row.isActive }),
    onSuccess: () => {
      onError(row.id, null);
      void refresh();
    },
    onError: (e) => onError(row.id, msg(e, 'Không đổi được trạng thái.')),
  });
  const del = useMutation({
    mutationFn: () => deleteAdminBundle(row.id),
    onSuccess: () => {
      onError(row.id, null);
      void refresh();
    },
    onError: (e) => onError(row.id, msg(e, 'Không xoá được bộ.')),
  });
  const askDelete = async () => {
    const ok = await confirm({
      title: 'Xoá bộ',
      message: `Xoá "${row.title}"? Combo/mua kèm biến mất với khách ngay, không hoàn tác được. Muốn giữ lại để dùng sau thì chỉ cần Tắt.`,
      confirmLabel: 'Xoá bộ',
      cancelLabel: 'Giữ lại',
      tone: 'danger',
    });
    if (ok) del.mutate();
  };
  const st = STATUS[row.status];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2 font-medium text-stone-900">
          <span className="break-words">{row.title}</span>
          <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
        </div>
        <div className="break-words text-xs text-stone-600">{formatVnRange(row.startAt, row.endAt)}</div>
        <div className="break-words text-xs text-stone-500">{summary(row)}</div>
        {locked && <div className="text-xs text-stone-500">{STAFF_LOCK}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <button type="button" aria-label={`Sửa bộ ${row.title}`} disabled={locked} onClick={onEdit} className={BTN_SECONDARY}>
          Sửa
        </button>
        <button type="button" aria-label={`${row.isActive ? 'Tắt' : 'Bật'} bộ ${row.title}`} disabled={locked || toggle.isPending} onClick={() => toggle.mutate()} className={BTN_SECONDARY}>
          {row.isActive ? 'Tắt' : 'Bật'}
        </button>
        <button type="button" aria-label={`Xoá bộ ${row.title}`} disabled={locked || del.isPending} onClick={() => void askDelete()} className={BTN_LINK_DANGER}>
          Xoá
        </button>
      </div>
      {dialog}
    </div>
  );
}

function EditForm({ id, onDone, onCancel }: { id: string; onDone: () => void; onCancel: () => void }) {
  const q = useQuery({ queryKey: ['admin-bundle', id], queryFn: () => getAdminBundle(id), gcTime: 0 });
  if (q.isError) {
    return (
      <div className="space-y-2">
        <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>
          Không tải được bộ.
        </LoadError>
        <button type="button" onClick={onCancel} className={BTN_LINK}>
          Đóng
        </button>
      </div>
    );
  }
  if (!q.data) return <p className="text-sm text-stone-500">Đang tải bộ…</p>;
  return <BundleForm key={q.data.id} initial={q.data} onDone={onDone} onCancel={onCancel} />;
}

/**
 * Tab "Combo và mua kèm": bộ giảm % (BUNDLE_PCT) và bộ giá mua kèm (ADDON) hiện ở trang sản phẩm và Trang chủ. Lọc theo trạng thái, bật/tắt tại dòng, sửa, xoá sau khi xác nhận.
 * Mốc ngày giờ luôn là giờ Việt Nam. Nhân viên chỉ sửa/xoá được bộ do nhân viên tạo (API từ chối còn lại): nút bị khoá kèm lời giải thích thay vì để bấm rồi mới báo lỗi.
 */
export function BundlesTab({ isAdmin }: { isAdmin: boolean }) {
  const [filter, setFilter] = useState<Filter>('');
  const [form, setForm] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const q = useQuery({ queryKey: ['admin-bundles', filter || 'all'], queryFn: () => listAdminBundles(filter || undefined) });
  const setError = (id: string, text: string | null) => setRowError(text ? { id, text } : null);
  const done = () => {
    setForm(null);
    setNotice('Đã lưu bộ.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.k || 'all'} type="button" aria-pressed={filter === f.k} onClick={() => setFilter(f.k)} className={chipClass(filter === f.k)}>
              {f.label}
            </button>
          ))}
        </div>
        {!form && (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setForm({ mode: 'create' });
            }}
            className={BTN_PRIMARY}
          >
            Tạo combo hoặc mua kèm
          </button>
        )}
      </div>

      {notice && (
        <p role="status" className="text-sm text-success-fg">
          {notice}
        </p>
      )}
      {form?.mode === 'create' && <BundleForm onDone={done} onCancel={() => setForm(null)} />}
      {form?.mode === 'edit' && <EditForm id={form.id} onDone={done} onCancel={() => setForm(null)} />}

      <div className="space-y-3">
        {q.isError && (
          <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>
            Không tải được danh sách bộ.
          </LoadError>
        )}
        {q.data?.map((row) => (
          <div key={row.id} className="rounded-card border border-stone-200 bg-stone-0 p-3">
            <BundleRow
              row={row}
              locked={!isAdmin && !row.createdByStaff}
              onEdit={() => {
                setNotice(null);
                setForm({ mode: 'edit', id: row.id });
              }}
              onError={setError}
            />
            {rowError?.id === row.id && (
              <p role="alert" className="mt-2 text-sm text-danger-fg">
                {rowError.text}
              </p>
            )}
          </div>
        ))}
        {q.data?.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">Chưa có combo hay mua kèm nào. Bấm “Tạo combo hoặc mua kèm” để thêm bộ đầu tiên.</p>
        )}
      </div>
    </div>
  );
}
