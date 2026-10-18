import { Prisma } from '@prisma/client';
import type { CustomerRefundKind, CustomerRefundStatus, PayoutStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { formatVnDateTime } from '../../common/vn-time';
import { maskPhoneKeepLast3, maskVnPhonesInText } from '../../common/mask-pii';
import { OPEN_CUSTOMER_REFUND_STATUSES } from '../orders/refund-queue';
import { EXPORT_BATCH, row, text } from './admin-export';

/**
 * File cho kế toán (D1-14): khấu trừ TNCN của CTV, lệnh rút tiền, khoản hoàn tiền khách. Cùng quy ước với admin-export.ts (BOM UTF-8
 * ở streamCsv, ô bắt đầu bằng = + - @ được thêm dấu nháy đơn ở csvCell, SĐT/MST/số tài khoản dạng chữ để Excel không bỏ số 0 đầu).
 */
interface Range {
  start: Date;
  end: Date;
}

const dateTime = (d: Date | null | undefined) => (d ? formatVnDateTime(d) : '');

// ── Khấu trừ TNCN theo người nhận ──

export const PIT_CSV_HEADERS = [
  'Mã người dùng',
  'Người nhận',
  'SĐT',
  'MST/CCCD',
  'Số lần chi',
  'Thu nhập (VNĐ)',
  'Thuế TNCN đã khấu trừ (VNĐ)',
  'Thực nhận (VNĐ)',
  'Ghi chú',
];

interface PitRow {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  tax_id: string | null;
  payout_count: number;
  gross: bigint;
  tax_withheld: bigint;
  net: bigint;
}

/**
 * Mọi lần chi hoa hồng cho cá nhân (lệnh đã chi, có thu nhập gộp) trong [start, end) theo ngày chi, gộp theo người nhận: đúng tập và
 * đúng cách tính của bảng "Khấu trừ thuế TNCN theo tháng" (AffiliateService.pitReport), kể cả MST (số đã chụp vào lệnh gần nhất,
 * thiếu thì theo hồ sơ hiện tại). Sắp theo thuế khấu trừ giảm dần như bảng trên màn.
 */
export async function* pitCsvChunks(prisma: PrismaService, range: Range): AsyncGenerator<string> {
  yield row(PIT_CSV_HEADERS);
  const rows = await prisma.$queryRaw<PitRow[]>(Prisma.sql`
    SELECT p."userId" AS user_id,
           u."fullName" AS full_name,
           u.phone AS phone,
           COALESCE((array_agg(p."taxId" ORDER BY p."paidAt" DESC) FILTER (WHERE p."taxId" IS NOT NULL))[1], u."personalTaxId") AS tax_id,
           COUNT(*)::int AS payout_count,
           SUM(p."grossAmount")::bigint AS gross,
           SUM(p."taxWithheld")::bigint AS tax_withheld,
           SUM(p.amount)::bigint AS net
    FROM payouts p
    JOIN users u ON u.id = p."userId"
    WHERE p.status = 'PAID' AND p."grossAmount" IS NOT NULL AND p."paidAt" >= ${range.start} AND p."paidAt" < ${range.end}
    GROUP BY p."userId", u."fullName", u.phone, u."personalTaxId"
    ORDER BY SUM(p."taxWithheld") DESC, SUM(p."grossAmount") DESC, p."userId"`);
  if (rows.length === 0) return;
  yield rows
    .map((r) =>
      row([
        r.user_id,
        r.full_name ?? '',
        text(r.phone),
        text(r.tax_id),
        r.payout_count,
        Number(r.gross),
        Number(r.tax_withheld),
        Number(r.net),
        !r.tax_id && Number(r.tax_withheld) > 0 ? 'Thiếu MST/CCCD' : '',
      ]),
    )
    .join('');
}

// ── Lệnh rút tiền ──

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Đang chờ duyệt',
  APPROVED: 'Đã duyệt, chờ chuyển khoản',
  PAID: 'Đã chuyển khoản',
  REJECTED: 'Bị từ chối (đã hoàn)',
};

export const PAYOUT_CSV_HEADERS = [
  'Mã lệnh',
  'Ngày yêu cầu',
  'Loại',
  'Người rút',
  'SĐT',
  'Thu nhập gộp (VNĐ)',
  'Thuế TNCN (VNĐ)',
  'Phí chuyển khoản (VNĐ)',
  'Thực nhận (VNĐ)',
  'MST/CCCD',
  'Ngân hàng',
  'Số tài khoản',
  'Chủ tài khoản',
  'Trạng thái',
  'Ngày duyệt',
  'Ngày chuyển khoản',
  'Mã giao dịch ngân hàng',
  'Lý do từ chối',
  'Ghi chú admin',
];

/** Lệnh yêu cầu rút trong [start, end) theo ngày yêu cầu; `status` rỗng = mọi trạng thái. */
export function payoutExportWhere(range: Range, status?: PayoutStatus): Prisma.PayoutWhereInput {
  return { requestedAt: { gte: range.start, lt: range.end }, ...(status ? { status } : {}) };
}

const PAYOUT_SELECT = {
  id: true,
  amount: true,
  fee: true,
  grossAmount: true,
  taxWithheld: true,
  taxId: true,
  bankInfo: true,
  status: true,
  requestedAt: true,
  reviewedAt: true,
  paidAt: true,
  bankRef: true,
  rejectionReason: true,
  adminNote: true,
  user: { select: { fullName: true, phone: true } },
} satisfies Prisma.PayoutSelect;

