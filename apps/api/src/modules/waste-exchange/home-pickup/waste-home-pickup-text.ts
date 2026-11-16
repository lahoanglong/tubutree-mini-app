import type { WasteFeeCashMethod, WasteHomePickupDTO, WasteHomePickupTimelineEntry } from '@tubutree/shared-types';
import { formatPoints } from '../../../common/format-points';

/** order_customer_id gửi Gomdon của phiếu thu gom độc lập: tiền tố WR- tách khỏi mã đơn mua (TUBU...). */
export const WASTE_GOMDON_ID_PREFIX = 'WR-';
export const wasteGomdonCustomerId = (code: string): string => `${WASTE_GOMDON_ID_PREFIX}${code}`;
export const isWasteGomdonCustomerId = (value: string | null | undefined): boolean => !!value && value.startsWith(WASTE_GOMDON_ID_PREFIX);
export const wasteCodeFromGomdonCustomerId = (value: string): string => value.slice(WASTE_GOMDON_ID_PREFIX.length);

/** Trạng thái nội bộ trước khi có vận đơn (cùng tên với GOMDON_STATE của đơn mua hàng). */
export const HOME_PICKUP_STATE = { CREATING: 'CREATING', NEEDS_MANUAL_CHECK: 'NEEDS_MANUAL_CHECK', FAILED: 'FAILED' } as const;

/** Câu khách đọc cho từng mã trạng thái Gomdon của phiếu thu gom độc lập. */
const GOMDON_TEXT: Record<string, string> = {
  '1': 'Đã tạo đơn, chờ bưu tá tới lấy rác',
  '2': 'Đơn thu gom đã huỷ',
  '3': 'Bưu tá đã lấy rác',
  '4': 'Đang về kho Tubu',
  '5': 'Đang về kho Tubu',
  '6': 'Đơn đang được đơn vị vận chuyển xử lý, Tubu sẽ liên hệ bạn',
  '7': 'Đã giao tới kho Tubu, chờ kho kiểm nhận',
  '8': 'Đơn đang được đơn vị vận chuyển xử lý, Tubu sẽ liên hệ bạn',
  '9': 'Đơn đang được đơn vị vận chuyển xử lý, Tubu sẽ liên hệ bạn',
  '10': 'Bưu tá chưa lấy được rác',
  '11': 'Đơn đang được đơn vị vận chuyển xử lý, Tubu sẽ liên hệ bạn',
  '12': 'Đơn đang được đơn vị vận chuyển xử lý, Tubu sẽ liên hệ bạn',
  [HOME_PICKUP_STATE.CREATING]: 'Đang tạo vận đơn',
  [HOME_PICKUP_STATE.NEEDS_MANUAL_CHECK]: 'Tubu đang kiểm tra vận đơn của bạn',
};
const WAITING_TEXT = 'Đang tạo vận đơn';

export function homePickupGomdonText(gomdonStatus: string | null | undefined): string {
  return gomdonStatus ? (GOMDON_TEXT[gomdonStatus] ?? WAITING_TEXT) : WAITING_TEXT;
}

