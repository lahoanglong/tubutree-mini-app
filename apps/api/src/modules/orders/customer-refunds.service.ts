import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { CustomerRefundKind, CustomerRefundStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { formatVnd, maskedBank, normalizeBankDetails, type BankDetails } from './refund-destination';
import { OPEN_CUSTOMER_REFUND_STATUSES, announceBankRefund } from './refund-queue';
import { formatVnDateTime } from '../../common/vn-time';
import { maskPhone } from '../../common/mask-pii';

/** Khoản khách thấy ở chi tiết đơn (không lộ cột nội bộ như completedBy). */
export interface MyRefundView {
  id: string;
  orderId: string;
  orderCode: string;
  kind: CustomerRefundKind;
  /** Khoản trả hàng: id yêu cầu trả (khớp thẻ đổi/trả với khoản tiền thật). */
  refKey: string;
  amount: number;
  method: 'WALLET' | 'MANUAL_TRANSFER';
  status: CustomerRefundStatus;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  bankRef: string | null;
  completedAt: Date | null;
  createdAt: Date;
  /** Khách còn chọn/đổi được nơi nhận (chưa chuyển khoản). */
  canChooseDestination: boolean;
}

/**
 * Trạng thái khách thấy: khoản chờ đối soát (UNVERIFIED — Pancake báo khách trả dư, chưa ai đối chiếu sao kê) và khoản admin
 * đã bỏ qua (DISMISSED) không phải tiền Tubu nợ khách.
 */
const CUSTOMER_VISIBLE: CustomerRefundStatus[] = ['PENDING', 'PROCESSING', 'COMPLETED'];

/** Lý do tối thiểu khi admin bỏ qua một khoản chờ đối soát — khớp web admin. */
const DISMISS_REASON_MIN = 5;

/**
 * Khoản của khách cuối đơn CTV lên hộ: không có chủ tài khoản (userId null) nên không ai chọn nơi nhận; admin chuyển khoản
 * tay theo SĐT, không bắt gõ tài khoản nhận trước. Gồm cả khoản huỷ/trả/tiền về muộn/trả dư của đơn hộ, không riêng END_CUSTOMER.
 */
const isEndCustomerRow = (row: { kind: CustomerRefundKind; userId: string | null }) => row.kind === 'END_CUSTOMER' || row.userId === null;

const MINE_SELECT = {
  id: true,
  orderId: true,
  orderCode: true,
  kind: true,
  refKey: true,
  amount: true,
  method: true,
  status: true,
  bankName: true,
  bankAccountNo: true,
  bankAccountName: true,
  bankRef: true,
  completedAt: true,
  createdAt: true,
} as const;

/**
 * Hàng đợi hoàn tiền thủ công (order_customer_refunds). Dòng MANUAL_TRANSFER PENDING là tiền Tubu đang nợ khách:
 * khách huỷ/trả đơn trả trước chọn nhận về ngân hàng, tiền về muộn cho đơn đã huỷ, hoặc khách cuối của đơn CTV lên hộ.
 * Admin chuyển khoản tay rồi xác nhận kèm mã giao dịch; khách được báo ở mỗi bước (D2).
 */
@Injectable()
export class CustomerRefundsService {
  private readonly logger = new Logger(CustomerRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional: test dựng tay một tham số vẫn chạy; app thật luôn wiring (NotificationsModule @Global).
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async list(status: CustomerRefundStatus | 'OPEN' | undefined, page: number, limit: number, kind?: CustomerRefundKind) {
    const where: Prisma.OrderCustomerRefundWhereInput = {
      ...(status === 'OPEN' ? { status: { in: [...OPEN_CUSTOMER_REFUND_STATUSES] } } : status ? { status } : {}),
      ...(kind ? { kind } : {}),
    };
    const queue = status === 'OPEN' || status === 'PENDING' || status === 'UNVERIFIED';
    const [items, total] = await this.prisma.$transaction([
      // Hàng chờ: cũ nhất trước để khoản nợ khách lâu nhất không bị chìm.
      this.prisma.orderCustomerRefund.findMany({
        where,
        orderBy: { createdAt: queue ? 'asc' : 'desc' },
        ...skipTake(page, limit),
      }),
      this.prisma.orderCustomerRefund.count({ where }),
    ]);
    const names = await this.adminNames(items.flatMap((r) => [r.claimedBy, r.completedBy]));
    const named = items.map((r) => ({
      ...r,
      claimedByName: r.claimedBy ? (names.get(r.claimedBy) ?? null) : null,
      completedByName: r.completedBy ? (names.get(r.completedBy) ?? null) : null,
    }));
    return paginated(named, page, limit, total);
  }

  private async adminNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true, phone: true } });
    return new Map(users.map((u) => [u.id, u.fullName?.trim() || (u.phone ? maskPhone(u.phone) : 'Quản trị viên')]));
  }

  /**
   * Khoản đang chuyển khoản chỉ người bấm "Bắt đầu chuyển khoản" được trả về hàng chờ hay xác nhận đã chuyển (R3-MONEY-4):
   * admin khác bấm nhầm là khách lại rút được về Ví trong khi người kia đã chuyển tiền — hoàn hai lần. Admin khác chỉ làm
   * được khi chọn "Tiếp quản" kèm lý do; lần tiếp quản ghi vào lịch sử đơn. Trả `claimedBy` phải khớp ở câu ghi.
   */
  private async claimGuard(
    adminId: string,
    row: { amount: number; status: CustomerRefundStatus; claimedBy: string | null; claimedAt: Date | null },
    action: 'release' | 'paid',
    takeOver: { confirm?: boolean; reason?: string },
  ): Promise<{ claimedBy: string | null; takeOverNote: string | null }> {
    if (row.status !== 'PROCESSING' || !row.claimedBy || row.claimedBy === adminId) {
      return { claimedBy: row.status === 'PROCESSING' ? row.claimedBy : null, takeOverNote: null };
    }
    const holder = (await this.adminNames([row.claimedBy])).get(row.claimedBy) ?? 'một quản trị viên khác';
    const since = row.claimedAt ? ` từ ${formatVnDateTime(row.claimedAt)}` : '';
    const reason = takeOver.reason?.trim() ?? '';
    if (!takeOver.confirm || reason.length < 5) {
      throw new BadRequestException(
        `Khoản này đang do ${holder} chuyển khoản${since}. Chỉ người đó được ${action === 'release' ? 'trả về hàng chờ' : 'xác nhận đã chuyển'}; ` +
          `nếu chắc chắn ${holder} không chuyển nữa, chọn "Tiếp quản" và ghi lý do (được lưu vào lịch sử đơn).`,
      );
    }
    return {
      claimedBy: row.claimedBy,
      takeOverNote:
        `Hoàn tiền ${formatVnd(row.amount)}: tiếp quản khoản ${holder} đang chuyển khoản${since} — ` +
        `${action === 'release' ? 'trả về hàng chờ' : 'xác nhận đã chuyển khoản'}. Lý do: ${reason}`,
    };
  }

  private async recordOrderNote(tx: Prisma.TransactionClient, adminId: string, orderId: string, note: string): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) return;
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: order.status, toStatus: order.status, actorType: 'ADMIN', actorId: adminId, note },
    });
  }

  /**
   * Admin bấm "Bắt đầu chuyển khoản" TRƯỚC khi chuyển tiền: khoản sang PROCESSING, nơi nhận bị khoá — khách không đổi sang Ví
   * được nữa. Cùng guard (PENDING) với lần khách chọn Ví nên đúng một bên thắng; khách vừa chọn Ví thì admin được báo rõ
   * và không chuyển. Khoản chưa có tài khoản thì admin nhập tài khoản khách gửi qua kênh khác ngay lúc này.
   */
  async claim(
    adminId: string,
    id: string,
    opts: { bankName?: string; accountNumber?: string; accountName?: string } = {},
  ) {
    const row = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy khoản hoàn tiền.');
    const typedBank = opts.accountNumber?.trim() ? normalizeBankDetails(opts) : null;
    if (!isEndCustomerRow(row) && !row.bankAccountNo && !typedBank) {
      throw new BadRequestException('Khoản này chưa có tài khoản nhận. Nhập tài khoản khách cung cấp trước khi chuyển khoản.');
    }
    const res = await this.prisma.orderCustomerRefund.updateMany({
      where: { id, method: 'MANUAL_TRANSFER', status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        claimedBy: adminId,
        claimedAt: new Date(),
        ...(typedBank
          ? { bankName: typedBank.bankName, bankAccountNo: typedBank.accountNumber, bankAccountName: typedBank.accountName }
          : {}),
      },
    });
    if (res.count === 0) throw new BadRequestException(await this.notTransferableReason(id, adminId));
    this.logger.log(`Admin ${adminId} nhận chuyển khoản hoàn tiền khách ${id}.`);
    return this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id } });
  }

  /** Admin nhận nhầm / chưa chuyển được: trả khoản về hàng chờ, khách lại đổi được nơi nhận. */
  async release(adminId: string, id: string, opts: { takeOver?: boolean; takeOverReason?: string } = {}) {
    const row = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy khoản hoàn tiền.');
    if (row.method !== 'MANUAL_TRANSFER' || row.status !== 'PROCESSING') {
      throw new BadRequestException('Khoản hoàn không còn ở trạng thái đang chuyển khoản — vui lòng tải lại.');
    }
    const guard = await this.claimGuard(adminId, row, 'release', { confirm: opts.takeOver, reason: opts.takeOverReason });
    const won = await this.prisma.$transaction(async (tx) => {
      const res = await tx.orderCustomerRefund.updateMany({
        where: { id, method: 'MANUAL_TRANSFER', status: 'PROCESSING', claimedBy: guard.claimedBy },
        data: { status: 'PENDING', claimedBy: null, claimedAt: null },
      });
      if (res.count === 0) return false;
      if (guard.takeOverNote) await this.recordOrderNote(tx, adminId, row.orderId, guard.takeOverNote);
      return true;
    });
    if (!won) throw new BadRequestException(await this.notTransferableReason(id, adminId));
    this.logger.log(`Admin ${adminId} trả khoản hoàn ${id} về hàng chờ${guard.takeOverNote ? ' (tiếp quản)' : ''}.`);
    return this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id } });
  }

  async markPaid(
    adminId: string,
    id: string,
    opts: {
      bankRef?: string;
      note?: string;
      bankName?: string;
      accountNumber?: string;
      accountName?: string;
      takeOver?: boolean;
      takeOverReason?: string;
    } = {},
  ) {
    const bankRef = opts.bankRef?.trim();
    if (!bankRef) throw new BadRequestException('Vui lòng nhập mã giao dịch ngân hàng của lần chuyển khoản hoàn tiền.');
    const row = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy khoản hoàn tiền.');
    const typedBank = opts.accountNumber?.trim() ? normalizeBankDetails(opts) : null;
    // Khoản của khách có tài khoản (huỷ/trả/tiền về muộn) phải có tài khoản nhận; khoản khách cuối đơn CTV chuyển theo SĐT.
    if (!isEndCustomerRow(row) && !row.bankAccountNo && !typedBank) {
      throw new BadRequestException('Khoản này chưa có tài khoản nhận. Nhập tài khoản khách cung cấp trước khi xác nhận.');
    }
    // Khách tự đổi được nơi nhận (khoản có chủ tài khoản) thì chỉ xác nhận được khoản đã khoá bằng "Bắt đầu chuyển khoản":
    // xác nhận thẳng từ hàng chờ là chuyển tiền trong lúc khách vẫn có thể rút về Ví — hoàn hai lần.
    const lockable = row.userId !== null;
    if (lockable && row.method === 'MANUAL_TRANSFER' && row.status === 'PENDING') {
      throw new BadRequestException('Bấm "Bắt đầu chuyển khoản" để khoá nơi nhận trước khi chuyển tiền, rồi mới xác nhận đã chuyển.');
    }
    const guard = await this.claimGuard(adminId, row, 'paid', { confirm: opts.takeOver, reason: opts.takeOverReason });
    // Đang chuyển khoản: chỉ khớp đúng người giữ khoản lúc đọc (chính mình, hoặc người được tiếp quản) — ai đó trả về hàng
    // chờ hay nhận lại chen giữa thì câu ghi trượt. Khoản khách cuối đơn CTV (không ai đổi nơi nhận) xác nhận thẳng từ hàng chờ.
    const allowed: Prisma.OrderCustomerRefundWhereInput[] =
      row.status === 'PROCESSING'
        ? [{ status: 'PROCESSING', claimedBy: guard.claimedBy }]
        : lockable
          ? []
          : [{ status: 'PENDING' }];
    const won = await this.prisma.$transaction(async (tx) => {
      if (allowed.length === 0) return false;
      const res = await tx.orderCustomerRefund.updateMany({
        where: { id, method: 'MANUAL_TRANSFER', OR: allowed },
        data: {
          status: 'COMPLETED',
          completedBy: adminId,
          completedAt: new Date(),
          bankRef,
          ...(opts.note?.trim() ? { adminNote: opts.note.trim() } : {}),
          ...(typedBank
            ? { bankName: typedBank.bankName, bankAccountNo: typedBank.accountNumber, bankAccountName: typedBank.accountName }
            : {}),
        },
      });
      if (res.count === 0) return false;
      if (guard.takeOverNote) await this.recordOrderNote(tx, adminId, row.orderId, `${guard.takeOverNote} · Mã GD ${bankRef}`);
      return true;
    });
    if (!won) throw new BadRequestException(await this.notTransferableReason(id, adminId));
    this.logger.log(`Admin ${adminId} xác nhận đã chuyển khoản hoàn tiền khách ${id} (mã GD ${bankRef}).`);
    const done = await this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id } });
    if (done.userId) {
      await this.notifications
        ?.notify(done.userId, 'REFUND_BANK_COMPLETED', {
          order_code: done.orderCode,
          amount: formatVnd(done.amount),
          bank: maskedBank(done),
          bank_ref: bankRef,
        })
        .catch(() => undefined);
    }
    return done;
  }

  /** Vì sao khoản không còn chuyển khoản được — nói rõ để admin biết có nên chuyển tiền hay không. */
  private async notTransferableReason(id: string, adminId: string): Promise<string> {
    const now = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!now) return 'Không tìm thấy khoản hoàn tiền.';
    if (now.method === 'WALLET') {
      const at = now.completedAt ? ` lúc ${formatVnDateTime(now.completedAt)}` : '';
      return `Khách đã chọn nhận khoản này về Ví Tubu${at} và đã được cộng ${formatVnd(now.amount)} — KHÔNG chuyển khoản. Nếu đã lỡ chuyển, liên hệ khách để thu hồi.`;
    }
    if (now.status === 'COMPLETED') return `Khoản này đã được xác nhận chuyển khoản${now.bankRef ? ` (mã GD ${now.bankRef})` : ''}.`;
    if (now.status === 'UNVERIFIED') {
      return 'Khoản này chưa được xác nhận là tiền khách trả dư — đối chiếu sao kê rồi bấm "Xác nhận tiền dư" trước khi chuyển khoản.';
    }
    if (now.status === 'DISMISSED') return 'Khoản này đã được đánh dấu "Không phải tiền dư" — KHÔNG chuyển khoản.';
    if (now.status === 'PROCESSING' && now.claimedBy !== adminId) {
      const holder = now.claimedBy ? (await this.adminNames([now.claimedBy])).get(now.claimedBy) : undefined;
      return `Khoản này đang được ${holder ?? 'một quản trị viên khác'} chuyển khoản.`;
    }
    return 'Khoản hoàn vừa thay đổi — vui lòng tải lại.';
  }

  /**
   * Admin đã đối chiếu sao kê khoản dư Pancake báo (UNVERIFIED): khoản thành khoản chờ chuyển khoản thường (PENDING) — khách
   * mới thấy và được báo để chọn Ví hay ngân hàng. `amount` = số dư thực nhận trên sao kê (mặc định số Pancake báo, không
   * vượt số đó); phần còn lại ghi thành khoản đã bỏ qua để tổng các khoản dư vẫn bằng số Pancake đã báo (báo lại không đẻ
   * khoản mới). Guard UNVERIFIED trong câu ghi: hai admin bấm cùng lúc (xác nhận / bỏ qua) chỉ một người thắng.
   */
  async verifyOverpayment(adminId: string, id: string, input: { amount?: number; note?: string }) {
    const row = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy khoản hoàn tiền.');
    if (row.kind !== 'OVERPAYMENT' || row.status !== 'UNVERIFIED') {
      throw new BadRequestException('Khoản này không còn chờ đối soát — vui lòng tải lại.');
    }
    const amount = input.amount ?? row.amount;
    if (!Number.isInteger(amount) || amount <= 0 || amount > row.amount) {
      throw new BadRequestException(`Số tiền dư thực nhận phải từ 1đ đến ${formatVnd(row.amount)} (số Pancake báo dư).`);
    }
    const note = input.note?.trim() || null;
    const won = await this.prisma.$transaction(async (tx) => {
      const res = await tx.orderCustomerRefund.updateMany({
        where: { id, kind: 'OVERPAYMENT', status: 'UNVERIFIED' },
        data: { status: 'PENDING', amount, adminNote: note },
      });
      if (res.count === 0) return false;
      if (amount < row.amount) {
        await tx.orderCustomerRefund.createMany({
          data: [
            {
              orderId: row.orderId,
              orderCode: row.orderCode,
              kind: 'OVERPAYMENT',
              refKey: `${row.refKey}:rest`,
              userId: row.userId,
              phone: row.phone,
              recipientName: row.recipientName,
              amount: row.amount - amount,
              method: 'MANUAL_TRANSFER',
              status: 'DISMISSED',
              reason: row.reason,
              completedBy: adminId,
              completedAt: new Date(),
              adminNote: `Phần Pancake báo dư nhưng sao kê không có (xác nhận ${formatVnd(amount)}/${formatVnd(row.amount)}).`,
            },
          ],
          skipDuplicates: true,
        });
      }
      const partial = amount < row.amount ? ` (Pancake báo ${formatVnd(row.amount)})` : '';
      await this.recordOrderNote(
        tx,
        adminId,
        row.orderId,
        `Xác nhận tiền trả dư ${formatVnd(amount)}${partial} sau khi đối chiếu sao kê${note ? ` · ${note}` : ''}`,
      );
      return true;
    });
    if (!won) throw new BadRequestException('Khoản này không còn chờ đối soát — admin khác vừa xử lý, vui lòng tải lại.');
    this.logger.log(`Admin ${adminId} xác nhận tiền trả dư ${amount}đ đơn ${row.orderCode} (khoản ${id}).`);
    if (row.userId) {
      await this.notifications
        ?.notify(row.userId, 'REFUND_OVERPAYMENT', { order_code: row.orderCode, amount: formatVnd(amount) })
        .catch(() => undefined);
    }
    return this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id } });
  }

  /** Không phải tiền khách trả dư (cùng một lần chuyển, nhân viên sửa đơn trên Pancake…): đóng khoản, không báo khách. */
  async dismissOverpayment(adminId: string, id: string, input: { reason: string }) {
    const reason = input.reason?.trim() ?? '';
    const row = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy khoản hoàn tiền.');
    if (row.kind !== 'OVERPAYMENT' || row.status !== 'UNVERIFIED') {
      throw new BadRequestException('Khoản này không còn chờ đối soát — vui lòng tải lại.');
    }
    if (reason.length < DISMISS_REASON_MIN) {
      throw new BadRequestException(`Ghi lý do (ít nhất ${DISMISS_REASON_MIN} ký tự) vì sao đây không phải tiền khách trả dư.`);
    }
    const won = await this.prisma.$transaction(async (tx) => {
      const res = await tx.orderCustomerRefund.updateMany({
        where: { id, kind: 'OVERPAYMENT', status: 'UNVERIFIED' },
        data: { status: 'DISMISSED', adminNote: reason, completedBy: adminId, completedAt: new Date() },
      });
      if (res.count === 0) return false;
      await this.recordOrderNote(tx, adminId, row.orderId, `Không phải tiền trả dư ${formatVnd(row.amount)} (Pancake báo). Lý do: ${reason}`);
      return true;
    });
    if (!won) throw new BadRequestException('Khoản này không còn chờ đối soát — admin khác vừa xử lý, vui lòng tải lại.');
    this.logger.log(`Admin ${adminId} bỏ qua khoản dư ${row.amount}đ đơn ${row.orderCode} (khoản ${id}): ${reason}`);
    return this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id } });
  }

  /** Các khoản hoàn của chính khách (mọi đơn hoặc một đơn) — hiện ở chi tiết đơn. */
  async listMine(userId: string, orderId?: string): Promise<MyRefundView[]> {
    const rows = await this.prisma.orderCustomerRefund.findMany({
      where: { userId, ...(orderId ? { orderId } : {}), status: { in: CUSTOMER_VISIBLE } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: MINE_SELECT,
    });
    return rows.map((r) => ({
      ...r,
      canChooseDestination: r.method === 'MANUAL_TRANSFER' && r.status === 'PENDING',
    }));
  }

  /** Tài khoản khách dùng gần nhất (khoản hoàn, yêu cầu trả, lệnh rút Ví) — để khách chọn lại thay vì gõ lại. */
  async lastBankDetails(userId: string): Promise<BankDetails | null> {
    const [refund, ret, payout] = await Promise.all([
      this.prisma.orderCustomerRefund.findFirst({
        where: { userId, bankAccountNo: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { bankName: true, bankAccountNo: true, bankAccountName: true, createdAt: true },
      }),
      this.prisma.returnRequest.findFirst({
        where: { userId, bankAccountNo: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { bankName: true, bankAccountNo: true, bankAccountName: true, createdAt: true },
      }),
      this.prisma.payout.findFirst({
        where: { userId, method: 'BANK' },
        orderBy: { requestedAt: 'desc' },
        select: { bankInfo: true, requestedAt: true },
      }),
    ]);
    const candidates: (BankDetails & { at: Date })[] = [];
    for (const r of [refund, ret]) {
      if (r?.bankAccountNo) {
        candidates.push({ bankName: r.bankName ?? '', accountNumber: r.bankAccountNo, accountName: r.bankAccountName ?? '', at: r.createdAt });
      }
    }
    const info = payout?.bankInfo as { bankName?: unknown; accountNumber?: unknown; accountName?: unknown } | null | undefined;
    if (payout && info && typeof info.accountNumber === 'string' && info.accountNumber) {
      candidates.push({
        bankName: typeof info.bankName === 'string' ? info.bankName : '',
        accountNumber: info.accountNumber,
        accountName: typeof info.accountName === 'string' ? info.accountName : '',
        at: payout.requestedAt,
      });
    }
    const best = candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return best ? { bankName: best.bankName, accountNumber: best.accountNumber, accountName: best.accountName } : null;
  }

  /**
   * Khách chọn (hoặc đổi) nơi nhận một khoản còn chờ chuyển khoản: Ví Tubu (cộng ngay, khoản đóng) hoặc tài khoản
   * ngân hàng (ghi tài khoản, admin chuyển). Guard (PENDING, MANUAL_TRANSFER) trong cùng câu ghi: admin vừa xác nhận
   * đã chuyển thì lần chọn Ví thua, không cộng tiền lần hai.
   */
  async chooseDestination(
    userId: string,
    id: string,
    input: { refundMethod: 'WALLET' | 'BANK'; bankName?: string; accountNumber?: string; accountName?: string },
  ): Promise<MyRefundView> {
    const row = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (!row || row.userId !== userId || !CUSTOMER_VISIBLE.includes(row.status)) throw new NotFoundException('Không tìm thấy khoản hoàn tiền.');
    if (row.method === 'MANUAL_TRANSFER' && row.status === 'PROCESSING') {
      throw new BadRequestException(`Tubu đang chuyển khoản khoản này về ${maskedBank(row)} nên không đổi được nơi nhận nữa.`);
    }
    if (row.method !== 'MANUAL_TRANSFER' || row.status !== 'PENDING') {
      throw new BadRequestException('Khoản hoàn này đã được xử lý, không đổi được nơi nhận nữa.');
    }

    if (input.refundMethod === 'WALLET') {
      const won = await this.prisma.$transaction(async (tx) => {
        const flip = await tx.orderCustomerRefund.updateMany({
          where: { id, userId, method: 'MANUAL_TRANSFER', status: 'PENDING' },
          data: { method: 'WALLET', status: 'COMPLETED', customerUserId: userId, completedAt: new Date() },
        });
        if (flip.count === 0) return false;
        await applyWalletDelta(tx, {
          userId,
          delta: row.amount,
          type: 'ORDER_REFUND',
          refType: 'CUSTOMER_REFUND',
          refId: id,
          reason: `Hoàn tiền đơn ${row.orderCode}`,
        });
        return true;
      });
      if (!won) throw new BadRequestException(await this.customerLostReason(id));
      await this.notifications
        ?.notify(userId, 'REFUND_WALLET_CREDITED', { order_code: row.orderCode, amount: formatVnd(row.amount) })
        .catch(() => undefined);
    } else {
      const bank = normalizeBankDetails(input);
      const res = await this.prisma.orderCustomerRefund.updateMany({
        where: { id, userId, method: 'MANUAL_TRANSFER', status: 'PENDING' },
        data: { bankName: bank.bankName, bankAccountNo: bank.accountNumber, bankAccountName: bank.accountName },
      });
      if (res.count === 0) throw new BadRequestException(await this.customerLostReason(id));
      await announceBankRefund(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { orderCode: row.orderCode, amount: row.amount, userId, bankName: bank.bankName, bankAccountNo: bank.accountNumber },
      );
    }
    const fresh = await this.prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id }, select: MINE_SELECT });
    return { ...fresh, canChooseDestination: fresh.method === 'MANUAL_TRANSFER' && fresh.status === 'PENDING' };
  }

  private async customerLostReason(id: string): Promise<string> {
    const now = await this.prisma.orderCustomerRefund.findUnique({ where: { id } });
    if (now?.method === 'MANUAL_TRANSFER' && now.status === 'PROCESSING') {
      return `Tubu đang chuyển khoản khoản này về ${maskedBank(now)} nên không đổi được nơi nhận nữa.`;
    }
    return 'Khoản hoàn này vừa được xử lý — vui lòng tải lại.';
  }
}
