'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { WasteAlertDTO, WasteMonthMetrics, WasteOverviewDTO } from '@tubutree/shared-types';
import { downloadWasteMonthlyCsv, getConfig, getWasteOverview } from '@/lib/admin-client';
import { formatCount } from '@/lib/checkout-points';
import { formatVnd } from '@/lib/format-vnd';
import {
  WASTE_ADMIN_SECTIONS,
  WASTE_METHOD_LABELS,
  WASTE_REJECTION_REASON_LABELS,
  WASTE_REQUEST_STATUS_LABELS,
  WASTE_SECTION_LABELS,
  WASTE_STAFF_SECTIONS,
  type WasteSection,
} from '@/lib/waste-labels';
import { BTN_SECONDARY, chipClass, FIELD_XS, Notice, ToneBadge } from './ui';

/** Thẻ hộp việc nhờ tab mở một hàng đợi; `n` là Date.now() lúc bấm để trang remount tab bằng `key`. */
export type WasteSeed = { section: 'points' | 'requests' | 'gifts'; preset: string; n: number };

const DASH = '—';
const CARD = 'rounded-control border border-stone-200 bg-stone-0 p-3';
const LABEL = 'text-xs text-stone-600';
const VALUE = 'text-base font-semibold text-stone-900';

export function WasteTab({ isAdmin, seed }: { isAdmin: boolean; seed?: WasteSeed | null }) {
  const sections = isAdmin ? WASTE_ADMIN_SECTIONS : WASTE_STAFF_SECTIONS;
  const [section, setSection] = useState<WasteSection>(() =>
    seed && sections.includes(seed.section) ? seed.section : isAdmin ? 'items' : 'requests',
  );
  const overview = useQuery({ queryKey: ['admin-waste-overview'], queryFn: getWasteOverview, enabled: isAdmin });
  const config = useQuery({ queryKey: ['admin-config', 'waste'], queryFn: () => getConfig('waste'), enabled: isAdmin });
  const enabledRow = config.data?.find((r) => r.key === 'waste.enabled');
  const showOff = isAdmin && config.isSuccess && enabledRow?.value !== true;

  return (
    <div className="space-y-4" data-waste-tab={isAdmin ? 'admin' : 'staff'}>
      <h2 className="font-display text-lg font-semibold text-stone-900">Đổi rác lấy quà</h2>
      {showOff && (
        <Notice tone="info">
          Chương trình đang tắt với khách (waste.enabled). Admin vẫn đăng ký kho, điểm nhận và quà được; kho vẫn xử lý kiện đang về.
        </Notice>
      )}
      {isAdmin && overview.isError && <Notice tone="danger" role="alert">Không tải được số liệu tháng.</Notice>}
      {isAdmin && overview.data && <AlertList alerts={overview.data.alerts} />}
      {isAdmin && overview.data && <MonthStrip data={overview.data} />}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Mục đổi rác">
        {sections.map((s) => (
          <button key={s} type="button" aria-pressed={section === s} className={chipClass(section === s)} onClick={() => setSection(s)}>
            {WASTE_SECTION_LABELS[s]}
          </button>
        ))}
      </div>
      <div data-waste-section={section} />
    </div>
  );
}

function AlertList({ alerts }: { alerts: WasteAlertDTO[] }) {
  if (alerts.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Cảnh báo bất thường">
      <h3 className="text-sm font-semibold text-stone-900">Cảnh báo bất thường</h3>
      <ul className="space-y-2">
        {alerts.map((a, i) => (
          <li key={`${a.kind}-${a.pointId ?? a.confirmerName ?? i}`} data-waste-alert className="flex flex-wrap items-center gap-2 rounded-control border border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg">
            <span className="font-medium">{a.pointName ?? a.confirmerName ?? 'Toàn chương trình'}</span>
            <span className="min-w-0 flex-1 break-words">{a.detail}</span>
            <ToneBadge tone="warning">{a.threshold === null ? `${formatCount(a.value)}` : `${formatCount(a.value)} / ngưỡng ${formatCount(a.threshold)}`}</ToneBadge>
          </li>
        ))}
      </ul>
    </section>
  );
}

const sumMethods = (m: WasteMonthMetrics) => Object.values(m.requestsCreatedByMethod).reduce((a, b) => a + b, 0);
const orDash = (n: number | null | undefined, fmt: (v: number) => string = formatCount) => (n === null || n === undefined ? DASH : fmt(n));

function titleOfMonth(month: string): string {
  const [y, m] = month.split('-');
  return `Tháng ${m}/${y}`;
}

