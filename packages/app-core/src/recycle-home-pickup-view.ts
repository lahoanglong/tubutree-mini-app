import type { WasteHomePickupDTO, WasteMethod, WastePickupQuoteResponse, WasteRequestStatus } from '@tubutree/shared-types';
import { errorStatus } from './api/error-status';
import { formatVnNumber } from './number-format';
import { HOME_PICKUP_BATTERY_TEXT, homePickupCopy } from './waste-copy';
import { homePickupKgLabel } from './recycle-home-pickup-state';
import { timelineFor } from './waste-timeline';

const vnd = (n: number) => `${formatVnNumber(n)}đ`;
const num = (n: number) => formatVnNumber(n);

export interface HomePickupQuoteView {
  feeText: string;
  /** Phí ước lượng cố định (chưa hỏi được đơn vị vận chuyển): hiện nhãn "Ước tính" cạnh phí và chưa cho đặt. */
  estimated: boolean;
  /** Điểm Xanh sẽ trừ cho phí ship khi đơn đặt được (0 khi chưa đủ điểm hoặc phí 0đ). */
  pointsUsed: number;
  /** Phần phí Điểm Xanh chưa trả đủ (máy chủ đã chặn bằng câu `blocked`). */
  remainingFeeVnd: number;
  /** Một dòng trả phí: điểm dùng được và điểm sẽ trừ. */
  payLine: string;
  /** Dòng điểm ước tính; dưới ngưỡng thì thành "Dự kiến X / Y điểm". */
  pointsLine: string;
  belowMin: boolean;
  /** Máy chủ nói địa chỉ không giao/lấy được: màn hiện lối "Sửa địa chỉ này" cạnh lý do. */
  addressOk: boolean;
  /** Đúng một lý do đang chặn (địa chỉ, Pin ngoài TP.HCM, máy chủ, phí ước tính), null khi không có. */
  notice: string | null;
  /** Không có gì chặn ở phía báo phí (khách còn cần tick đồng ý). */
  ok: boolean;
}

const BELOW_MIN_MESSAGE = /cần tối thiểu .* điểm/;

/**
 * Chữ và trạng thái của thẻ báo phí. Phí ship luôn trả bằng Điểm Xanh: thiếu điểm thì máy chủ trả `blocked` và nút tạo đơn tắt.
 * Chỉ một dòng lý do: địa chỉ không giao được, rồi Pin ngoài TP.HCM, rồi lý do máy chủ (bỏ câu "cần tối thiểu" vì dòng điểm đã nói), rồi phí ước tính.
 */
export function homePickupQuoteView(args: { quote: WastePickupQuoteResponse; batteryBlocked: boolean }): HomePickupQuoteView {
  const { quote, batteryBlocked } = args;
  const fee = Math.max(0, quote.shipFeeVnd);
  const belowMin = quote.estimatedPoints < quote.minPoints;
  const covered = quote.remainingFeeVnd <= 0;
  const pointsUsed = covered ? Math.min(quote.pointsApplicable, fee) : 0;

  let payLine: string;
  if (fee <= 0) payLine = homePickupCopy.payFree;
  else if (covered) payLine = homePickupCopy.payCovered(num(quote.pointsAvailable), num(pointsUsed));
  else payLine = homePickupCopy.payShort(num(quote.pointsAvailable));

  let notice: string | null = null;
  if (!quote.addressOk) notice = quote.addressMessage ?? homePickupCopy.addressNotOk;
  else if (batteryBlocked) notice = HOME_PICKUP_BATTERY_TEXT;
  else if (quote.blocked && !(belowMin && BELOW_MIN_MESSAGE.test(quote.blocked))) notice = quote.blocked;
  else if (quote.estimated) notice = homePickupCopy.feeUnavailable;

  return {
    feeText: vnd(fee),
    estimated: quote.estimated,
    pointsUsed,
    remainingFeeVnd: quote.remainingFeeVnd,
    payLine,
    pointsLine: belowMin ? homePickupCopy.progress(num(quote.estimatedPoints), num(quote.minPoints)) : homePickupCopy.estimate(num(quote.estimatedPoints)),
    belowMin,
    addressOk: quote.addressOk,
    notice,
    ok: quote.addressOk && !batteryBlocked && !quote.blocked && !belowMin && !quote.estimated,
  };
}

