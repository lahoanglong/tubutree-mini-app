'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { deleteAdminCampaign, getAdminCampaign, listAdminCampaigns, updateAdminCampaign, type AdminCampaignRow, type AdminCampaignStatus } from '@/lib/admin-campaigns-client';
import { formatVnRange } from '@/lib/admin-campaign-form';
import type { Tone } from '@/lib/recycling';
import { AUDIENCE_LABELS, CampaignForm, PLACEMENT_LABELS } from './campaign-form';
import { useConfirm } from './confirm-dialog';
import { BTN_LINK, BTN_LINK_DANGER, BTN_PRIMARY, BTN_SECONDARY, LoadError, ToneBadge, chipClass } from './ui';

type Filter = CampaignPlacement | '';
const FILTERS: { k: Filter; label: string }[] = [
  { k: '', label: 'Tất cả' },
  { k: 'HOME_TOP', label: PLACEMENT_LABELS.HOME_TOP },
  { k: 'OFFERS_TOP', label: PLACEMENT_LABELS.OFFERS_TOP },
];
const STATUS: Record<AdminCampaignStatus, { label: string; tone: Tone }> = {
  live: { label: 'Đang chạy', tone: 'success' },
  scheduled: { label: 'Sắp chạy', tone: 'info' },
  ended: { label: 'Đã kết thúc', tone: 'neutral' },
  off: { label: 'Đang tắt', tone: 'warning' },
};
const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function CampaignRow({ row, onEdit, onError }: { row: AdminCampaignRow; onEdit: () => void; onError: (id: string, text: string | null) => void }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-campaigns'] });
  const toggle = useMutation({
    mutationFn: () => updateAdminCampaign(row.id, { isActive: !row.isActive }),
    onSuccess: () => {
      onError(row.id, null);
      void refresh();
    },
    onError: (e) => onError(row.id, msg(e, 'Không đổi được trạng thái.')),
  });
  const del = useMutation({
    mutationFn: () => deleteAdminCampaign(row.id),
    onSuccess: () => {
      onError(row.id, null);
      void refresh();
    },
    onError: (e) => onError(row.id, msg(e, 'Không xoá được chiến dịch.')),
  });
  const askDelete = async () => {
    const ok = await confirm({
      title: 'Xoá chiến dịch',
      message: `Xoá "${row.title}"? Banner và trang chiến dịch biến mất với khách ngay, không hoàn tác được. Muốn giữ lại để dùng sau thì chỉ cần Tắt.`,
      confirmLabel: 'Xoá chiến dịch',
      cancelLabel: 'Giữ lại',
      tone: 'danger',
    });
    if (ok) del.mutate();
  };
  const st = STATUS[row.status];
  const meta = [PLACEMENT_LABELS[row.placement], AUDIENCE_LABELS[row.audience], `${row.productCount} sản phẩm`, `${row.couponCount} mã`].join(' · ');
  return (
    <div className="flex flex-wrap items-center gap-3">
      {row.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.image} alt="" className="h-10 w-24 shrink-0 rounded-control bg-stone-100 object-cover" />
      ) : (
        <span aria-hidden="true" className="h-10 w-24 shrink-0 rounded-control bg-stone-100" />
      )}
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2 font-medium text-stone-900">
          <span className="break-words">{row.title}</span>
          <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
        </div>
        <div className="break-words text-xs text-stone-600">{formatVnRange(row.startAt, row.endAt)}</div>
        <div className="break-words text-xs text-stone-500">{meta}</div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <button type="button" aria-label={`Sửa chiến dịch ${row.title}`} onClick={onEdit} className={BTN_SECONDARY}>
          Sửa
        </button>
        <button type="button" aria-label={`${row.isActive ? 'Tắt' : 'Bật'} chiến dịch ${row.title}`} disabled={toggle.isPending} onClick={() => toggle.mutate()} className={BTN_SECONDARY}>
          {row.isActive ? 'Tắt' : 'Bật'}
        </button>
        <button type="button" aria-label={`Xoá chiến dịch ${row.title}`} disabled={del.isPending} onClick={() => void askDelete()} className={BTN_LINK_DANGER}>
          Xoá
        </button>
      </div>
      {dialog}
    </div>
  );
}

function EditForm({ id, onDone, onCancel }: { id: string; onDone: () => void; onCancel: () => void }) {
  const q = useQuery({ queryKey: ['admin-campaign', id], queryFn: () => getAdminCampaign(id), gcTime: 0 });
  if (q.isError) {
    return (
      <div className="space-y-2">
        <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>
          Không tải được chiến dịch.
        </LoadError>
        <button type="button" onClick={onCancel} className={BTN_LINK}>
          Đóng
        </button>
      </div>
    );
  }
  if (!q.data) return <p className="text-sm text-stone-500">Đang tải chiến dịch…</p>;
  return <CampaignForm key={q.data.id} initial={q.data} onDone={onDone} onCancel={onCancel} />;
}

/**
 * Tab "Chiến dịch": banner đầu Trang chủ và Ưu đãi (kèm trang chiến dịch, sản phẩm và mã giảm giá gắn theo). Lọc theo vị trí, bật/tắt tại dòng, sửa, xoá sau khi xác nhận.
 * Mốc ngày giờ luôn là giờ Việt Nam.
 */
export function CampaignsTab() {
  const [filter, setFilter] = useState<Filter>('');
  const [form, setForm] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const q = useQuery({ queryKey: ['admin-campaigns', filter || 'all'], queryFn: () => listAdminCampaigns(filter || undefined) });
  const setError = (id: string, text: string | null) => setRowError(text ? { id, text } : null);
  const done = () => {
    setForm(null);
    setNotice('Đã lưu chiến dịch.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Lọc theo vị trí" className="flex flex-wrap gap-2">
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
            Tạo chiến dịch
          </button>
        )}
      </div>

      {notice && (
        <p role="status" className="text-sm text-success-fg">
          {notice}
        </p>
      )}
      {form?.mode === 'create' && <CampaignForm onDone={done} onCancel={() => setForm(null)} />}
      {form?.mode === 'edit' && <EditForm id={form.id} onDone={done} onCancel={() => setForm(null)} />}

      <div className="space-y-3">
        {q.isError && (
          <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>
            Không tải được danh sách chiến dịch.
          </LoadError>
        )}
        {q.data?.map((row) => (
          <div key={row.id} className="rounded-card border border-stone-200 bg-stone-0 p-3">
            <CampaignRow
              row={row}
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
        {q.data?.length === 0 && <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">Chưa có chiến dịch nào. Bấm “Tạo chiến dịch” để thêm banner đầu tiên.</p>}
      </div>
    </div>
  );
}
