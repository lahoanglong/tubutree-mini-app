'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createAdminSeason, deleteAdminSeason, listAdminSeasons, type AdminSeason } from '@/lib/admin-client';
import { formatDate } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { BTN_XS_DANGER, BTN_XS_PRIMARY, INPUT_CLASS, Field, LoadError } from './ui';

const STATUS_TEXT: Record<AdminSeason['status'], string> = { ACTIVE: 'Đang chạy', UPCOMING: 'Sắp tới', ENDED: 'Đã hết hạn' };

/** Ngày chọn trên ô date là ngày giờ VN: bắt đầu từ 00:00, kết thúc hết 23:59:59 ngày đó. */
export const seasonDayStart = (day: string) => new Date(`${day}T00:00:00+07:00`).toISOString();
export const seasonDayEnd = (day: string) => new Date(`${day}T23:59:59+07:00`).toISOString();

/** Mùa Vườn Xanh: khách chỉ thấy mùa đang chạy. Tạo mùa mới ở đây khi mùa cũ hết hạn. */
export function SeasonAdmin() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const seasonsQ = useQuery({ queryKey: ['admin-seasons'], queryFn: listAdminSeasons });
  const [f, setF] = useState({ name: '', theme: '', region: '', start: '', end: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = f.name.trim() !== '' && f.start !== '' && f.end !== '' && f.end >= f.start;
  const create = useMutation({
    mutationFn: () =>
      createAdminSeason({ name: f.name.trim(), theme: f.theme.trim() || null, region: f.region.trim() || null, startAt: seasonDayStart(f.start), endAt: seasonDayEnd(f.end) }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã tạo mùa.' });
      setF({ name: '', theme: '', region: '', start: '', end: '' });
      void qc.invalidateQueries({ queryKey: ['admin-seasons'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không tạo được mùa.' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAdminSeason(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-seasons'] }),
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không xoá được mùa.' }),
  });
  const running = seasonsQ.data?.some((s) => s.status === 'ACTIVE');

  return (
    <section aria-labelledby="seasons-h" className="space-y-3">
      <h2 id="seasons-h" className="font-display text-lg font-semibold text-stone-900">Mùa Vườn Xanh</h2>
      <p className="text-xs text-stone-600">
        Khách chỉ thấy mùa đang chạy trong khoảng ngày đã chọn. Hai mùa không được trùng ngày. Hết hạn thì tạo mùa mới ở dưới.
      </p>
      {seasonsQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {seasonsQ.isError && <LoadError onRetry={() => void seasonsQ.refetch()} retrying={seasonsQ.isFetching}>Không tải được danh sách mùa.</LoadError>}
      {seasonsQ.data && !running && <p className="text-sm text-warning-fg">Hiện không có mùa nào đang chạy, khách không thấy banner mùa.</p>}
      <ul className="space-y-2">
        {seasonsQ.data?.map((s) => (
          <li key={s.id} data-season={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-stone-900">{s.name}</div>
              <div className="text-xs text-stone-600">
                {formatDate(s.startAt)} – {formatDate(s.endAt)} · {STATUS_TEXT[s.status]}
                {[s.theme, s.region].filter(Boolean).length > 0 ? ` · ${[s.theme, s.region].filter(Boolean).join(' · ')}` : ''}
              </div>
            </div>
            {s.status === 'UPCOMING' && (
              <button type="button" className={BTN_XS_DANGER} disabled={remove.isPending} onClick={() => void confirm(`Xoá mùa "${s.name}"?`).then((ok) => ok && remove.mutate(s.id))}>
                Xoá
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="grid gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 sm:grid-cols-2">
        <Field label="Tên mùa">
          <input name="season-name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={INPUT_CLASS} />
        </Field>
        <Field label="Chủ đề (tuỳ chọn)">
          <input name="season-theme" maxLength={120} value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} className={INPUT_CLASS} />
        </Field>
        <Field label="Khu vực (tuỳ chọn)">
          <input name="season-region" maxLength={80} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} className={INPUT_CLASS} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Từ ngày">
            <input name="season-start" type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className={INPUT_CLASS} />
          </Field>
          <Field label="Đến hết ngày">
            <input name="season-end" type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className={INPUT_CLASS} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="button" className={BTN_XS_PRIMARY} disabled={!valid || create.isPending} onClick={() => { setMsg(null); create.mutate(); }}>
            {create.isPending ? 'Đang tạo…' : 'Tạo mùa'}
          </button>
          {f.start && f.end && f.end < f.start && <span className="text-xs text-warning-fg">Ngày kết thúc phải từ ngày bắt đầu trở đi.</span>}
          {msg && (
            <span role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>
      {dialog}
    </section>
  );
}