/**
 * 503 của thu gom tận nhà (chưa báo được phí, chưa gửi được lệnh huỷ tới đơn vị vận chuyển) mang câu tiếng Việt viết cho khách.
 * Câu chung của Mini App và web cho mọi 5xx là "Máy chủ đang bận" nên bên gọi dùng câu này trước; null khi không phải 503 hoặc câu không đọc được.
 */
export function homePickupUnavailableText(error: unknown): string | null {
  if (errorStatus(error) !== 503) return null;
  const e = error as { message?: unknown; response?: { data?: { message?: unknown } } };
  const raw = e.response?.data?.message ?? e.message;
  const text = (Array.isArray(raw) ? raw[0] : raw);
  return typeof text === 'string' && /[^\x00-\x7F]/.test(text) ? text.trim() : null;
}

export type HomePickupQuoteState = 'idle' | 'loading' | 'error' | 'ready';

/** Nút "Tạo đơn thu gom" bấm được hay không và câu nhắc ở thanh đáy (null khi lý do đã hiện ngay trong thẻ báo phí). */
export function homePickupCreateState(args: {
  addressId: string | null;
  quoteState: HomePickupQuoteState;
  view: HomePickupQuoteView | null;
  consentOk: boolean;
}): { ok: boolean; hint: string | null } {
  const { addressId, quoteState, view, consentOk } = args;
  if (!addressId) return { ok: false, hint: homePickupCopy.needAddress };
  // Đang tính phí, báo phí lỗi hay có lý do chặn: câu đã hiện ngay trong thẻ phí, thanh đáy không lặp lại.
  if (quoteState !== 'ready' || !view || !view.ok) return { ok: false, hint: null };
  if (!consentOk) return { ok: false, hint: homePickupCopy.needConsent };
  return { ok: true, hint: null };
}

type StatusFacts = {
  method: WasteMethod;
  status: WasteRequestStatus;
  pointsAwarded?: number | null;
  homePickup?: Pick<WasteHomePickupDTO, 'gomdonStatus'>;
};

/** Trạng thái vận đơn ngắn gọn (vừa một huy hiệu 375px) của đơn đang chạy; null khi trạng thái phiếu đã đủ nghĩa (hoàn tất, huỷ...). */
export function homePickupShortStatus(r: StatusFacts): string | null {
  const g = r.homePickup?.gomdonStatus ?? null;
  if (r.status === 'EXPIRED') return g === '10' ? 'Bưu tá chưa lấy được rác' : null;
  if (r.status !== 'OPEN' && r.status !== 'IN_TRANSIT') return null;
  switch (g) {
    case '3':
      return 'Bưu tá đã lấy rác';
    case '4':
    case '5':
      return 'Đang về kho Tubu';
    case '7':
      return 'Đã giao tới kho Tubu';
    case '10':
      return 'Bưu tá chưa lấy được rác';
    case '6':
    case '8':
    case '9':
    case '11':
    case '12':
    case 'NEEDS_MANUAL_CHECK':
      return 'Tubu đang xử lý vận đơn';
    default:
      return r.status === 'IN_TRANSIT' ? 'Đang về kho Tubu' : 'Chờ bưu tá tới lấy rác';
  }
}

export interface HomePickupDetailRow {
  label: string;
  value: string;
}

/** Các dòng tóm tắt phí ở chi tiết phiếu: địa chỉ, cân nặng, phí shipper, điểm đã trừ/hoàn. */
export function homePickupDetailRows(h: WasteHomePickupDTO): HomePickupDetailRow[] {
  const d = homePickupCopy.detail;
  const rows: HomePickupDetailRow[] = [];
  if (h.pickupAddressText) rows.push({ label: d.address, value: h.pickupAddressText });
  if (h.declaredWeightGrams > 0) rows.push({ label: d.weight, value: `${homePickupKgLabel(h.declaredWeightGrams)} kg` });
  rows.push({ label: d.fee, value: vnd(h.shipFeeVnd) });
  if (h.shipFeePointsUsed > 0) rows.push({ label: d.pointsUsed, value: `${num(h.shipFeePointsUsed)} điểm` });
  if (h.shipFeePointsRefunded > 0) rows.push({ label: d.pointsRefunded, value: `${num(h.shipFeePointsRefunded)} điểm` });
  return rows;
}

