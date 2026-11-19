'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminWasteRequestRowDTO, WasteRequestAdminDetailDTO } from '@tubutree/shared-types';
import { confirmWasteRequest, getWasteRequest, receiveWasteRequest } from '@/lib/admin-client';
import { actionErrorText } from '@/lib/admin-error-text';
import { formatCount } from '@/lib/checkout-points';
import { formatDateTime } from '@/lib/format-date';
import { WASTE_UNMATCHED_REASON_LABELS } from '@/lib/waste-labels';
import { useConfirm } from './confirm-dialog';
import { canCountRequest, wastePointsForLines } from './waste-request-detail';

/**
 * Túi thu kèm đơn đang mở, đơn đã giao: máy chủ khớp theo mã đơn (không cần mã TR- hay đối chiếu SĐT), nên nhận được bằng một
 * lần bấm có hỏi lại. Kiện gửi về kho vẫn đi qua bảng Nhận kiện để đối chiếu.
 */
export const canQuickReceive = (r: AdminWasteRequestRowDTO) =>
  r.method === 'PICKUP' && r.status === 'OPEN' && r.orderCode !== null && r.waitingReason === null;

/** Dòng có thể đã tới bước đếm: kho đã nhận, hay khách mang tới (máy chủ còn kiểm điểm nhận là kho khi mở chi tiết). */
export const canQuickCount = (r: AdminWasteRequestRowDTO) =>
  r.status === 'RECEIVED' || (r.method === 'DROP_OFF' && r.status === 'OPEN' && r.waitingReason === null);

export type QuickFlash = { tone: 'success' | 'warning' | 'danger'; text: string };

const declaredPoints = (d: WasteRequestAdminDetailDTO) =>
  wastePointsForLines(d.lines.map((l) => ({ receivedQty: l.declaredQty, unitsPerPoint: l.unitsPerPoint, pointsPerGroup: l.pointsPerGroup })));

const declaredSummary = (d: WasteRequestAdminDetailDTO) => d.lines.map((l) => `${formatCount(l.declaredQty)} ${l.unitLabel} ${l.itemName}`).join(', ');

/**
 * Nút một chạm trên dòng yêu cầu: "Nhận kiện" cho túi thu kèm đơn và "Cộng điểm" theo đúng số khách khai. Món nguy hại, dòng chưa
 * đếm được hay yêu cầu không có dòng hàng thì mở chi tiết để đếm tay, không cộng điểm thẳng.
 */
export function useWasteQuickActions(onOpen: (id: string) => void, onDone?: () => void) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<QuickFlash | null>(null);
  // React Query re-renders only after a zero-delay timer, so a second synchronous click still sees the button enabled.
  const inFlight = useRef(false);

  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: ['admin-waste-request', id] });
    void qc.invalidateQueries({ queryKey: ['admin-waste-requests'] });
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
    onDone?.();
  };

  const run = async (r: AdminWasteRequestRowDTO, work: () => Promise<boolean>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setFlash(null);
    setBusyId(r.id);
    try {
      if (await work()) refresh(r.id);
    } catch (e) {
      setFlash({ tone: 'danger', text: `${r.code}: ${actionErrorText(e)}` });
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  };

  const receive = (r: AdminWasteRequestRowDTO) =>
    run(r, async () => {
      const ok = await confirm({
        title: `Nhận kiện ${r.code}`,
        message: `Kho đã nhận túi thu kèm đơn ${r.orderCode ?? ''}. Nhận xong, đếm và cộng điểm ở hàng Kho cần đếm.`,
        confirmLabel: 'Nhận kiện',
      });
      if (!ok) return false;
      const res = await receiveWasteRequest(r.id, {});
      if (res.outcome === 'RECEIVED') setFlash({ tone: 'success', text: `Đã nhận ${r.code} lúc ${formatDateTime(res.receivedAt).slice(0, 5)}.` });
      else if (res.outcome === 'ALREADY_RECEIVED') setFlash({ tone: 'warning', text: `${r.code} đã được nhận lúc ${formatDateTime(res.receivedAt).slice(0, 5)}.` });
      else setFlash({ tone: 'warning', text: `${WASTE_UNMATCHED_REASON_LABELS[res.reason]}: kiện ${r.code} đã chuyển vào hàng không rõ chủ` });
      return true;
    });

  const count = (r: AdminWasteRequestRowDTO) =>
    run(r, async () => {
      const d = await qc.fetchQuery({ queryKey: ['admin-waste-request', r.id], queryFn: () => getWasteRequest(r.id) });
      const manual = !canCountRequest(d)
        ? 'chưa tới bước đếm ở kho'
        : d.lines.length === 0
          ? 'không có dòng hàng'
          : d.lines.some((l) => l.hazardous)
            ? 'có món nguy hại cần kiểm'
            : null;
      if (manual) {
        setFlash({ tone: 'warning', text: `${r.code} ${manual}: đếm ở màn chi tiết.` });
        onOpen(r.id);
        return false;
      }
      const ok = await confirm({
        title: `Cộng điểm ${r.code}`,
        message: `Cộng ${formatCount(declaredPoints(d))} điểm theo đúng số khách khai: ${declaredSummary(d)}. Nhận thiếu thì đóng hộp này và bấm Mở để đếm từng dòng.`,
        confirmLabel: 'Cộng điểm',
      });
      if (!ok) return false;
      const res = await confirmWasteRequest(r.id, { lines: d.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.declaredQty, receivedQty: l.declaredQty })) });
      setFlash({ tone: 'success', text: `Đã cộng ${formatCount(res.pointsAwarded)} điểm cho ${r.code}.` });
      return true;
    });

  return { busyId, flash, receive, count, dialog };
}
