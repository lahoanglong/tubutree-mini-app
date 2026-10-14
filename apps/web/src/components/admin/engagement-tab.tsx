'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAdminMissions,
  listAdminRewardCatalog,
  updateAdminMission,
  type AdminMission,
  type AdminRewardCatalogItem,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { BTN_XS_PRIMARY, FIELD_XS, INPUT_CLASS, Notice } from './ui';

const REWARD_POINTS_MAX = 500;

/**
 * Nhiệm vụ Vườn Xanh và danh mục quà đổi Điểm Xanh. Cách tính tiến độ nhiệm vụ gắn với mã nhiệm vụ nên chỉ sửa được chữ
 * hiển thị và điểm thưởng; quà đổi điểm nằm trong mã nguồn nên chỉ xem, kèm số lượt khách đã đổi.
 */
export function EngagementTab() {
  const missionsQ = useQuery({ queryKey: ['admin-missions'], queryFn: listAdminMissions });
  const rewardsQ = useQuery({ queryKey: ['admin-reward-catalog'], queryFn: listAdminRewardCatalog });
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

      <section aria-labelledby="rewards-h" className="space-y-3">
        <h2 id="rewards-h" className="font-display text-lg font-semibold text-stone-900">Quà đổi Điểm Xanh</h2>
        <Notice tone="info">Danh mục quà đang cố định trong mã nguồn. Muốn thêm quà hoặc đổi giá điểm, báo đội kỹ thuật.</Notice>
        {rewardsQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
        {rewardsQ.isError && <p className="text-sm text-danger-fg">Không tải được danh mục quà.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {rewardsQ.data?.map((r) => <RewardRow key={r.id} item={r} />)}
        </ul>
      </section>
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
            className={`${FIELD_XS} w-full`}
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
      {!pointsOk && <p className="mt-1 text-xs text-warning-fg">Điểm thưởng từ 0 đến {REWARD_POINTS_MAX}, số nguyên.</p>}
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

function rewardValue(r: AdminRewardCatalogItem): string {
  const min = r.minOrder ? ` · đơn từ ${formatVnd(r.minOrder)}` : '';
  if (r.type === 'FREESHIP') return `Miễn phí vận chuyển${min}`;
  if (r.type === 'PERCENT') return `Giảm ${r.value}%${r.maxDiscount ? ` tối đa ${formatVnd(r.maxDiscount)}` : ''}${min}`;
  return `Giảm ${formatVnd(r.value)}${min}`;
}

function RewardRow({ item: r }: { item: AdminRewardCatalogItem }) {
  return (
    <li data-reward={r.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 font-medium text-stone-900">{r.title}</span>
        <span className="shrink-0 font-semibold text-forest-700">{r.pointsCost} điểm</span>
      </div>
      <div className="mt-1 text-xs text-stone-600">{rewardValue(r)}</div>
      <div className="mt-1 text-xs text-stone-500">
        {r.redeemedCount} lượt đổi · {r.redeemed30d} trong 30 ngày
      </div>
    </li>
  );
}