function Scalar({ k, label, current, previous, sub }: { k: string; label: string; current: string; previous: string; sub?: ReactNode }) {
  return (
    <div className={CARD} data-metric={k}>
      <div className={LABEL}>{label}</div>
      <div className={VALUE}>{current}</div>
      {sub && <div className="text-xs text-stone-600">{sub}</div>}
      <div className="text-xs text-stone-500">Tháng trước: {previous}</div>
    </div>
  );
}

function ListCard({ k, label, lines, foot }: { k: string; label: string; lines: string[]; foot?: string }) {
  return (
    <div className={CARD} data-metric={k}>
      <div className={LABEL}>{label}</div>
      <ul className="mt-1 space-y-0.5 text-sm text-stone-800">
        {lines.length === 0 ? <li>{DASH}</li> : lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      {foot && <div className="mt-1 text-xs text-stone-500">{foot}</div>}
    </div>
  );
}

function MonthStrip({ data }: { data: WasteOverviewDTO }) {
  const { current: cur, previous: prev } = data;
  const [month, setMonth] = useState(data.month);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const created = sumMethods(cur);
  const net = cur.pointsIssued - cur.pointsReversed;
  const prevNet = prev.pointsIssued - prev.pointsReversed;
  const hours = (m: WasteMonthMetrics) => (m.completeHoursP50 === null || m.completeHoursP90 === null ? DASH : `${formatCount(m.completeHoursP50)} giờ / ${formatCount(m.completeHoursP90)} giờ`);
  const prevTag = (v: string | undefined) => ` · tháng trước ${v ?? DASH}`;
  const pointName = (id: string) =>
    cur.unitsByPoint.find((p) => p.pointId === id)?.pointName ?? cur.quotaByPoint.find((p) => p.pointId === id)?.pointName ?? id;

  const statusLines = (Object.keys(WASTE_REQUEST_STATUS_LABELS) as (keyof typeof WASTE_REQUEST_STATUS_LABELS)[]).map(
    (s) => `${WASTE_REQUEST_STATUS_LABELS[s]}: ${formatCount(cur.requestsByStatus[s])}${prevTag(prev.requestsByStatus?.[s] === undefined ? undefined : formatCount(prev.requestsByStatus[s]))}`,
  );
  const itemLines = cur.unitsByItem.map((r) => {
    const p = prev.unitsByItem.find((x) => x.itemId === r.itemId);
    return `${r.itemName} · ${formatCount(r.qty)} ${r.unitLabel}${prevTag(p ? formatCount(p.qty) : undefined)}`;
  });
  const pointLines = cur.unitsByPoint.map((r) => {
    const p = prev.unitsByPoint.find((x) => x.pointId === r.pointId);
    return `${r.pointName} · ${formatCount(r.qty)}${prevTag(p ? formatCount(p.qty) : undefined)}`;
  });
  const pctLines = [
    ...(Object.keys(WASTE_METHOD_LABELS) as (keyof typeof WASTE_METHOD_LABELS)[]).map((m) => {
      const v = cur.receivedDeclaredPctByMethod[m];
      const pv = prev.receivedDeclaredPctByMethod?.[m];
      return `${WASTE_METHOD_LABELS[m]}: ${v === null ? DASH : `${formatCount(v)}%`}${prevTag(pv === null || pv === undefined ? undefined : `${formatCount(pv)}%`)}`;
    }),
    ...cur.receivedDeclaredPctByPoint.map((r) => {
      const p = prev.receivedDeclaredPctByPoint.find((x) => x.pointId === r.pointId);
      return `${pointName(r.pointId)}: ${r.pct === null ? DASH : `${formatCount(r.pct)}%`}${prevTag(p?.pct === null || p?.pct === undefined ? undefined : `${formatCount(p.pct)}%`)}`;
    }),
  ];
  const prevCreated = sumMethods(prev);
  const rate = (count: number, total: number) => (total === 0 ? DASH : `${formatCount(Math.round((count * 1000) / total) / 10)}%`);
  const rejectionLines = (Object.keys(WASTE_REJECTION_REASON_LABELS) as (keyof typeof WASTE_REJECTION_REASON_LABELS)[]).map(
    (r) => `${WASTE_REJECTION_REASON_LABELS[r]}: ${formatCount(cur.rejectionsByReason[r])} · ${rate(cur.rejectionsByReason[r], created)}${prevTag(prev.rejectionsByReason?.[r] === undefined ? undefined : `${formatCount(prev.rejectionsByReason[r])} · ${rate(prev.rejectionsByReason[r], prevCreated)}`)}`,
  );
  const quotaLines = cur.quotaByPoint.map((r) => {
    const p = prev.quotaByPoint.find((x) => x.pointId === r.pointId);
    return `${r.pointName} · ${formatCount(r.used)} / ${r.quota === null ? 'Không hạn mức' : formatCount(r.quota)} · ${formatCount(r.confirmations)} lượt${prevTag(p ? `${formatCount(p.used)} · ${formatCount(p.confirmations)} lượt` : undefined)}`;
  });

  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      await downloadWasteMonthlyCsv(month);
    } catch {
      setErr('Không tải được tệp CSV.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3" aria-label="Số liệu tháng">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-stone-900">{titleOfMonth(data.month)} so với {titleOfMonth(data.previousMonth)}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" aria-label="Tháng xuất CSV" className={FIELD_XS} value={month} onChange={(e) => setMonth(e.target.value)} />
          <button type="button" className={`${BTN_SECONDARY} inline-flex items-center gap-1`} disabled={busy || !month} onClick={download}>
            <Download size={14} aria-hidden="true" />
            Tải CSV
          </button>
        </div>
      </div>
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Scalar
          k="requestsCreated"
          label="Yêu cầu tạo mới"
          current={formatCount(created)}
          previous={formatCount(prevCreated)}
          sub={(Object.keys(WASTE_METHOD_LABELS) as (keyof typeof WASTE_METHOD_LABELS)[]).map((m) => `${WASTE_METHOD_LABELS[m]}: ${formatCount(cur.requestsCreatedByMethod[m])}`).join(' · ')}
        />
        <Scalar k="completed" label="Hoàn tất" current={formatCount(cur.requestsByStatus.COMPLETED)} previous={formatCount(prev.requestsByStatus.COMPLETED)} />
        <Scalar k="completeHours" label="Giờ tới hoàn tất (trung vị / P90)" current={hours(cur)} previous={hours(prev)} />
        <Scalar k="pointsIssued" label="Điểm đã cộng" current={formatCount(cur.pointsIssued)} previous={formatCount(prev.pointsIssued)} />
        <Scalar k="pointsReversed" label="Điểm đã thu hồi" current={formatCount(cur.pointsReversed)} previous={formatCount(prev.pointsReversed)} />
        <Scalar k="pointsNet" label="Điểm phải trả danh nghĩa" current={formatCount(net)} previous={formatCount(prevNet)} />
        <Scalar k="expiredCount" label="Hết hạn" current={formatCount(cur.expiredCount)} previous={formatCount(prev.expiredCount)} />
        <Scalar k="pickupCount" label="Thu kèm đơn" current={formatCount(cur.pickupCount)} previous={formatCount(prev.pickupCount)} />
        <Scalar k="carrierCostVnd" label="Phí ship đã nhập" current={formatVnd(cur.carrierCostVnd)} previous={formatVnd(prev.carrierCostVnd)} />
        <Scalar k="costVndPer1000PointsIssued" label="Phí ship mỗi 1.000 điểm đã cộng" current={orDash(cur.costVndPer1000PointsIssued, formatVnd)} previous={orDash(prev.costVndPer1000PointsIssued, formatVnd)} />
        <Scalar k="repeatCustomers60d" label="Khách quay lại trong 60 ngày" current={formatCount(cur.repeatCustomers60d)} previous={formatCount(prev.repeatCustomers60d)} />
        <ListCard k="requestsByStatus" label="Yêu cầu theo trạng thái" lines={statusLines} />
        <ListCard k="unitsByItem" label="Số đơn vị theo món" lines={itemLines} />
        <ListCard k="unitsByPoint" label="Số đơn vị theo điểm nhận" lines={pointLines} />
        <ListCard k="receivedDeclaredPct" label="Thực nhận so với số khai" lines={pctLines} />
        <ListCard k="rejections" label="Từ chối theo lý do" lines={rejectionLines} />
        <ListCard k="quotaByPoint" label="Hạn mức đại lý đã dùng" lines={quotaLines} />
        <ListCard
          k="weight"
          label="Khối lượng thực nhận / ước tính"
          lines={[`${orDash(cur.receivedWeightGrams)} g / ${orDash(cur.estimatedWeightGrams)} g ước tính`]}
        />
        <ListCard
          k="orders"
          label="Đơn mua của khách"
          lines={[`Khách có đổi rác: ${formatCount(cur.ordersOfExchangers)} đơn · Khách không đổi: ${formatCount(cur.ordersOfNonExchangers)} đơn`]}
          foot="Chỉ để xem, không kết luận nhân quả"
        />
      </div>
    </section>
  );
}
