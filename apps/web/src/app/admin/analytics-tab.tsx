'use client';

import { useQuery } from '@tanstack/react-query';
import { getRetentionDaily } from '@/lib/admin-client';
import { Ns1Card } from '@/components/admin/ns1-card';
import { ScrollRegion } from '@/components/admin/ui';
import { formatDate } from '@/lib/format-date';

export function AnalyticsTab() {
  const q = useQuery({ queryKey: ['admin-analytics-retention'], queryFn: () => getRetentionDaily(30) });

  if (q.isLoading) return <p className="text-sm text-stone-500">Đang tải…</p>;
  if (q.isError) return <p className="text-sm text-danger-fg">Không tải được số liệu retention.</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">Chưa có snapshot nào — cron tính lúc 3h sáng, quay lại sau.</p>;
  }
  const latest = rows[rows.length - 1]!;

  return (
    <div>
      <Ns1Card rows={rows} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Khách mới hôm qua" value={latest.newBuyers} />
        <StatCard label="Khách hoạt động hôm qua" value={latest.activeBuyers} />
        <StatCard label="Đơn hôm qua" value={latest.ordersCount} />
        <StatCard label="Đơn/khách/tháng (luỹ kế)" value={latest.ordersPerBuyerMtd.toFixed(2)} />
      </div>
      <ScrollRegion label="Số liệu retention 30 ngày" className="mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-1">Ngày</th>
              <th>Khách mới</th>
              <th>Đơn</th>
              <th>DAU (proxy)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-t border-stone-200">
                <td className="py-1">{formatDate(r.date)}</td>
                <td>{r.newBuyers}</td>
                <td>{r.ordersCount}</td>
                <td>{r.dauProxyRefreshToken}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div role="group" aria-label={label} className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
