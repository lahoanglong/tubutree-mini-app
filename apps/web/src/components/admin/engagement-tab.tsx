'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminMissions, updateAdminMission, type AdminMission } from '@/lib/admin-client';
import { BTN_XS_PRIMARY, INPUT_CLASS, Notice } from './ui';

const REWARD_POINTS_MAX = 500_000;

/** Nhiệm vụ Vườn Xanh. Cách tính tiến độ nhiệm vụ gắn với mã nhiệm vụ nên chỉ sửa được chữ hiển thị và điểm thưởng. */
export function EngagementTab() {
  const missionsQ = useQuery({ queryKey: ['admin-missions'], queryFn: listAdminMissions });
  return (
    <div className="space-y-6">
      <section aria-labelledby="missions-h" className="space-y-3">
        <h2 id="missions-h" className="font-display text-lg font-semibold text-stone-900">Nhiệm vụ Vườn Xanh</h2>
        <p className="text-xs text-stone-600">
          Khách nhận Điểm Xanh khi hoàn thành nhiệm vụ. Mục tiêu và cách đếm tiến độ cố định theo mã nhiệm vụ; sửa điểm thưởng chỉ
          áp dụng cho lượt nhận sau khi lưu.
        </p>
        {missionsQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
        {missionsQ.isError && <p className="text-sm text-danger-fg">Không tải được danh sách nhiệm vụ.</p>}
        {missionsQ.data?.length === 0 && <p className="text-sm text-stone-500">Chưa có nhiệm vụ nào.</p>}
        <div className="space-y-2">
          {missionsQ.data?.map((m) => <MissionRow key={m.id} item={m} />)}
        </div>
      </section>

      <Notice tone="info">Quà đổi Điểm Xanh nay quản lý ở tab Đổi rác, mục Quà.</Notice>
    </div>
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

  return (
    <div data-mission={item.code} className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="min-w-0 break-all font-mono font-medium text-stone-900">{item.code}</span>
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
          <span className="mb-1 block">Điểm thưởng</span>
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
        {msg && (
          <span role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