type RowForDto = {
  status: string;
  closeReason?: string | null;
  gomdonStatus: string | null;
  shipFeeVnd: number | null;
  shipFeePointsUsed: number | null;
  shipFeeCodVnd: number | null;
  shipFeePointsRefunded: number | null;
  shipFeeCashVnd?: number | null;
  shipFeeCashMethod?: WasteFeeCashMethod | null;
  shipFeeCashPaidAt?: Date | null;
  shipFeeCashRefundedVnd?: number | null;
  declaredWeightGrams: number | null;
  pickupAddress: unknown;
  shippingHistory: unknown;
  createdAt: Date;
  receivedAt: Date | null;
  completedAt: Date | null;
  pointsAwarded: number | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** "đường, phường/xã, tỉnh/thành" từ ảnh chụp địa chỉ lưu trên phiếu; không kèm tên và số điện thoại. */
export function pickupAddressText(snapshot: unknown): string {
  if (!isRecord(snapshot)) return '';
  return [snapshot.street, snapshot.ward, snapshot.province].map(str).filter(Boolean).join(', ');
}

/** Mốc "Đã tạo đơn" luôn có (lúc khách tạo phiếu); các mốc sau lấy từ lịch sử vận đơn, rồi mốc kho nhận và cộng điểm. */
export function homePickupTimeline(row: Pick<RowForDto, 'shippingHistory' | 'createdAt' | 'receivedAt' | 'completedAt' | 'pointsAwarded' | 'status'>): WasteHomePickupTimelineEntry[] {
  const out: WasteHomePickupTimelineEntry[] = [{ at: row.createdAt.toISOString(), text: 'Đã tạo đơn thu gom' }];
  const history = Array.isArray(row.shippingHistory) ? row.shippingHistory : [];
  let last = '';
  for (const raw of history) {
    if (!isRecord(raw)) continue;
    const status = str(raw.status);
    const at = str(raw.at);
    // Mã 1 đã được dòng "Đã tạo đơn" ở trên nói thay; chỉ giữ câu khác nhau liền kề (4 và 5 cùng câu "Đang về kho Tubu").
    if (!at || status === '1') continue;
    const text = homePickupGomdonText(status);
    if (text === last) continue;
    last = text;
    out.push({ at, text });
  }
  if (row.receivedAt) out.push({ at: row.receivedAt.toISOString(), text: 'Kho Tubu đã nhận rác, đang kiểm đếm' });
  if (row.completedAt && row.status === 'COMPLETED') {
    out.push({ at: row.completedAt.toISOString(), text: `Kho đã kiểm nhận và cộng ${formatPoints(row.pointsAwarded ?? 0)} Điểm Xanh` });
  }
  return out;
}

function homePickupStatusText(row: RowForDto): string {
  if (row.status === 'COMPLETED') return `Kho đã kiểm nhận và cộng ${formatPoints(row.pointsAwarded ?? 0)} Điểm Xanh`;
  if (row.status === 'RECEIVED') return 'Kho Tubu đã nhận rác, đang kiểm đếm';
  if (row.status === 'CANCELLED') return 'Đơn thu gom đã huỷ';
  if (row.status === 'REJECTED') return 'Kho Tubu không nhận kiện này';
  if (row.status === 'REVERSED') return 'Tubu đã thu hồi Điểm Xanh của yêu cầu này';
  if (row.status === 'EXPIRED') {
    if (row.closeReason === 'FEE_UNPAID') return 'Quá hạn chuyển khoản phí lấy rác';
    return row.gomdonStatus === '10' ? homePickupGomdonText('10') : 'Yêu cầu đã đóng';
  }
  if (row.status === 'OPEN' && (row.shipFeeCashVnd ?? 0) > 0 && !row.shipFeeCashPaidAt) {
    return 'Chờ bạn chuyển khoản phí lấy rác';
  }
  return homePickupGomdonText(row.gomdonStatus);
}

export function toHomePickupDto(row: RowForDto): WasteHomePickupDTO {
  const cashVnd = row.shipFeeCashVnd ?? 0;
  return {
    gomdonStatus: row.gomdonStatus,
    statusText: homePickupStatusText(row),
    shipFeeVnd: row.shipFeeVnd ?? 0,
    shipFeePointsUsed: row.shipFeePointsUsed ?? 0,
    shipFeeCodVnd: row.shipFeeCodVnd ?? 0,
    shipFeePointsRefunded: row.shipFeePointsRefunded ?? 0,
    shipFeeCashVnd: cashVnd,
    shipFeeCashMethod: cashVnd > 0 ? (row.shipFeeCashMethod ?? null) : null,
    shipFeeCashPaid: cashVnd > 0 && row.shipFeeCashPaidAt != null,
    shipFeeCashRefundedVnd: row.shipFeeCashRefundedVnd ?? 0,
    declaredWeightGrams: row.declaredWeightGrams ?? 0,
    pickupAddressText: pickupAddressText(row.pickupAddress),
    timeline: homePickupTimeline(row),
  };
}
