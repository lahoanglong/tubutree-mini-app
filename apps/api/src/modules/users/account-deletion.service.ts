import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatPoints } from '../../common/format-points';
import { formatVndText as vnd } from '../../common/format-vnd';
import { recordUserAdminEvent } from '../../common/user-admin-events';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionStateService } from '../auth/session-state.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { SystemConfigService } from '../system-config/system-config.service';
import type { SettlementConfig } from '../merchant/merchant-fulfilment.service';

/** Mã lỗi ổn định để admin UI nhận diện (message tiếng Việt có thể đổi câu chữ). */
export const ACCOUNT_DELETION_BLOCKED = 'ACCOUNT_DELETION_BLOCKED';
export const ANONYMIZED_NAME = 'Người dùng đã xoá';

export type DeletionBlockerCode =
  | 'PRIVILEGED_ROLE'
  | 'WALLET_BALANCE'
  | 'CONVERTED_POINTS'
  | 'CASHBACK_PENDING'
  | 'ORDER_IN_PROGRESS'
  | 'ORDER_RETURN_WINDOW'
  | 'PAYOUT_PENDING'
  | 'RETURN_PENDING'
  | 'CUSTOMER_REFUND_PENDING'
  | 'SUBSCRIPTION_ACTIVE'
  | 'COMMISSION_UNPAID'
  | 'DEALER_CREDIT'
  | 'PARTNER_STORE_OPEN'
  | 'WASTE_REQUEST_OPEN'
  | 'WASTE_UNDER_REVIEW';

export interface DeletionBlocker {
  code: DeletionBlockerCode;
  message: string;
}

/**
 * Cổng tới MerchantFulfilmentService (cùng danh sách vướng mắc với thu hồi đại lý): khai báo ở đây và cấp qua token để service này không
 * import MerchantFulfilmentService (đồ thị import của nó vòng lại hằng ANONYMIZED_NAME bên dưới).
 */
export const PARTNER_STORE_BLOCKERS = Symbol('PARTNER_STORE_BLOCKERS');
export interface PartnerStoreBlockersPort {
  settlementConfig(): Promise<SettlementConfig>;
  lockOwnerStores(tx: Db, ownerUserId: string): Promise<void>;
  ownerPartnerBlockers(db: Db, ownerUserId: string, cfg: SettlementConfig): Promise<string[]>;
}

export type DeletionListStatus = 'PENDING' | 'RESOLVED' | 'ALL';

type Db = Prisma.TransactionClient;

type BlockerUser = {
  id: string;
  role: string;
  walletBalance: number;
  pointsConvertedBalance: number;
  cashbackPending: number;
};

/** "HH:mm ngày dd/MM/yyyy" theo giờ Việt Nam (không dùng toLocale*: định dạng đổi theo bản ICU). */
function vnDateTimeLabel(d: Date): string {
  const v = new Date(d.getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())} ngày ${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
}

const OPEN_ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'] as const;

/** Deadlock (40P01) / tuần tự hoá (40001, Prisma P2034): tx đã rollback, chạy lại an toàn. */
function isRetryableTxError(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string } } | null;
  return e?.code === 'P2034' || e?.code === '40001' || e?.code === '40P01' || e?.meta?.code === '40001' || e?.meta?.code === '40P01';
}

