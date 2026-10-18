'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Target, TrendingUp } from 'lucide-react';
import { claimQuest } from '@tubutree/app-core/api/storefront';
import { storefrontQuestsQuery, storefrontStatsQuery } from '@tubutree/app-core/queries/storefront';
import { coreHttp } from '@/lib/core-http';
import { formatCount } from '@/lib/checkout-points';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { questPercent, statsRows } from './storefront-rules';
import { errText, type Notify } from './storefront-sheets';

function StatBox({ value, label, brand }: { value: string; label: string; brand?: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-control bg-stone-100 p-2.5 text-center">
      <div className={`break-words text-base font-bold tabular-nums ${brand ? 'text-forest-700' : 'text-stone-900'}`}>{value}</div>
      <div className="text-xs text-stone-600">{label}</div>
    </div>
  );
}

/** "Thống kê 30 ngày": sản phẩm nào trong gian hàng đang bán chạy, để CTV biết mà tối ưu. */
export function StatsSection() {
  const statsQ = useQuery(storefrontStatsQuery(coreHttp));
  const data = statsQ.data;
  if (!data) return null;
  const rows = statsRows(data);

  return (
    <section aria-label="Thống kê 30 ngày" className={`${ui.card} p-4`}>
      <div className="mb-2.5 flex items-center gap-1.5">
        <TrendingUp className="h-5 w-5 text-forest-700" aria-hidden="true" />
        <h2 className={ui.sectionTitle}>Thống kê 30 ngày</h2>
      </div>
      <div className="mb-3 flex gap-2">
        <StatBox value={String(data.orders30d)} label={`Đơn (7 ngày: ${data.orders7d})`} />
        <StatBox value={formatVnd(data.revenue30d)} label="Doanh thu" />
        <StatBox value={formatVnd(data.commission30d)} label="Hoa hồng" brand />
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-stone-600">Chưa có đơn nào qua gian hàng — chia sẻ link để bắt đầu bán nhé.</p>
      ) : (
        rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2 border-t border-stone-200 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-stone-900">{r.name}</span>
            <span className="whitespace-nowrap text-xs text-stone-600">{r.value}</span>
          </div>
        ))
      )}
    </section>
  );
}

/** "Hành trình gian hàng": chuỗi nhiệm vụ early-win thưởng Điểm Xanh; nhận thưởng từng nhiệm vụ đã đạt. */
export function QuestSection({ onNotice }: { onNotice: Notify }) {
  const qc = useQueryClient();
  const questsQ = useQuery(storefrontQuestsQuery(coreHttp));
  const claimMut = useMutation({
    mutationFn: (code: string) => claimQuest(coreHttp, code),
    onSuccess: (r) => {
      onNotice(`+${formatCount(r.rewardPoints)} điểm 🎉`);
      void qc.invalidateQueries({ queryKey: storefrontQuestsQuery(coreHttp).queryKey });
    },
    onError: (e) => onNotice(errText(e), true),
  });
  const data = questsQ.data;
  if (!data) return null;

  return (
    <section aria-label="Hành trình gian hàng" className={`${ui.card} p-4`}>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Target className="h-5 w-5 text-forest-700" aria-hidden="true" />
          <h2 className={ui.sectionTitle}>Hành trình gian hàng</h2>
        </div>
        <span className="text-xs text-stone-600">
          {data.level}/{data.levelMax}
        </span>
      </div>
      <p className="mb-2.5 text-xs font-medium text-forest-700">Đã nhận {formatCount(data.totalEarnedPoints)} điểm</p>
      {data.quests.map((q) => (
        <div key={q.code} className="border-t border-stone-200 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className={`min-w-0 flex-1 ${q.claimed ? 'opacity-70' : ''}`}>
              <div className="flex items-center gap-1 text-sm text-stone-900">
                {q.claimed && <Check className="h-4 w-4 text-forest-700" aria-hidden="true" />}
                {q.title}
              </div>
              <div className="text-xs text-stone-600">{q.hint}</div>
            </div>
            {q.claimed ? (
              <Badge tone="success" size="sm">
                Đã nhận
              </Badge>
            ) : q.done ? (
              <button
                type="button"
                className={ui.btnPrimary}
                disabled={claimMut.isPending}
                onClick={() => claimMut.mutate(q.code)}
              >
                {claimMut.isPending && claimMut.variables === q.code ? 'Đang nhận…' : `+${formatCount(q.rewardPoints)} điểm`}
              </button>
            ) : (
              <span className="whitespace-nowrap text-xs text-stone-600">
                {q.progress}/{q.goal}
              </span>
            )}
          </div>
          <div className="mt-1.5">
            <ProgressBar value={questPercent(q)} max={100} />
          </div>
        </div>
      ))}
    </section>
  );
}
