'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminWastePointDTO } from '@tubutree/shared-types';
import { getWasteOverview, listWasteItems, listWastePoints, updateWastePoint } from '@/lib/admin-client';
import { formatCount } from '@/lib/checkout-points';
import { summarizeOpeningHours, WASTE_POINT_KIND_LABELS, WASTE_POINT_STATUS_LABELS } from '@/lib/waste-labels';
import { BTN_PRIMARY, BTN_XS_SECONDARY, chipClass, Notice, ScrollRegion, ToneBadge } from './ui';
import type { WasteSeed } from './waste-tab';
import { WastePointDetail } from './waste-point-detail';
import { WastePointForm } from './waste-point-form';

type Filter = 'all' | 'pending' | 'perk';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ duyệt' },
  { key: 'perk', label: 'Ưu đãi chờ duyệt' },
];
const TH = 'px-2 py-2 text-left text-xs font-medium text-stone-600';
const TD = 'px-2 py-2 align-top text-sm text-stone-800';

const initialFilter = (seed?: WasteSeed | null): Filter =>
  seed?.section === 'points' && seed.preset === 'pending' ? 'pending' : seed?.section === 'points' && seed.preset === 'perk' ? 'perk' : 'all';

export function WastePointsSection({ seed }: { seed?: WasteSeed | null }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>(() => initialFilter(seed));
  const [panel, setPanel] = useState<{ point: AdminWastePointDTO | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const all = useQuery({ queryKey: ['admin-waste-points', 'all'], queryFn: () => listWastePoints() });
  const filtered = useQuery({
    queryKey: ['admin-waste-points', filter === 'all' ? 'unfiltered-off' : filter],
    queryFn: () => (filter === 'pending' ? listWastePoints({ status: 'PENDING' }) : listWastePoints({ perkPending: true })),
    enabled: filter !== 'all',
  });
  const items = useQuery({ queryKey: ['admin-waste-items'], queryFn: listWasteItems });
  const overview = useQuery({ queryKey: ['admin-waste-overview'], queryFn: getWasteOverview });

  const list = filter === 'all' ? all : filtered;
  const rows = list.data ?? [];
  const warehouseExists = (all.data ?? []).some((p) => p.kind === 'WAREHOUSE');
  const alerts = overview.data?.alerts ?? [];
  const detailPoint = detailId ? ((all.data ?? []).find((p) => p.id === detailId) ?? rows.find((p) => p.id === detailId) ?? null) : null;

  const itemName = new Map((items.data ?? []).map((i) => [i.id, i.name]));
  const acceptedNames = (p: AdminWastePointDTO) => p.acceptedItemIds.map((id) => itemName.get(id)).filter((n): n is string => n !== undefined);
  const hoursOf = (p: AdminWastePointDTO) => summarizeOpeningHours(p.openingHours);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
    return qc.invalidateQueries({ queryKey: ['admin-waste-points'] });
  };
  const reactivate = useMutation({
    mutationFn: (id: string) => updateWastePoint(id, { status: 'ACTIVE' }),
    onSuccess: () => { setErr(null); return refresh(); },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Thao tác thất bại.'),
  });

  return (
    <section className="space-y-4" aria-label="Điểm nhận" data-detail-id={detailId ?? undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-stone-900">Điểm nhận</h3>
        <button type="button" className={BTN_PRIMARY} onClick={() => setPanel({ point: null })}>Đăng ký điểm mới</button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc điểm nhận">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} className={chipClass(filter === f.key)} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {list.isError && <Notice tone="danger" role="alert">Không tải được danh sách điểm nhận.</Notice>}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      <ScrollRegion label="Bảng điểm nhận">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-stone-200">
              <th className={TH}>Điểm</th>
              <th className={TH}>Giờ mở cửa</th>
              <th className={TH}>Hàng nhận</th>
              <th className={TH}>Trạng thái</th>
              <th className={TH}>Hạn mức tháng</th>
              <th className={TH}>Lượt và nhân viên</th>
              <th className={TH}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const pointAlerts = alerts.filter((a) => a.pointId === p.id);
              return (
                <tr key={p.id} data-point={p.id} className="border-b border-stone-100">
                  <td className={`${TD} min-w-[150px]`}>
                    <div className="font-medium text-stone-900">{p.name}</div>
                    <div className="text-xs text-stone-600">{WASTE_POINT_KIND_LABELS[p.kind]}</div>
                    <div className="mt-0.5 max-w-[220px] text-xs text-stone-600">{`${p.addressLine}, ${p.communeName}, ${p.provinceName}`}</div>
                  </td>
                  <td className={TD}>
                    {hoursOf(p).length === 0 ? '—' : <ul className="space-y-0.5 text-xs">{hoursOf(p).map((h) => <li key={h} className="whitespace-nowrap">{h}</li>)}</ul>}
                  </td>
                  <td className={TD}>
                    <div className="flex max-w-[200px] flex-wrap gap-1">
                      {acceptedNames(p).length === 0 ? '—' : acceptedNames(p).map((n) => <ToneBadge key={n} tone="neutral">{n}</ToneBadge>)}
                    </div>
                  </td>
                  <td className={TD}>
                    <div className="flex max-w-[170px] flex-col items-start gap-1 [&_span]:whitespace-normal">
                      <span>{WASTE_POINT_STATUS_LABELS[p.status]}</span>
                      {p.status === 'ACTIVE' && p.quotaFull && <ToneBadge tone="warning">Tạm dừng, hết hạn mức</ToneBadge>}
                      {p.hiddenInactive && <ToneBadge tone="warning">Ẩn khỏi khách do không hoạt động</ToneBadge>}
                      {p.perkPendingText && <ToneBadge tone="warning">Có ưu đãi chờ duyệt</ToneBadge>}
                    </div>
                  </td>
                  <td className={TD}>
                    {p.monthlyQuotaPoints === null ? (
                      'Không hạn mức'
                    ) : (
                      <div className="min-w-[120px] space-y-1">
                        <div>{`${formatCount(p.monthUsage.pointsUsed)} / ${formatCount(p.monthlyQuotaPoints)} điểm`}</div>
                        <QuotaBar used={p.monthUsage.pointsUsed} quota={p.monthlyQuotaPoints} full={p.quotaFull} paceAlert={pointAlerts.some((a) => a.kind === 'QUOTA_PACE')} />
                      </div>
                    )}
                  </td>
                  <td className={TD}>
                    <div className="whitespace-nowrap">{`${formatCount(p.monthUsage.confirmations)} lượt`}</div>
                    <div className="whitespace-nowrap text-xs text-stone-600">{`${formatCount(p.staff.filter((s) => s.isActive).length)} nhân viên`}</div>
                  </td>
                  <td className={`${TD} min-w-[112px]`}>
                    <div className="flex flex-wrap gap-1 whitespace-nowrap">
                      <button type="button" className={BTN_XS_SECONDARY} onClick={() => setPanel({ point: p })}>Sửa</button>
                      <button type="button" className={BTN_XS_SECONDARY} onClick={() => setDetailId(p.id)}>Chi tiết</button>
                      {p.hiddenInactive && (
                        <button type="button" className={BTN_XS_SECONDARY} disabled={reactivate.isPending} onClick={() => reactivate.mutate(p.id)}>Kích hoạt lại</button>
                      )}
                    </div>
                    {pointAlerts.length > 0 && (
                      <div data-point-alerts={p.id} className="mt-2 space-y-1 text-xs text-warning-fg">
                        {pointAlerts.map((a, i) => <p key={`${a.kind}-${i}`}>{a.detail}</p>)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      {detailPoint && <WastePointDetail key={detailPoint.id} point={detailPoint} onClose={() => setDetailId(null)} />}
      {panel && (
        <WastePointForm
          point={panel.point}
          items={items.data ?? []}
          warehouseExists={warehouseExists}
          onSaved={() => { setPanel(null); void refresh(); }}
          onCancel={() => setPanel(null)}
        />
      )}
    </section>
  );
}

function QuotaBar({ used, quota, full, paceAlert }: { used: number; quota: number; full: boolean; paceAlert: boolean }) {
  const pct = quota > 0 ? Math.min(100, Math.round((used * 100) / quota)) : 0;
  const color = full || used >= quota ? 'bg-danger-fg' : paceAlert ? 'bg-warning-fg' : 'bg-forest-600';
  return (
    <div role="progressbar" aria-label="Mức dùng hạn mức tháng" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-quota-bar={color} className="h-1.5 w-full rounded-full bg-stone-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