function bankInfoOf(value: unknown): { bankName?: string; accountNumber?: string; accountName?: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return { bankName: s(o.bankName), accountNumber: s(o.accountNumber), accountName: s(o.accountName) };
}

export async function* payoutCsvChunks(prisma: PrismaService, where: Prisma.PayoutWhereInput): AsyncGenerator<string> {
  yield row(PAYOUT_CSV_HEADERS);
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.payout.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: PAYOUT_SELECT,
    });
    if (batch.length === 0) return;
    yield batch
      .map((p) => {
        const bank = bankInfoOf(p.bankInfo);
        const commission = p.grossAmount !== null;
        return row([
          p.id,
          dateTime(p.requestedAt),
          commission ? 'Hoa hồng CTV' : 'Rút Ví Tubu hoặc lệnh cũ',
          p.user.fullName ?? '',
          text(p.user.phone),
          p.grossAmount ?? '',
          p.taxWithheld,
          p.fee,
          p.amount,
          text(p.taxId),
          bank.bankName ?? '',
          text(bank.accountNumber),
          bank.accountName ?? '',
          PAYOUT_STATUS_LABEL[p.status] ?? p.status,
          dateTime(p.reviewedAt),
          dateTime(p.paidAt),
          p.bankRef ?? '',
          p.rejectionReason ?? '',
          p.adminNote ?? '',
        ]);
      })
      .join('');
    if (batch.length < EXPORT_BATCH) return;
    cursor = batch[batch.length - 1]!.id;
  }
}

// ── Hoàn tiền khách ──

const REFUND_KIND_LABEL: Record<string, string> = {
  END_CUSTOMER: 'Khách cuối (đơn CTV lên hộ)',
  CANCEL: 'Huỷ đơn',
  RETURN: 'Trả hàng',
  LATE_PAYMENT: 'Tiền về muộn',
  OVERPAYMENT: 'Khách chuyển dư',
};
const REFUND_STATUS_LABEL: Record<string, string> = {
  UNVERIFIED: 'Chờ đối soát',
  PENDING: 'Chờ chuyển khoản',
  PROCESSING: 'Đang chuyển khoản',
  COMPLETED: 'Đã chuyển khoản',
  DISMISSED: 'Không phải tiền dư',
};
const REFUND_REASON_LABEL: Record<string, string> = { CANCELLED: 'Đơn bị huỷ', RETURNED: 'Đơn bị trả' };

export const REFUND_CSV_HEADERS = [
  'Mã đơn',
  'Ngày tạo khoản hoàn',
  'Loại khoản',
  'Nguyên nhân',
  'Cách hoàn',
  'Trạng thái',
  'Số tiền (VNĐ)',
  'Người nhận',
  'SĐT người nhận',
  'Ngân hàng',
  'Số tài khoản',
  'Chủ tài khoản',
  'Ngày hoàn xong',
  'Mã giao dịch ngân hàng',
  'Ghi chú admin',
];

/** `status` = OPEN lấy mọi khoản còn việc (cùng tập với thẻ "Hoàn tiền khách"); rỗng = mọi trạng thái. */
export function refundExportWhere(
  range: Range,
  status?: 'OPEN' | CustomerRefundStatus,
  kind?: CustomerRefundKind,
): Prisma.OrderCustomerRefundWhereInput {
  return {
    createdAt: { gte: range.start, lt: range.end },
    ...(status === 'OPEN' ? { status: { in: [...OPEN_CUSTOMER_REFUND_STATUSES] } } : status ? { status } : {}),
    ...(kind ? { kind } : {}),
  };
}

const REFUND_SELECT = {
  id: true,
  orderCode: true,
  kind: true,
  reason: true,
  method: true,
  status: true,
  amount: true,
  recipientName: true,
  phone: true,
  bankName: true,
  bankAccountNo: true,
  bankAccountName: true,
  createdAt: true,
  completedAt: true,
  bankRef: true,
  adminNote: true,
} satisfies Prisma.OrderCustomerRefundSelect;

/** `maskPhones`: người xuất không thấy SĐT khách đầy đủ (seesFullOrderPhones) chỉ nhận 3 số cuối; số tài khoản vẫn đủ để chuyển tiền. */
export async function* refundCsvChunks(
  prisma: PrismaService,
  where: Prisma.OrderCustomerRefundWhereInput,
  opts: { maskPhones?: boolean } = {},
): AsyncGenerator<string> {
  yield row(REFUND_CSV_HEADERS);
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.orderCustomerRefund.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: REFUND_SELECT,
    });
    if (batch.length === 0) return;
    yield batch
      .map((r) =>
        row([
          r.orderCode,
          dateTime(r.createdAt),
          REFUND_KIND_LABEL[r.kind] ?? r.kind,
          REFUND_REASON_LABEL[r.reason] ?? r.reason,
          r.method === 'WALLET' ? 'Ví Tubu' : 'Chuyển khoản',
          r.method === 'WALLET' && r.status === 'COMPLETED' ? 'Đã hoàn vào ví' : (REFUND_STATUS_LABEL[r.status] ?? r.status),
          r.amount,
          r.recipientName ?? '',
          text(opts.maskPhones ? maskPhoneKeepLast3(r.phone) : r.phone),
          r.bankName ?? '',
          text(r.bankAccountNo),
          r.bankAccountName ?? '',
          dateTime(r.completedAt),
          r.bankRef ?? '',
          opts.maskPhones && r.adminNote ? maskVnPhonesInText(r.adminNote) : (r.adminNote ?? ''),
        ]),
      )
      .join('');
    if (batch.length < EXPORT_BATCH) return;
    cursor = batch[batch.length - 1]!.id;
  }
}