/**
 * C-016 / A1-017: xử lý yêu cầu xoá tài khoản bằng ẨN DANH chứ không xoá cứng — đơn, hoa hồng, sổ Ví,
 * lệnh rút, công nợ đại lý là chứng từ kế toán/thuế phải giữ và đang trỏ khoá ngoại về users. Chỉ thay
 * các trường nhận diện được con người (tên, SĐT, email, ngày sinh, ảnh, zaloId, địa chỉ, CCCD, tài khoản
 * ngân hàng gian hàng) và khoá đăng nhập.
 * Cố ý GIỮ: lệnh rút (Payout.bankInfo) và hoàn tiền đơn (OrderCustomerRefund) vì là chứng từ chi tiền
 * phải đối soát được; MST/tên công ty/địa chỉ trong yêu cầu hoá đơn vì hoá đơn VAT đã/sẽ xuất phải lưu
 * theo luật kế toán (chỉ bỏ email liên hệ).
 * isBlocked làm JwtStrategy từ chối access token đã cấp (trễ tối đa SessionStateService.TTL_MS) và chặn
 * cấp token mới; refresh token bị thu hồi.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(PARTNER_STORE_BLOCKERS) private readonly partnerStores?: PartnerStoreBlockersPort,
    @Optional() private readonly sessions?: SessionStateService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /** `returns.window_days` (cùng khoá, mặc định 7 và cách xử lý giá trị sai như OrdersReturns / LoyaltyService.returnWindowDays). */
  private async returnWindowDays(): Promise<number> {
    const v = Number((await this.config?.get<number>('returns.window_days', 7)) ?? 7);
    return Number.isFinite(v) && v >= 0 ? v : 7;
  }

  async list(status: DeletionListStatus = 'PENDING') {
    const requests = await this.prisma.accountDeletionRequest.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 100,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(requests.map((r) => r.userId))] } },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        walletBalance: true,
        pointsConvertedBalance: true,
        cashbackPending: true,
        createdAt: true,
      },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const pendingUsers = users.filter((u) => requests.some((r) => r.userId === u.id && r.status === 'PENDING'));
    const partnerCfg = pendingUsers.length > 0 ? await this.partnerStores?.settlementConfig() : undefined;
    // Yêu cầu PENDING mới nhất của mỗi khách (danh sách đã sắp theo thời gian, nên lấy dòng mới nhất bất kể chiều sắp).
    const latestPending = new Map<string, (typeof requests)[number]>();
    for (const r of requests) {
      if (r.status !== 'PENDING') continue;
      const cur = latestPending.get(r.userId);
      if (!cur || r.createdAt > cur.createdAt) latestPending.set(r.userId, r);
    }
    const consents = new Map([...latestPending].map(([uid, r]) => [uid, r.walletForfeitAmount]));
    const windowDays = pendingUsers.length > 0 ? await this.returnWindowDays() : 7;
    const blockers = pendingUsers.length > 0 ? await this.collectBlockers(this.prisma, pendingUsers, consents, windowDays, partnerCfg) : new Map();
    return requests.map((r) => ({
      ...r,
      user: byId.get(r.userId) ?? null,
      blockers: r.status === 'PENDING' ? (blockers.get(r.userId) ?? []) : [],
    }));
  }

  /**
   * Idempotent: yêu cầu đã RESOLVED thì trả `alreadyProcessed: true`, không chạy lại. Khoá dòng yêu
   * cầu, các đơn của khách, gian hàng của khách (thu hồi/duyệt đại lý cũng khoá gian hàng trước users) rồi dòng user (FOR UPDATE) để 2 admin cùng bấm thì người sau chờ và thấy RESOLVED, còn các ghi
   * tiền vào users (vd cộng Ví) phải chờ lần kiểm số dư này xong.
   * Chạy lại một lần khi gặp deadlock: gộp phiên khách vào chính khách này commit xen giữa (chuyển thêm đơn sang khách sau
   * lúc tx này đã khoá đơn) cùng một lần cộng điểm đang giữ đơn mới đó thì lần ẩn danh đơn có thể chờ vòng (40P01). Lần
   * chạy lại khoá đủ đơn ngay từ đầu.
   */
  async process(requestId: string, adminId: string, adminNote?: string) {
    let result;
    try {
      result = await this.processOnce(requestId, adminId, adminNote);
    } catch (err) {
      if (!isRetryableTxError(err)) throw err;
      this.logger.warn(`Yêu cầu xoá ${requestId}: xung đột giao dịch (${(err as Error).message}), chạy lại một lần.`);
      result = await this.processOnce(requestId, adminId, adminNote);
    }
    // Bộ nhớ đệm phiên (SessionStateService, TTL 5 giây) còn coi chủ vừa bị ẩn danh là đang đăng nhập: cắt ngay như khoá tài khoản.
    this.sessions?.invalidate(result.userId);
    return result;
  }

  private async processOnce(requestId: string, adminId: string, adminNote?: string) {
    // Đọc cấu hình đối soát trước khi mở tx (SystemConfigService đọc qua pool, không đọc trong lúc giữ tx), như setUserRole.
    const partnerCfg = await this.partnerStores?.settlementConfig();
    const windowDays = await this.returnWindowDays();
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "account_deletion_requests" WHERE "id" = ${requestId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Không tìm thấy yêu cầu xoá tài khoản.');
      const request = await tx.accountDeletionRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (request.status === 'RESOLVED') {
        return { alreadyProcessed: true, requestId, userId: request.userId, reviewedAt: request.reviewedAt };
      }

      // Khoá tư vấn chủ rồi khoá phiếu từng gian hàng của chủ TRƯỚC mọi khoá dòng (cùng thứ tự với thu hồi đại lý): lập phiếu đối soát
      // đang chạy phải xong trước lần kiểm vướng mắc đối tác bên dưới, và không phiếu nào chen vào sau lần kiểm.
      if (this.partnerStores) await this.partnerStores.lockOwnerStores(tx, request.userId);
      // Đơn của khách trước dòng users, cùng chiều với cộng điểm lúc giao / duyệt trả / gộp phiên khách (đơn → users): ẩn danh
      // bên dưới ghi lại các đơn này, khoá users trước thì đợi lần cộng điểm đang giữ đơn trong khi nó đợi users ⇒ 40P01.
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "userId" = ${request.userId} ORDER BY "id" FOR NO KEY UPDATE`;
      // Gian hàng của chủ trước dòng users: thu hồi vai trò đại lý khoá gian hàng rồi mới ghi users, khoá ngược chiều thì deadlock (40P01).
      // NO KEY UPDATE (không phải FOR UPDATE): đặt đơn qua slug gian hàng của chính chủ giữ KEY SHARE users rồi KEY SHARE gian hàng
      // (khoá ngoại orders); FOR UPDATE đợi KEY SHARE ấy trong lúc nó đợi users FOR UPDATE ở dưới ⇒ 40P01. Ẩn danh chỉ sửa cột không phải
      // khoá của gian hàng, và NO KEY UPDATE vẫn xung đột với FOR UPDATE/NO KEY UPDATE của thu hồi và duyệt nên thứ tự giữa chúng không đổi.
      await tx.$queryRaw`SELECT "id" FROM "storefronts" WHERE "ownerUserId" = ${request.userId} ORDER BY "id" FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${request.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: request.userId } });
      const now = new Date();

      if (user) {
        const consents = new Map([[user.id, request.walletForfeitAmount]]);
        const blockers = (await this.collectBlockers(tx, [user], consents, windowDays, partnerCfg)).get(user.id) ?? [];
        if (blockers.length > 0) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: ACCOUNT_DELETION_BLOCKED,
            message: `Chưa thể xoá tài khoản: ${blockers.map((b) => b.message).join('; ')}.`,
            blockers,
          });
        }
        if (user.walletBalance > 0) await this.forfeitWallet(tx, user.id, user.walletBalance, request, adminId);
        await this.anonymize(tx, user.id, requestId, now);
      } else {
        this.logger.warn(`Yêu cầu xoá ${requestId}: không còn user ${request.userId}, chỉ đóng yêu cầu.`);
      }

      const note = adminNote?.trim() || null;
      await tx.accountDeletionRequest.updateMany({
        where: { userId: request.userId, status: 'PENDING' },
        data: { status: 'RESOLVED', reviewedBy: adminId, reviewedAt: now, adminNote: note },
      });
      return { alreadyProcessed: false, requestId, userId: request.userId, reviewedAt: now };
    });
  }

  /** Gom bằng groupBy (cố định 10 truy vấn) thay vì 10 truy vấn × mỗi dòng: danh sách admin tới 100 dòng. */
  private async collectBlockers(
    db: Db,
    users: BlockerUser[],
    consents: Map<string, number | null>,
    windowDays: number,
    partnerCfg?: SettlementConfig,
  ): Promise<Map<string, DeletionBlocker[]>> {
    const ids = users.map((u) => u.id);
    // Chủ gian hàng đối tác (MERCHANT, hoặc CTV có cờ) còn việc dở thì ẩn danh để lại đơn không ai xử lý và đối soát không có tài khoản nhận tiền.
    const partnerOpen = new Map<string, string[]>();
    if (this.partnerStores && partnerCfg) {
      for (const id of ids) {
        const open = await this.partnerStores.ownerPartnerBlockers(db, id, partnerCfg);
        if (open.length) partnerOpen.set(id, open);
      }
    }
    // Đơn đã giao còn trong hạn đổi/trả: Pancake báo RETURNED hay admin duyệt trả vẫn hoàn tiền về Ví khách sau khi tài khoản đã ẩn danh.
    const windowCutoff = new Date(Date.now() - windowDays * 864e5);
    const [orders, payouts, returns, refunds, subs, commissions, cashbackTxns, dealerCredit, wasteOpen, wasteFlags, deliveredInWindow] = await Promise.all([
      db.order.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: [...OPEN_ORDER_STATUSES] } },
        _count: { _all: true },
      }),
      db.payout.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: ['REQUESTED', 'APPROVED'] } },
        _count: { _all: true },
      }),
      db.returnRequest.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: 'REQUESTED' },
        _count: { _all: true },
      }),
      db.orderCustomerRefund.findMany({
        where: { status: { in: ['PENDING', 'PROCESSING'] }, OR: [{ customerUserId: { in: ids } }, { order: { userId: { in: ids } } }] },
        select: { customerUserId: true, order: { select: { userId: true } } },
      }),
      db.subscription.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: ['ACTIVE', 'PAUSED'] } },
        _count: { _all: true },
      }),
      db.commission.groupBy({
        by: ['affiliateUserId'],
        where: {
          affiliateUserId: { in: ids },
          OR: [{ status: { in: ['PENDING', 'LOCKED'] } }, { status: 'APPROVED', payoutBatchId: null }],
        },
        _count: { _all: true },
      }),
      db.cashbackTransaction.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: ['PENDING', 'CONFIRMED'] } },
        _count: { _all: true },
      }),
      db.dealerCreditLedger.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _sum: { delta: true } }),
      db.wasteRequest.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] } },
        _count: { _all: true },
      }),
      db.wasteUserFlags.findMany({
        where: { userId: { in: ids }, OR: [{ blockedAt: { not: null } }, { shipLockedAt: { not: null } }] },
        select: { userId: true },
      }),
      db.order.findMany({
        where: {
          userId: { in: ids },
          status: 'DELIVERED',
          OR: [{ deliveredAt: { gt: windowCutoff } }, { deliveredAt: null, updatedAt: { gt: windowCutoff } }],
        },
        select: { userId: true, deliveredAt: true, updatedAt: true },
      }),
    ]);
    const returnWindow = new Map<string, { latestExpiry: Date }>();
    for (const o of deliveredInWindow) {
      const expiry = new Date((o.deliveredAt ?? o.updatedAt).getTime() + windowDays * 864e5);
      const cur = returnWindow.get(o.userId);
      returnWindow.set(o.userId, { latestExpiry: cur && cur.latestExpiry > expiry ? cur.latestExpiry : expiry });
    }

    const countBy = <K extends string>(rows: ({ _count: { _all: number } } & Record<K, string>)[], key: K) =>
      new Map(rows.map((r) => [r[key], r._count._all]));
    const orderN = countBy(orders, 'userId');
    const payoutN = countBy(payouts, 'userId');
    const returnN = countBy(returns, 'userId');
    const subN = countBy(subs, 'userId');
    const commissionN = countBy(commissions, 'affiliateUserId');
    const cashbackN = countBy(cashbackTxns, 'userId');
    const wasteOpenN = countBy(wasteOpen, 'userId');
    const wasteReview = new Set(wasteFlags.map((f) => f.userId));
    const creditSum = new Map(dealerCredit.map((r) => [r.userId, r._sum.delta ?? 0]));
    const refundN = new Map<string, number>();
    for (const r of refunds) {
      for (const uid of new Set([r.customerUserId, r.order.userId])) {
        if (uid && ids.includes(uid)) refundN.set(uid, (refundN.get(uid) ?? 0) + 1);
      }
    }

    const result = new Map<string, DeletionBlocker[]>();
    for (const user of users) {
      const out: DeletionBlocker[] = [];
      const add = (code: DeletionBlockerCode, message: string) => out.push({ code, message });
      const n = (m: Map<string, number>) => m.get(user.id) ?? 0;
      if (user.role === 'ADMIN' || user.role === 'STAFF') {
        add('PRIVILEGED_ROLE', 'tài khoản đang có quyền quản trị/nhân viên, cần gỡ quyền trước');
      }
      if (user.walletBalance > 0) {
        const agreed = consents.get(user.id) ?? null;
        if (agreed === null) {
          add('WALLET_BALANCE', `Ví Tubu còn ${vnd(user.walletBalance)} mà khách chưa đồng ý bỏ số dư, khách cần gửi lại yêu cầu xoá và đồng ý`);
        } else if (agreed !== user.walletBalance) {
          add(
            'WALLET_BALANCE',
            `Ví Tubu đã đổi từ ${vnd(agreed)} (số khách đồng ý bỏ) thành ${vnd(user.walletBalance)}, khách cần xác nhận lại khi gửi yêu cầu xoá`,
          );
        }
      }
      if (user.walletBalance < 0) add('WALLET_BALANCE', `Ví Tubu đang âm ${vnd(-user.walletBalance)}, cần đối soát trước`);
      // Q-03a: lô quy đổi là tiền trả trước nhưng không quy ra tiền được, nên không có cách tất toán
      // nào khác ngoài để khách tiêu hết (OQ-14).
      if (user.pointsConvertedBalance > 0) {
        add('CONVERTED_POINTS', `còn ${formatPoints(user.pointsConvertedBalance)} Điểm Xanh không hết hạn chưa dùng`);
      }
      if (user.cashbackPending > 0 || n(cashbackN) > 0) add('CASHBACK_PENDING', 'còn khoản hoàn tiền mua sắm đang chờ');
      if (n(orderN) > 0) add('ORDER_IN_PROGRESS', `còn ${n(orderN)} đơn hàng chưa hoàn tất (chờ thanh toán/đang xử lý/đang giao)`);
      const rw = returnWindow.get(user.id);
      if (rw) {
        add(
          'ORDER_RETURN_WINDOW',
          `khách còn đơn trong hạn đổi/trả, xoá được từ ${vnDateTimeLabel(rw.latestExpiry)}`,
        );
      }
      if (n(payoutN) > 0) add('PAYOUT_PENDING', `còn ${n(payoutN)} yêu cầu rút tiền chờ xử lý`);
      if (n(returnN) > 0) add('RETURN_PENDING', `còn ${n(returnN)} yêu cầu đổi trả chờ duyệt`);
      if (n(refundN) > 0) add('CUSTOMER_REFUND_PENDING', `còn ${n(refundN)} khoản hoàn tiền đơn chưa chuyển`);
      if (n(subN) > 0) add('SUBSCRIPTION_ACTIVE', `còn ${n(subN)} gói giao định kỳ đang chạy hoặc tạm dừng`);
      if (n(commissionN) > 0) add('COMMISSION_UNPAID', `còn ${n(commissionN)} khoản hoa hồng chưa chuyển vào Ví Tubu, khách cần chuyển hoa hồng vào Ví trước (khoản đang chờ duyệt thì đợi duyệt xong)`);
      if (n(wasteOpenN) > 0) add('WASTE_REQUEST_OPEN', `còn ${n(wasteOpenN)} yêu cầu Đổi rác chưa xong (đang chờ mang tới, đang gửi hoặc đang chờ đếm)`);
      if (wasteReview.has(user.id)) add('WASTE_UNDER_REVIEW', 'Tài khoản đang được Tubu xem xét, liên hệ CSKH');
      const credit = creditSum.get(user.id) ?? 0;
      const partnerN = partnerOpen.get(user.id);
      if (partnerN) add('PARTNER_STORE_OPEN', `gian hàng đối tác còn vướng: ${partnerN.join('; ')}`);
      if (credit !== 0) add('DEALER_CREDIT', `công nợ đại lý chưa tất toán (${credit < 0 ? '-' : ''}${vnd(Math.abs(credit))})`);
      result.set(user.id, out);
    }
    return result;
  }

  /**
   * Số dư Ví khách đã thấy và đồng ý bỏ (blocker đã đảm bảo bằng đúng số khách đồng ý) bị trừ về 0 bằng một dòng ADJUST ngay trong
   * giao dịch ẩn danh, kèm dòng sổ việc admin; refId = mã yêu cầu nên xử lý lặp không trừ lần hai.
   */
  private async forfeitWallet(
    tx: Db,
    userId: string,
    balance: number,
    request: { id: string; walletForfeitConsentAt: Date | null },
    adminId: string,
  ) {
    const consentAt = request.walletForfeitConsentAt?.toISOString() ?? 'không rõ';
    const reason = `Xoá tài khoản: khách đã đồng ý bỏ số dư Ví ${vnd(balance)} (đồng ý lúc ${consentAt}, yêu cầu ${request.id})`;
    await applyWalletDelta(tx, {
      userId,
      delta: -balance,
      type: 'ADJUST',
      refType: 'ACCOUNT_DELETION',
      refId: request.id,
      reason,
    });
    await recordUserAdminEvent(tx, { userId, kind: 'WALLET_FORFEIT', from: String(balance), to: '0', reason, actorId: adminId });
  }

  private async anonymize(tx: Db, userId: string, requestId: string, now: Date) {
    await tx.user.update({
      where: { id: userId },
      data: {
        fullName: ANONYMIZED_NAME,
        phone: null,
        email: null,
        dob: null,
        avatarUrl: null,
        personalTaxId: null,
        zaloId: null,
        zaloAccessToken: null,
        zaloRefreshToken: null,
        isBlocked: true,
        // Link/mã giới thiệu cũ còn lưu ngoài kia sẽ tiếp tục ghi công (tạo hoa hồng PENDING không ai
        // nhận được) nếu giữ mã; đổi sang mã ngẫu nhiên không đoán được để mọi tra cứu theo mã cũ trượt.
        referralCode: `DEL${randomBytes(8).toString('hex').toUpperCase()}`,
        metadata: { anonymizedAt: now.toISOString(), deletionRequestId: requestId },
      },
    });
    await tx.referralTouch.updateMany({ where: { referrerUserId: userId, expiresAt: { gt: now } }, data: { expiresAt: now } });
    // Giữ dòng địa chỉ (gói định kỳ đã huỷ vẫn trỏ FK RESTRICT tới) nhưng xoá phần nhận diện; tỉnh/huyện
    // giữ lại vì đơn cũ và thống kê vùng giao còn dùng, một mình chúng không chỉ ra được ai.
    await tx.address.updateMany({ where: { userId }, data: { recipient: ANONYMIZED_NAME, phone: '', street: '' } });
    await tx.$executeRaw`
      UPDATE "orders"
      SET "shippingAddress" = "shippingAddress" || jsonb_build_object('recipient', ${ANONYMIZED_NAME}::text, 'phone', '', 'street', '')
      WHERE "userId" = ${userId} AND jsonb_typeof("shippingAddress") = 'object'`;
    await tx.order.updateMany({ where: { userId }, data: { note: null, recyclingNote: null } });
    await tx.$executeRaw`
      UPDATE "orders" SET "invoiceRequest" = "invoiceRequest" - 'email'
      WHERE "userId" = ${userId} AND jsonb_typeof("invoiceRequest") = 'object'`;
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.dealerApplication.updateMany({
      where: { userId },
      data: { ownerName: ANONYMIZED_NAME, phone: '', address: '', cccdFrontUrl: '', cccdBackUrl: '', storeFrontUrl: null },
    });
    await tx.storefront.updateMany({
      where: { ownerUserId: userId },
      data: {
        isPublished: false,
        title: ANONYMIZED_NAME,
        headerNote: null,
        avatarUrl: null,
        coverUrl: null,
        bankName: null,
        bankBin: null,
        bankAccountNo: null,
        bankAccountName: null,
        warehouseAddress: null,
        warehousePhone: null,
      },
    });
    // Chat CSKH chứa tin nhắn tự do (SĐT, địa chỉ khách tự gõ) nên xoá hẳn thay vì ẩn danh. Khoá cùng khoá advisory với lượt chuyển tin
    // để một lượt đang nhận tin xong rồi mới xoá; khoá này không đòi dòng users nên không tạo vòng chờ với khoá users ở trên.
    const conv = await tx.supportConversation.findUnique({ where: { userId }, select: { id: true, code: true } });
    if (conv) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support-chat-forward:${conv.id}`}))`;
      await tx.supportMessage.deleteMany({ where: { conversationId: conv.id } });
      await tx.supportForward.deleteMany({ where: { conversationId: conv.id } });
      // Mã nghỉ: trả lời muộn trong nhóm Zalo cho mã này không được rơi vào khách mới.
      await tx.supportRetiredCode.upsert({ where: { code: conv.code }, create: { code: conv.code }, update: {} });
      await tx.supportConversation.delete({ where: { id: conv.id } });
    }
  }
}
