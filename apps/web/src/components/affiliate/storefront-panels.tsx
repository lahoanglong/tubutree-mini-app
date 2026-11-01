'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, TrendingUp } from 'lucide-react';
import { BUILDER_COPY } from '@tubutree/app-core/commerce/storefront-builder';
import { claimQuest, type QuestList as QuestData } from '@tubutree/app-core/api/storefront';
import { storefrontQuestsQuery, storefrontStatsQuery } from '@tubutree/app-core/queries/storefront';
import { coreHttp } from '@/lib/core-http';
import { formatCount } from '@/lib/checkout-points';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { phoneFlatCard, phoneSectionTitle } from '@/lib/phone-ui';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { questPercent, statsRows } from './storefront-rules';
import { actErrText, type Notify } from './storefront-sheets';

function StatBox({ value, label, brand }: { value: string; label: string; brand?: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-control bg-stone-100 p-2.5 text-center max-md:bg-[var(--color-bg-subtle)]">
      <div className={`break-words text-base font-bold tabular-nums ${brand ? 'text-forest-700' : 'text-stone-900'}`}>{value}</div>
      <div className="text-xs text-stone-600">{label}</div>
    </div>
  );
}

/**
 * "Thống kê 30 ngày" ở đầu màn dựng khi gian hàng đã có khách thấy: ba ô số, bảng theo sản phẩm gập sau nút "Theo sản phẩm".
 * Chỉ gắn vào cây khi LIVE nên gian hàng nháp không gọi API thống kê.
 */
export function StatsSection() {
  const statsQ = useQuery(storefrontStatsQuery(coreHttp));
  const [open, setOpen] = useState(false);
  const data = statsQ.data;
  if (!data) return null;
  const rows = statsRows(data);

  return (
    <section aria-label={BUILDER_COPY.stats30} className={`${ui.card} ${phoneFlatCard} p-4`}>
      <div className="mb-2.5 flex items-center gap-1.5">
        <TrendingUp className="h-5 w-5 text-forest-700" aria-hidden="true" />
        <h2 className={`${ui.sectionTitle} ${phoneSectionTitle}`}>{BUILDER_COPY.stats30}</h2>
      </div>
      <div className="flex gap-2">
        <StatBox value={String(data.orders30d)} label="Đơn 30 ngày" />
        <StatBox value={formatVnd(data.revenue30d)} label="Doanh thu" />
        <StatBox value={formatVnd(data.commission30d)} label="Hoa hồng" brand />
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-stone-600">Chưa có đơn nào qua gian hàng — chia sẻ link để bắt đầu bán nhé.</p>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="mt-1 flex min-h-11 w-full items-center justify-between text-sm font-medium text-forest-700"
          >
            {BUILDER_COPY.statsByProduct}
            <ChevronDown className={`h-4 w-4 transition-transform duration-150 ease-out ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {open &&
            rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-2 border-t border-stone-200 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-stone-900">{r.name}</span>
                <span className="whitespace-nowrap text-xs text-stone-600">{r.value}</span>
              </div>
            ))}
        </>
      )}
    </section>
  );
}

/** Chuỗi nhiệm vụ early-win thưởng Điểm Xanh, nằm trong sheet mở từ dải Hành trình. Nút nhận là nút phụ: màn dựng chỉ có một nút chính (thanh dính). */
export function QuestList({ data, onNotice }: { data: QuestData; onNotice: Notify }) {
  const qc = useQueryClient();
  const claimMut = useMutation({
    mutationFn: (code: string) => claimQuest(coreHttp, code),
    onSuccess: (r) => {
      onNotice(`+${formatCount(r.rewardPoints)} điểm 🎉`);
      void qc.invalidateQueries({ queryKey: storefrontQuestsQuery(coreHttp).queryKey });
    },
    onError: (e) => onNotice(actErrText(e), true),
  });
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-medium text-forest-700">Đã nhận {formatCount(data.totalEarnedPoints)} điểm</p>
        <span className="text-xs text-stone-600">
          {data.level}/{data.levelMax}
        </span>
      </div>
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
              <button type="button" className={ui.btnSecondary} disabled={claimMut.isPending} onClick={() => claimMut.mutate(q.code)}>
                {claimMut.isPending && claimMut.variables === q.code ? 'Đang nhận…' : `Nhận ${formatCount(q.rewardPoints)} điểm`}
              </button>
            ) : (
              <span className="whitespace-nowrap text-xs text-stone-600">
                {q.progress}/{q.goal}
              </span>
            )}
          </div>
          <div className="mt-1.5">
            <ProgressBar value={questPercent(q)} max={100} ariaLabel={`${q.title}: tiến độ nhiệm vụ`} />
          </div>
        </div>
      ))}
    </div>
  );
}
