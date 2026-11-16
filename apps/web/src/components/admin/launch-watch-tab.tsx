'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LaunchWatchSecondOrder, LaunchWatchWindow, LaunchWatchWindowDTO } from '@tubutree/shared-types';
import { getLaunchWatch } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { BTN_SECONDARY, ListSkeleton, LoadError, Notice, ScrollRegion, chipClass } from '@/components/admin/ui';
import {
  WINDOW_OPTIONS,
  fraudAlerts,
  formatCount,
  formatPct,
  formatUpdatedAt,
  funnelWithPct,
  metricLevel,
  ratioPct,
  type AlertLevel,
  type FraudAlert,
  type FraudMetric,
} from '@/components/admin/launch-watch-format';

const LEVEL_CLASS: Record<AlertLevel, string> = {
  ok: 'text-stone-900',
  amber: 'bg-warning-bg font-semibold text-warning-fg',
  red: 'bg-danger-bg font-semibold text-danger-fg',
};

export function LaunchWatchTab() {
  const [win, setWin] = useState<LaunchWatchWindow>('h72');
  const q = useQuery({ queryKey: ['admin-launch-watch'], queryFn: getLaunchWatch });
  const data = q.data;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="mr-auto font-display text-lg font-semibold text-stone-900">Theo dõi 72h sau launch</h2>
        <div role="group" aria-label="Khoảng thời gian" className="flex gap-1.5">
          {WINDOW_OPTIONS.map((o) => (
            <button key={o.key} type="button" aria-pressed={win === o.key} onClick={() => setWin(o.key)} className={chipClass(win === o.key)}>
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!q.isFetching) void q.refetch();
          }}
          aria-disabled={q.isFetching || undefined}
          aria-busy={q.isFetching || undefined}
          className={`${BTN_SECONDARY} aria-disabled:opacity-60`}
        >
          Làm mới
        </button>
        {data && <span className="text-xs text-stone-500">Cập nhật lúc {formatUpdatedAt(data.generatedAt)}</span>}
      </header>

      {q.isLoading ? (
        <ListSkeleton label="Đang tải số liệu theo dõi" rows={4} className="h-24" />
      ) : q.isError || !data ? (
        <LoadError message="Không tải được số liệu theo dõi." onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : (
        <>
          <FunnelBlock window={data.windows[win]} />
          <FraudBlock window={data.windows[win]} />
          <SecondOrderBlock secondOrder={data.secondOrder} />
        </>
      )}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-base font-semibold text-stone-900">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function FunnelBlock({ window: w }: { window: LaunchWatchWindowDTO }) {
  const rows = funnelWithPct(w.funnel.rows);
  const noData = rows.every((r) => r.total === 0) && w.funnel.confirmedRequests === 0;
  return (
    <Block title="Phễu Đổi rác" hint="Số khách khác nhau đi qua từng bước. Cột Tổng không bằng Web cộng Mini App vì một khách có thể dùng cả hai.">
      <ScrollRegion label="Phễu Đổi rác theo bước">
        <table className="w-full min-w-[460px] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-stone-500">
              <th scope="col" className="py-1 pr-2 font-medium">Bước</th>
              <th scope="col" className="px-2 text-right font-medium">Web</th>
              <th scope="col" className="px-2 text-right font-medium">Mini App</th>
              <th scope="col" className="px-2 text-right font-medium">Tổng</th>
              <th scope="col" className="pl-2 text-right font-medium">So với bước vào</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.step} className="border-t border-stone-200">
                <th scope="row" className="py-2 pr-2 text-left font-normal text-stone-900">{r.label}</th>
                <td className="px-2 text-right">{formatCount(r.web)}</td>
                <td className="px-2 text-right">{formatCount(r.miniapp)}</td>
                <td className="px-2 text-right font-medium">{formatCount(r.total)}</td>
                <td className="pl-2 text-right text-stone-700">{formatPct(r.pctOfEnter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {noData && <p className="mt-2 text-sm text-stone-500">Chưa có khách nào đi qua phễu trong khoảng thời gian này.</p>}
      <p className="mt-3 text-sm text-stone-900 tabular-nums">
        Kho đã nhận rác thật: <strong>{formatCount(w.funnel.confirmedRequests)}</strong> yêu cầu · <strong>{formatCount(w.funnel.confirmedUsers)}</strong> khách
      </p>
    </Block>
  );
}

function MetricRow({ label, value, level = 'ok', note }: { label: string; value: ReactNode; level?: AlertLevel; note?: string }) {
  return (
    <div className={`flex min-h-[44px] items-center justify-between gap-3 rounded-control px-2 py-1.5 sm:min-h-[36px] ${LEVEL_CLASS[level]}`} data-level={level}>
      <dt className="min-w-0 text-sm">
        {label}
        {note && <span className="block text-xs font-normal text-stone-500">{note}</span>}
      </dt>
      <dd className="shrink-0 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function FraudGroup({ title, alerts, metrics, children }: { title: string; alerts: readonly FraudAlert[]; metrics: readonly FraudMetric[]; children: ReactNode }) {
  const own = alerts.filter((a) => metrics.includes(a.metric));
  return (
    <div role="group" aria-label={title} className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <h4 className="text-sm font-semibold text-stone-900">{title}</h4>
      <dl className="mt-1 divide-y divide-stone-100">{children}</dl>
      {own.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {own.map((a) => (
            <Notice key={a.metric} tone={a.level === 'red' ? 'danger' : 'warning'} role={a.level === 'red' ? 'alert' : 'status'}>
              {a.message}
            </Notice>
          ))}
        </div>
      )}
    </div>
  );
}

function FraudBlock({ window: w }: { window: LaunchWatchWindowDTO }) {
  const { unverifiedPhone: u, zeroGift: g, freeShipRecycle: f } = w.fraud;
  const alerts = fraudAlerts(w.fraud);
  const level = (m: FraudMetric) => metricLevel(alerts, m);
  return (
    <Block title="Chống gian lận" hint="Chỉ có số tổng hợp, không có thông tin khách. Ô đỏ là vi phạm luật gắn quà cần xử lý ngay, ô vàng là bất thường cần xem.">
      <div className="grid gap-3 lg:grid-cols-3">
        <FraudGroup title="SĐT chưa xác thực" alerts={alerts} metrics={[]}>
          <MetricRow label="Yêu cầu từ SĐT chưa xác thực" value={`${formatCount(u.requests)} / ${formatCount(u.totalRequests)}`} />
          <MetricRow label="Tỉ lệ trên mọi yêu cầu" value={formatPct(ratioPct(u.requests, u.totalRequests))} />
          <MetricRow label="Số khách" value={formatCount(u.users)} />
          <MetricRow label="Điểm Xanh đã cộng (kho đã xác nhận)" value={formatCount(u.pointsAwarded)} />
        </FraudGroup>
        <FraudGroup title="Quà 0đ gắn đơn" alerts={alerts} metrics={['giftOrdersOverOne', 'giftOrdersBelowMin', 'giftMaxPerAccount']}>
          <MetricRow label="Chỉ đếm đơn tạo từ" note="Đơn trước luật W179 đi theo luật cũ" value={formatDateTime(g.countedSince)} />
          <MetricRow label="Quà đã gắn vào đơn" value={formatCount(g.attached)} />
          <MetricRow label="Số tài khoản" value={formatCount(g.accounts)} />
          <MetricRow label="Nhiều nhất một tài khoản" value={formatCount(g.maxPerAccount)} level={level('giftMaxPerAccount')} />
          <MetricRow label="Đơn mang hơn 1 quà" note="Kỳ vọng 0" value={formatCount(g.ordersOverOne)} level={level('giftOrdersOverOne')} />
          <MetricRow label="Đơn dưới mức tối thiểu" note="Kỳ vọng 0" value={formatCount(g.ordersBelowMin)} level={level('giftOrdersBelowMin')} />
        </FraudGroup>
        <FraudGroup title="Đơn miễn ship kèm rác" alerts={alerts} metrics={[]}>
          <MetricRow label="Đơn mua có thu rác" value={`${formatCount(f.orders)} / ${formatCount(f.totalOrders)}`} />
          <MetricRow label="Tỉ lệ trên mọi đơn" value={formatPct(f.shareOfOrdersPct)} />
          <MetricRow label="Số khách" value={formatCount(f.users)} />
          <MetricRow label="Đơn có rác kho đã xác nhận" value={formatCount(f.withConfirmedWaste)} />
        </FraudGroup>
      </div>
    </Block>
  );
}

function SecondOrderBlock({ secondOrder }: { secondOrder: LaunchWatchSecondOrder }) {
  const { matured, pending, windowDays } = secondOrder;
  const rate = ratioPct(matured.withSecond, matured.customers);
  return (
    <Block title={`Khách đặt đơn thứ 2 trong ${windowDays} ngày`} hint="Không đổi theo khoảng thời gian chọn ở trên.">
      <div className="grid grid-cols-2 gap-3">
        <div role="group" aria-label={`Nhóm đã đủ ${windowDays} ngày`} className="rounded-card border border-stone-200 bg-stone-0 p-3">
          <div className="text-xs text-stone-500">Đã đủ {windowDays} ngày</div>
          <div className="text-lg font-semibold tabular-nums">{formatPct(rate)}</div>
          <div className="text-xs text-stone-500 tabular-nums">
            {formatCount(matured.withSecond)} / {formatCount(matured.customers)} khách
          </div>
        </div>
        <div role="group" aria-label="Nhóm đang chạy" className="rounded-card border border-stone-200 bg-stone-0 p-3">
          <div className="text-xs text-stone-500">Đang chạy</div>
          <div className="text-lg font-semibold tabular-nums">
            {formatCount(pending.withSecond)} / {formatCount(pending.customers)}
          </div>
          <div className="text-xs text-stone-500">khách đã đặt đơn thứ 2, còn trong {windowDays} ngày</div>
        </div>
      </div>
      {matured.customers === 0 && <p className="mt-2 text-sm text-stone-500">Chưa có khách nào đủ {windowDays} ngày kể từ đơn đầu nên chưa tính được tỉ lệ.</p>}
    </Block>
  );
}