/** Chữ hộp xác nhận huỷ: nêu điểm sẽ được hoàn khi đơn đã trừ Điểm Xanh phí ship. */
export function homePickupCancelCopy(code: string, h: Pick<WasteHomePickupDTO, 'shipFeePointsUsed'> | undefined) {
  const used = h?.shipFeePointsUsed ?? 0;
  return {
    title: homePickupCopy.detail.cancelTitle,
    body: homePickupCopy.detail.cancelBody(code, used > 0 ? num(used) : null),
    confirm: homePickupCopy.detail.cancelConfirm,
  };
}

/** Thông báo sau khi huỷ xong: nói số điểm đã hoàn nếu có. */
export function homePickupCancelDone(h: Pick<WasteHomePickupDTO, 'shipFeePointsRefunded'> | undefined): string {
  const refunded = h?.shipFeePointsRefunded ?? 0;
  return refunded > 0 ? homePickupCopy.detail.cancelDoneRefund(num(refunded)) : homePickupCopy.detail.cancelDone;
}

/** Điểm đã dùng trừ phí ship / đã hoàn, một dòng phụ ở danh sách yêu cầu; null khi không dùng điểm. */
export function homePickupListMeta(r: Pick<StatusFacts, 'method'> & { homePickup?: Pick<WasteHomePickupDTO, 'shipFeePointsUsed' | 'shipFeePointsRefunded'> }): string | null {
  if (r.method !== 'HOME_PICKUP' || !r.homePickup) return null;
  const { shipFeePointsUsed: used, shipFeePointsRefunded: refunded } = r.homePickup;
  if (refunded > 0) return homePickupCopy.list.pointsRefunded(num(refunded));
  if (used > 0) return homePickupCopy.list.pointsUsed(num(used));
  return null;
}

/**
 * Mỗi mốc của lịch sử vận đơn (máy chủ gửi `{at, text}`) thuộc bước nào của dải 4 bước (chỉ số theo TIMELINE_STEPS.HOME_PICKUP).
 * Nhận theo đầu câu của máy chủ (`waste-home-pickup-text.ts`); câu lạ (vận đơn trục trặc) không thuộc bước nào nên bỏ,
 * trạng thái hiện hành đã nằm ở dòng trạng thái phía trên dải.
 */
const TIMELINE_ENTRY_STEPS: readonly (readonly [prefix: string, step: number, addsInfo: boolean])[] = [
  ['Đã tạo đơn', 0, false],
  ['Bưu tá đã lấy rác', 1, false],
  ['Đang về kho Tubu', 2, false],
  ['Đã giao tới kho Tubu', 2, true],
  ['Kho Tubu đã nhận rác', 3, true],
  ['Kho đã kiểm nhận', 3, true],
];

export interface HomePickupTimelineView {
  steps: readonly string[];
  current: number;
  /** Mốc thời gian (ISO) theo chỉ số bước đã có mốc; `extra` là câu của máy chủ khi nó nói thêm điều tên bước chưa nói (số điểm đã cộng, kho đã nhận...). */
  hints: Readonly<Record<number, { at: string; extra: string | null }>>;
}

export function homePickupTimelineView(r: {
  method: WasteMethod;
  status: WasteRequestStatus;
  orderCode: string | null;
  homePickup?: Pick<WasteHomePickupDTO, 'timeline'>;
}): HomePickupTimelineView | null {
  const t = timelineFor(r);
  if (!t) return null;
  const hints: Record<number, { at: string; extra: string | null }> = {};
  for (const e of r.homePickup?.timeline ?? []) {
    const hit = TIMELINE_ENTRY_STEPS.find(([prefix]) => e.text.startsWith(prefix));
    if (hit) hints[hit[1]] = { at: e.at, extra: hit[2] ? e.text : null };
  }
  return { steps: t.steps, current: t.current, hints };
}
