'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WASTE_ONE_TAP_MAX_UNITS, WASTE_ONE_TAP_OVER_CAP_TEXT, type AdminWasteRequestRowDTO, type WasteRequestAdminDetailDTO } from '@tubutree/shared-types';
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

/**
 * Chỉ kiện kho đã nhận. Mang tới kho còn mở thì chưa chắc khách đã tới (máy chủ không đối chiếu gì với DROP_OFF), nên vẫn đếm tay
 * ở chi tiết: bấm nhầm ở hàng "Chờ tiếp nhận" sẽ cộng điểm cho túi chưa ai nhận.
 */
export const canQuickCount = (r: AdminWasteRequestRowDTO) => r.status === 'RECEIVED';

/** Trên WASTE_ONE_TAP_MAX_UNITS vỏ khai thì không cộng một chạm (spec PO A6); dòng thiếu tổng khai thì để count() đọc chi tiết rồi quyết. */
export const quickCountOverCap = (r: AdminWasteRequestRowDTO) => r.declaredQtyTotal !== undefined && r.declaredQtyTotal > WASTE_ONE_TAP_MAX_UNITS;

export type QuickFlash = { tone: 'success' | 'warning' | 'danger'; text: string };

const declaredPoints = (d: WasteRequestAdminDetailDTO) =>
  wastePointsForLines(d.lines.map((l) => ({ receivedQty: l.declaredQty, unitsPerPoint: l.unitsPerPoint, pointsPerGroup: l.pointsPerGroup })));

const declaredSummary = (d: WasteRequestAdminDetailDTO) => d.lines.map((l) => `${formatCount(l.declaredQty)} ${l.unitLabel} ${l.itemName}`).join(', ');

/**
 * Nút một chạm trên dòng yêu cầu: "Nhận kiện" cho túi thu kèm đơn và "Cộng điểm" theo đúng số khách khai. Món nguy hại, dòng chưa
 * đếm được, yêu cầu không có dòng hàng hay khai trên WASTE_ONE_TAP_MAX_UNITS vỏ thì mở chi tiết để đếm tay, không cộng điểm thẳng.
 */
export function useWasteQuickActions(onOpen: (id: string) => void, onDone?: (id: string, patch: Partial<AdminWasteRequestRowDTO>) => void) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<QuickFlash | null>(null);
  // React Query re-renders only after a zero-delay timer, so a second synchronous click still sees the button enabled.
  const inFlight = useRef(false);

  // Lỗi 409 (đã có người xử lý) hay kiện vào hàng không rõ chủ cũng đổi dữ liệu: làm mới cả khi thao tác không thành.
  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: ['admin-waste-request', id] });
    void qc.invalidateQueries({ queryKey: ['admin-waste-requests'] });
    void qc.invalidateQueries({ queryKey: ['admin-waste-unmatched'] });
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
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
      refresh(r.id);
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
      if (res.outcome === 'UNMATCHED') {
        setFlash({ tone: 'warning', text: `${WASTE_UNMATCHED_REASON_LABELS[res.reason]}: kiện ${r.code} đã chuyển vào hàng không rõ chủ` });
        return true;
      }
      const at = formatDateTime(res.receivedAt).slice(0, 5);
      setFlash(res.outcome === 'RECEIVED' ? { tone: 'success', text: `Đã nhận ${r.code} lúc ${at}.` } : { tone: 'warning', text: `${r.code} đã được nhận lúc ${at}.` });
      onDone?.(r.id, { status: 'RECEIVED', receivedAt: res.receivedAt, waitingReason: null });
      return true;
    });

  const count = (r: AdminWasteRequestRowDTO) =>
    run(r, async () => {
      // staleTime 0: hộp thoại phải dựa trên trạng thái mới nhất, không phải bản 30 giây trong cache admin.
      const d = await qc.fetchQuery({ queryKey: ['admin-waste-request', r.id], queryFn: () => getWasteRequest(r.id), staleTime: 0 });
      const manual = !canCountRequest(d)
        ? `${r.code} chưa tới bước đếm ở kho: đếm ở màn chi tiết.`
        : d.lines.length === 0
          ? `${r.code} không có dòng hàng: đếm ở màn chi tiết.`
          : d.lines.some((l) => l.hazardous)
            ? `${r.code} có món nguy hại cần kiểm: đếm ở màn chi tiết.`
            : d.lines.reduce((s, l) => s + l.declaredQty, 0) > WASTE_ONE_TAP_MAX_UNITS
              ? `${r.code}: ${WASTE_ONE_TAP_OVER_CAP_TEXT}.`
              : null;
      if (manual) {
        setFlash({ tone: 'warning', text: manual });
        onOpen(r.id);
        return false;
      }
      const ok = await confirm({
        title: `Cộng điểm ${r.code}`,
        message: `Cộng ${formatCount(declaredPoints(d))} điểm theo đúng số khách khai: ${declaredSummary(d)}. Nhận thiếu thì đóng hộp này và bấm Mở để đếm từng dòng.`,
        confirmLabel: 'Cộng điểm',
      });
      if (!ok) return false;
      const res = await confirmWasteRequest(r.id, {
        lines: d.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.declaredQty, receivedQty: l.declaredQty })),
        oneTap: true,
      });
      setFlash({ tone: 'success', text: `Đã cộng ${formatCount(res.pointsAwarded)} điểm cho ${r.code}.` });
      onDone?.(r.id, { status: 'COMPLETED', pointsAwarded: res.pointsAwarded });
      return true;
    });

  return { busyId, flash, receive, count, dialog };
}
