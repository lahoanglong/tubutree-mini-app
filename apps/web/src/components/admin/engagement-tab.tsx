'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAdminMission,
  listAdminMissions,
  MISSION_KIND_OPTIONS,
  updateAdminMission,
  type AdminMission,
  type MissionKind,
} from '@/lib/admin-client';
import { useConfirm } from './confirm-dialog';
import { BTN_PRIMARY, BTN_XS_PRIMARY, BTN_XS_SECONDARY, INPUT_CLASS, Notice, LoadError, ToneBadge } from './ui';
import { SeasonAdmin } from './season-admin';

const REWARD_POINTS_MAX = 500_000;
const CHECKIN_NOTE = 'Nhiệm vụ điểm danh: nếu khách dùng vé giữ lửa hay hồi sinh chuỗi thì nhiệm vụ đếm lại từ ngày đó (khách chỉ thấy dòng này trên thẻ nhiệm vụ khi đã dùng vé giữ lửa hay hồi sinh sau ngày bắt đầu nhiệm vụ).';

/** Nhiệm vụ Vườn Xanh. Thêm nhiệm vụ mới trong các loại hệ thống biết chấm; nhiệm vụ có sẵn sửa chữ, điểm thưởng và tạm dừng được (mục tiêu giữ nguyên vì đổi sẽ lệch lượt đã nhận). */
export function EngagementTab() {
  const missionsQ = useQuery({ queryKey: ['admin-missions'], queryFn: listAdminMissions });
  return (
    <div className="space-y-6">
      <section aria-labelledby="missions-h" className="space-y-3">
        <h2 id="missions-h" className="font-display text-lg font-semibold text-stone-900">Nhiệm vụ Vườn Xanh</h2>
        <p className="text-xs text-stone-600">
          Khách nhận Điểm Xanh khi hoàn thành nhiệm vụ. Mục tiêu đặt một lần lúc thêm nhiệm vụ và không sửa lại được; sửa điểm
          thưởng chỉ áp dụng cho lượt nhận sau khi lưu. Nhiệm vụ tạm dừng sẽ ẩn với khách và không ai nhận thưởng được.
        </p>
        <NewMission />
        {missionsQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
        {missionsQ.isError && <LoadError onRetry={() => void missionsQ.refetch()} retrying={missionsQ.isFetching}>Không tải được danh sách nhiệm vụ.</LoadError>}
        {missionsQ.data?.length === 0 && <p className="text-sm text-stone-500">Chưa có nhiệm vụ nào.</p>}
        <div className="space-y-2">
          {missionsQ.data?.map((m) => <MissionRow key={m.id} item={m} />)}
        </div>
      </section>

      <SeasonAdmin />

      <Notice tone="info">Quà đổi Điểm Xanh nay quản lý ở tab Đổi rác, mục Quà.</Notice>
    </div>
  );
}

function NewMission() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const blank = { title: '', description: '', kind: 'ORDER_COUNT' as MissionKind, goal: '1', rewardPoints: '' };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const opt = MISSION_KIND_OPTIONS.find((o) => o.kind === f.kind)!;
  const goal = Number(f.goal);
  const points = Number(f.rewardPoints);
  const goalOk = f.goal.trim() !== '' && Number.isInteger(goal) && goal >= 1 && goal <= opt.goalMax;
  const pointsOk = f.rewardPoints.trim() !== '' && Number.isInteger(points) && points >= 0 && points <= REWARD_POINTS_MAX;
  const create = useMutation({
    mutationFn: () => createAdminMission({ title: f.title.trim(), description: f.description.trim(), kind: f.kind, goal, rewardPoints: points }),
    onSuccess: () => {
      setF(blank);
      setOpen(false);
      setErr(null);
      void qc.invalidateQueries({ queryKey: ['admin-missions'] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không thêm được nhiệm vụ.'),
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={BTN_XS_SECONDARY}>
        Thêm nhiệm vụ
      </button>
    );
  }
  return (
    <form
      aria-label="Thêm nhiệm vụ"
      className="space-y-2 rounded-card border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        const ok = await confirm({
          title: 'Thêm nhiệm vụ mới',
          message: `Chỉ tính việc khách làm từ lúc tạo, việc đã làm trước đó không được tính. Mỗi khách nhận tối đa ${new Intl.NumberFormat("vi-VN").format(points)} Điểm Xanh một lần cho nhiệm vụ này. ${f.kind === 'CHECKIN_STREAK' ? CHECKIN_NOTE + ' ' : ''}Thêm nhiệm vụ "${f.title.trim()}"?`,
          confirmLabel: 'Thêm nhiệm vụ',
        });
        if (ok) create.mutate();
      }}
    >
      {dialog}
      <h3 className="text-sm font-semibold text-stone-900">Nhiệm vụ mới</h3>
      <label className="block text-xs text-stone-600">
        <span className="mb-1 block">Khách cần làm gì</span>
        <select
          name="kind"
          value={f.kind}
          onChange={(e) => setF({ ...f, kind: e.target.value as MissionKind, goal: '1' })}
          className={`${INPUT_CLASS} min-h-[44px] sm:min-h-0`}
        >
          {MISSION_KIND_OPTIONS.map((o) => (
            <option key={o.kind} value={o.kind}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-stone-600">
          <span className="mb-1 block">Cần đạt ({opt.unit})</span>
          <input name="goal" inputMode="numeric" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} className={INPUT_CLASS} />
        </label>
        <label className="text-xs text-stone-600">
          <span className="mb-1 block">Điểm thưởng mỗi khách (phải nhập)</span>
          <input name="rewardPoints" inputMode="numeric" value={f.rewardPoints} onChange={(e) => setF({ ...f, rewardPoints: e.target.value })} className={INPUT_CLASS} />
        </label>
      </div>
      <label className="block text-xs text-stone-600">
        <span className="mb-1 block">Tiêu đề</span>
        <input name="title" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={INPUT_CLASS} />
      </label>
      <label className="block text-xs text-stone-600">
        <span className="mb-1 block">Mô tả</span>
        <textarea name="description" rows={2} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={INPUT_CLASS} />
      </label>
      <p className="text-xs text-stone-600">Chỉ tính việc khách làm từ lúc tạo nhiệm vụ.</p>
      {f.kind === 'CHECKIN_STREAK' && <p className="text-xs text-stone-600">{CHECKIN_NOTE}</p>}
      {!goalOk && <p className="text-xs text-warning-fg">Mục tiêu là số nguyên từ 1 đến {opt.goalMax}.</p>}
      {!pointsOk && <p className="text-xs text-warning-fg">Điểm thưởng từ 0 đến {REWARD_POINTS_MAX.toLocaleString('vi-VN')}, số nguyên.</p>}
      {err && <p role="alert" className="text-xs text-danger-fg">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!goalOk || !pointsOk || !f.title.trim() || create.isPending} className={BTN_PRIMARY}>
          {create.isPending ? 'Đang thêm…' : 'Thêm nhiệm vụ'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={BTN_XS_SECONDARY}>
          Đóng
        </button>
      </div>
    </form>
  );
}

function MissionRow({ item }: { item: AdminMission }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: item.title, description: item.description, rewardPoints: String(item.rewardPoints) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const points = Number(f.rewardPoints);
  const pointsOk = f.rewardPoints.trim() !== '' && Number.isInteger(points) && points >= 0 && points <= REWARD_POINTS_MAX;
  const dirty = f.title.trim() !== item.title || f.description.trim() !== item.description || points !== item.rewardPoints;
  const save = useMutation({
    mutationFn: () => updateAdminMission(item.id, { title: f.title.trim(), description: f.description.trim(), rewardPoints: points }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã lưu.' });
      void qc.invalidateQueries({ queryKey: ['admin-missions'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không lưu được nhiệm vụ.' }),
  });

  const toggle = useMutation({
    mutationFn: () => updateAdminMission(item.id, { disabled: !item.disabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-missions'] }),
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không đổi được trạng thái.' }),
  });

  return (
    <div data-mission={item.code} className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="min-w-0 break-words font-medium text-stone-900">
          {MISSION_KIND_OPTIONS.find((o) => o.kind === item.kind)?.label ?? item.code}
          {item.disabled && (
            <>
              {' '}
              <ToneBadge tone="warning">Đang tạm dừng</ToneBadge>
            </>
          )}
        </span>
        <span className="text-stone-500">
          Mục tiêu {item.goal}
          {item.isRepeatable ? ' · lặp lại' : ''} · {item.claimedCount} lượt đã nhận
        </span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_8rem]">
        <label className="text-xs text-stone-600">
          <span className="mb-1 block">Tiêu đề</span>
          <input name="title" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={INPUT_CLASS} />
        </label>
        <label className="text-xs text-stone-600">
          <span className="mb-1 block">Điểm thưởng mỗi khách (phải nhập)</span>
          <input
            name="rewardPoints"
            inputMode="numeric"
            value={f.rewardPoints}
            onChange={(e) => setF({ ...f, rewardPoints: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      <label className="mt-2 block text-xs text-stone-600">
        <span className="mb-1 block">Mô tả</span>
        <textarea
          name="description"
          rows={2}
          maxLength={300}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      {!pointsOk && <p className="mt-1 text-xs text-warning-fg">Điểm thưởng từ 0 đến {REWARD_POINTS_MAX.toLocaleString('vi-VN')}, số nguyên.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            save.mutate();
          }}
          disabled={!dirty || !pointsOk || !f.title.trim() || save.isPending}
          className={BTN_XS_PRIMARY}
        >
          {save.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending} className={BTN_XS_SECONDARY}>
          {item.disabled ? 'Bật lại' : 'Tạm dừng'}
        </button>
        {msg && (
          <span role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
