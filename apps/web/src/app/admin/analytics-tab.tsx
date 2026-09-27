'use client';

import { useQuery } from '@tanstack/react-query';
import { getRetentionDaily } from '@/lib/admin-client';

export function AnalyticsTab() {
  const q = useQuery({ queryKey: ['admin-analytics-retention'], queryFn: () => getRetentionDaily(30) });

  if (q.isLoading) return <p className="text-sm text-neutral-500">Đang tải…</p>;
  if (q.isError) return <p className="text-sm text-red-600">Không tải được số liệu retention.</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Chưa có snapshot nào — cron tính lúc 3h sáng, quay lại sau.</p>;
  }
  const latest = rows[rows.length - 1]!;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Khách mới hôm qua" value={latest.newBuyers} />
        <StatCard label="Khách hoạt động hôm qua" value={latest.activeBuyers} />
        <StatCard label="Đơn hôm qua" value={latest.ordersCount} />
        <StatCard label="Đơn/khách/tháng (luỹ kế)" value={latest.ordersPerBuyerMtd.toFixed(2)} />
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-1">Ngày</th>
            <th>Khách mới</th>
            <th>Đơn</th>
            <th>DAU (proxy)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-t border-neutral-100">
              <td className="py-1">{new Date(r.date).toLocaleDateString('vi-VN')}</td>
              <td>{r.newBuyers}</td>
              <td>{r.ordersCount}</td>
              <td>{r.dauProxyRefreshToken}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
