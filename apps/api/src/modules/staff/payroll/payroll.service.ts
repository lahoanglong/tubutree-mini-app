import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { buildVietQrPayload } from '../../integrations/payment/vietqr';
import { computeDayPay, sumWorkedMinutes, type ShiftWindow } from './payroll.calc';
import { formatVnDateTime } from '../../../common/vn-time';
import { formatVnd } from '../../orders/refund-destination';

/** Khoản điều chỉnh tay giống hệt khoản vừa ghi trong 5 phút: chưa ghi, admin xác nhận (allowDuplicate) thì ghi thêm. */
export const PAYROLL_ADJUST_DUPLICATE = 'PAYROLL_ADJUST_DUPLICATE';

type Db = PrismaService | Prisma.TransactionClient;

export interface BankInput {
  bankBin?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  qrImageUrl?: string;
}

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Mọi thao tác ghi bảng lương của MỘT tháng (tính lại ngày/tháng, chốt, đã chi, và ghi dữ liệu đầu vào như khoản điều
   * chỉnh, phiên chấm công) chạy tuần tự dưới khoá advisory theo (nhân viên, năm, tháng), và đọc dữ liệu NGAY TRONG khoá.
   * Không khoá thì một recompute đọc dữ liệu cũ có thể ghi đè net của tháng vừa được chốt/đã chi, và một khoản ghi đã qua
   * kiểm tháng OPEN vẫn có thể lọt vào tháng vừa thành PAID.
   */
  private withMonthLock<T>(staffId: string, year: number, month: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const key = `payroll:${staffId}:${year}-${month}`;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        return fn(tx);
      },
      // Tháng 26 ngày công là vài trăm truy vấn: nới hạn 5s mặc định của Prisma.
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  private monthRange(year: number, month: number) {
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
  }

  private effWindow(shift: { startAt: Date; endAt: Date; approvedStart: Date | null; approvedEnd: Date | null }) {
    return { effStart: shift.approvedStart ?? shift.startAt, effEnd: shift.approvedEnd ?? shift.endAt };
  }

  /** Tạo phạt tự động (idempotent theo shiftId+type): trễ (late_fine) & huỷ trễ (1h công=rate). */
  async ensureFines(staffId: string, workDate: Date, rate: number, db: Db = this.prisma) {
    const shifts = await db.shift.findMany({
      where: { staffId, workDate },
      select: { id: true, cancelPenalty: true, sessions: { select: { isLate: true } } },
    });
    const lateFine = await this.config.get<number>('attendance.late_fine', 10000);
    for (const s of shifts) {
      const hasLate = s.sessions.some((x) => x.isLate);
      if (hasLate) await this.ensureAdjustment(db, staffId, workDate, s.id, 'LATE', lateFine, 'Đi trễ quá quy định');
      if (s.cancelPenalty)
        await this.ensureAdjustment(db, staffId, workDate, s.id, 'LATE_CANCEL', rate, 'Huỷ ca trễ (1h công)');
    }
  }

  private async ensureAdjustment(
    db: Db,
    staffId: string,
    workDate: Date,
    shiftId: string,
    type: 'LATE' | 'LATE_CANCEL',
    amount: number,
    reason: string,
  ) {
    // Khoá tháng (withMonthLock) là thứ tuần tự hoá các lượt tạo phạt; unique index (shiftId, type) chỉ là chốt chặn cuối.
    // skipDuplicates (ON CONFLICT DO NOTHING) để vi phạm unique không làm hỏng transaction của khoá tháng.
    const existing = await db.payrollAdjustment.findFirst({ where: { shiftId, type } });
    if (existing) {
      // Số tiền phạt huỷ ca = 1 GIỜ CÔNG, tức phụ thuộc đơn giá. Trước đây tạo một lần rồi
      // không bao giờ cập nhật: nhân viên mới chưa có hồ sơ lương thì rate = 0 → phiếu phạt
      // amount = 0 VĨNH VIỄN, sau này admin đặt đơn giá thật cũng không sửa được.
      if (existing.amount !== amount) {
        await db.payrollAdjustment.update({ where: { id: existing.id }, data: { amount } });
      }
      return;
    }
    await db.payrollAdjustment.createMany({
      data: [{ staffId, workDate, type, amount, reason, shiftId }],
      skipDuplicates: true,
    });
  }

  /**
   * Tính lại lương 1 ngày (workDate = midnight UTC của date-key VN).
   *
   * Đơn giá KHOÁ THEO NGÀY: nếu ngày đó đã có bản ghi lương thì giữ nguyên đơn giá đã lưu.
   * Trước đây luôn đọc hourlyRate hiện tại của hồ sơ, trong khi recomputeStaffMonth tính lại
   * MỌI ngày trong tháng — nên đổi đơn giá ngày 11 là tự động định giá lại cả 10 ngày đã làm
   * xong: tăng đơn giá thì trả dư, giảm thì ăn bớt lương của công đã bỏ ra. Chỉ cần nhân viên
   * mở màn "Lương của tôi" là recompute chạy, không ai bấm gì cả.
   *
   * `reprice` = quản lý CỐ Ý định giá lại (nút tính lại của tháng) — chỉ khi đó mới áp đơn giá
   * mới cho ngày cũ.
   */
  async recomputeDay(staffId: string, workDate: Date, opts: { reprice?: boolean } = {}) {
    return this.withMonthLock(staffId, workDate.getUTCFullYear(), workDate.getUTCMonth() + 1, (tx) =>
      this.recomputeDayIn(tx, staffId, workDate, opts),
    );
  }

  private async recomputeDayIn(
    db: Db,
    staffId: string,
    workDate: Date,
    opts: { reprice?: boolean; monthAlreadyChecked?: boolean } = {},
  ) {
    // Tháng đã chốt/đã trả thì KHÔNG ghi lại ngày: trước đây admin sửa giờ một phiên của tháng
    // đã chốt vẫn ghi đè PayrollDay trong khi PayrollMonth đứng yên — sheet chi tiết hiện đồng
    // thời số ngày MỚI và tổng tháng CŨ, và snackbar báo "đã tính lại" là nói sai.
    //
    // `monthAlreadyChecked`: recomputeStaffMonth đã kiểm trạng thái tháng MỘT LẦN ở đầu hàm rồi
    // mới lặp qua từng ngày — kiểm lại ở đây là thêm một truy vấn cho MỖI ngày công (một tháng
    // 26 ngày làm là 26 truy vấn thừa mỗi lần ai đó mở màn lương).
    if (!opts.monthAlreadyChecked && (await this.isMonthLocked(staffId, workDate, db))) {
      throw new BadRequestException('Tháng lương đã chốt/đã trả — mở lại tháng trước khi sửa.');
    }
    const [profile, existingDay] = await Promise.all([
      db.staffProfile.findUnique({ where: { userId: staffId } }),
      db.payrollDay.findUnique({ where: { staffId_workDate: { staffId, workDate } }, select: { hourlyRate: true } }),
    ]);
    const currentRate = profile?.hourlyRate ?? 0;
    // hourlyRate = 0 nghĩa là ngày đó tính khi hồ sơ chưa có đơn giá → không phải mốc đáng khoá.
    const rate = !opts.reprice && existingDay && existingDay.hourlyRate > 0 ? existingDay.hourlyRate : currentRate;
    await this.ensureFines(staffId, workDate, rate, db);

    const shifts = await db.shift.findMany({
      where: { staffId, workDate, status: 'APPROVED' },
      select: {
        startAt: true,
        endAt: true,
        approvedStart: true,
        approvedEnd: true,
        sessions: { select: { checkinAt: true, checkoutAt: true } },
      },
    });
    const windows: ShiftWindow[] = shifts.map((s) => ({ ...this.effWindow(s), sessions: s.sessions }));
    const minutes = sumWorkedMinutes(windows);
    const adjustments = await db.payrollAdjustment.findMany({
      where: { staffId, workDate },
      select: { amount: true },
    });
    const pay = computeDayPay(minutes, rate, adjustments);

    await db.payrollDay.upsert({
      where: { staffId_workDate: { staffId, workDate } },
      update: { workedMinutes: pay.workedMinutes, hourlyRate: rate, gross: pay.gross, fines: pay.fines, net: pay.net },
      create: { staffId, workDate, workedMinutes: pay.workedMinutes, hourlyRate: rate, gross: pay.gross, fines: pay.fines, net: pay.net },
    });
    return pay;
  }

  /**
   * Ghi dữ liệu đầu vào của một ngày công (phiên chấm công, khoản điều chỉnh) CÙNG khoá tháng với recompute/chốt/đã chi:
   * kiểm tháng chưa chốt, ghi, rồi tính lại ngày trong một transaction. Kiểm tháng ngoài khoá thì markPaid chen vào giữa
   * và dữ liệu mới nằm trong tháng PAID mà net không phản ánh. Tháng đã chốt/đã trả thì ném 400 trước khi ghi gì.
   */
  async writeInMonth<T>(
    staffId: string,
    workDate: Date,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
    lockedMessage = 'Tháng lương đã chốt/đã trả — mở lại tháng trước khi sửa.',
  ): Promise<T> {
    return this.withMonthLock(staffId, workDate.getUTCFullYear(), workDate.getUTCMonth() + 1, async (tx) => {
      if (await this.isMonthLocked(staffId, workDate, tx)) throw new BadRequestException(lockedMessage);
      const out = await write(tx);
      await this.recomputeDayIn(tx, staffId, workDate, { monthAlreadyChecked: true });
      return out;
    });
  }

  /** Tháng chứa `workDate` đã FINALIZED/PAID chưa (theo mốc VN — workDate là midnight UTC của date-key VN). */
  private async isMonthLocked(staffId: string, workDate: Date, db: Db = this.prisma): Promise<boolean> {
    const month = await db.payrollMonth.findUnique({
      where: {
        staffId_year_month: {
          staffId,
          year: workDate.getUTCFullYear(),
          month: workDate.getUTCMonth() + 1,
        },
      },
      select: { status: true },
    });
    return month?.status === 'FINALIZED' || month?.status === 'PAID';
  }

  /** Tính lại cả tháng (bỏ qua nếu đã FINALIZED/PAID). Trả PayrollMonth. */
  async recomputeStaffMonth(staffId: string, year: number, month: number, opts: { reprice?: boolean } = {}) {
    return this.withMonthLock(staffId, year, month, (tx) => this.recomputeMonthIn(tx, staffId, year, month, opts));
  }

  private async recomputeMonthIn(db: Db, staffId: string, year: number, month: number, opts: { reprice?: boolean } = {}) {
    const { start, end } = this.monthRange(year, month);
    const existing = await db.payrollMonth.findUnique({
      where: { staffId_year_month: { staffId, year, month } },
    });
    if (existing && (existing.status === 'FINALIZED' || existing.status === 'PAID')) return existing;

    // Các ngày có ca hoặc điều chỉnh trong tháng
    const [shiftDays, adjDays] = await Promise.all([
      db.shift.findMany({ where: { staffId, workDate: { gte: start, lt: end } }, select: { workDate: true }, distinct: ['workDate'] }),
      db.payrollAdjustment.findMany({ where: { staffId, workDate: { gte: start, lt: end } }, select: { workDate: true }, distinct: ['workDate'] }),
    ]);
    const dayMs = new Set<number>([...shiftDays, ...adjDays].map((d) => d.workDate.getTime()));
    // Trạng thái tháng đã kiểm ở ngay trên (return sớm nếu FINALIZED/PAID) — không kiểm lại
    // cho từng ngày.
    for (const ms of dayMs) await this.recomputeDayIn(db, staffId, new Date(ms), { ...opts, monthAlreadyChecked: true });

    const days = await db.payrollDay.findMany({ where: { staffId, workDate: { gte: start, lt: end } } });
    const totalMinutes = days.reduce((s, d) => s + d.workedMinutes, 0);
    const gross = days.reduce((s, d) => s + d.gross, 0);
    const totalFines = days.reduce((s, d) => s + d.fines, 0);
    // Kẹp ≥ 0 ở mức THÁNG, không phải từng ngày: ngày huỷ ca không có giờ công nên gross = 0,
    // kẹp theo ngày sẽ nuốt mất tiền phạt (xem computeDayPay). Tổng âm cả tháng nghĩa là phạt
    // vượt lương — vẫn trả 0, không đòi ngược nhân viên.
    const net = Math.max(0, days.reduce((s, d) => s + d.net, 0));

    return db.payrollMonth.upsert({
      where: { staffId_year_month: { staffId, year, month } },
      update: { totalMinutes, gross, totalFines, net },
      create: { staffId, year, month, totalMinutes, gross, totalFines, net },
    });
  }

  // ─────────────── Self ───────────────

  async getMyPayroll(staffId: string, year: number, month: number) {
    const { start, end } = this.monthRange(year, month);
    const monthRow = await this.recomputeStaffMonth(staffId, year, month);
    const [days, profile] = await Promise.all([
      this.prisma.payrollDay.findMany({ where: { staffId, workDate: { gte: start, lt: end } }, orderBy: { workDate: 'asc' } }),
      this.prisma.staffProfile.findUnique({ where: { userId: staffId } }),
    ]);
    return { month: monthRow, days, profile };
  }

  async updateBank(staffId: string, dto: BankInput) {
    return this.prisma.staffProfile.upsert({
      where: { userId: staffId },
      update: dto,
      create: { userId: staffId, ...dto },
    });
  }

  // ─────────────── Admin ───────────────

  /**
   * Lương chỉ áp cho nhân viên (STAFF/ADMIN). `allowFormer`: người đã hạ quyền nhưng còn hồ sơ lương đang dùng vẫn được
   * điều chỉnh kỳ cũ. Trước đây đặt đơn giá cho khách là tạo luôn hồ sơ lương, bảng lương có dòng của người không làm.
   */
  private async assertStaffMember(userId: string, allowFormer: boolean): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, staffProfile: { select: { active: true } } },
    });
    if (!user) throw new BadRequestException('Không tìm thấy nhân viên.');
    if (user.role === 'STAFF' || user.role === 'ADMIN') return;
    if (allowFormer && user.staffProfile?.active) return;
    throw new BadRequestException('Tài khoản này không phải nhân viên — cấp quyền nhân viên trước khi tính lương.');
  }

  async setRate(userId: string, hourlyRate: number) {
    if (hourlyRate < 0) throw new BadRequestException('Đơn giá không hợp lệ.');
    await this.assertStaffMember(userId, false);
    return this.prisma.staffProfile.upsert({
      where: { userId },
      update: { hourlyRate },
      create: { userId, hourlyRate },
    });
  }

  /**
   * Bảng lương tháng cho admin.
   *
   * Hai điều đã sửa ở đây:
   * - Chỉ TÍNH LẠI cho THÁNG HIỆN TẠI. Trước đây mỗi lần admin mở tab Lương (kể cả chỉ để xem
   *   tháng cũ) là chạy recompute tuần tự cho từng nhân sự, tức một GET gây ghi PayrollDay và
   *   PayrollMonth cho cả tháng đã qua — vừa chậm vừa ghi dữ liệu không ai yêu cầu. Tháng cũ đã
   *   được cron đêm và nút "Chốt" lo; cần tính lại có chủ đích thì có sẵn nút riêng.
   * - Nạp hồ sơ lương theo LÔ thay vì findUnique trong vòng lặp (N+1).
   */
  async adminMonth(year: number, month: number) {
    const members = await this.prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] } },
      select: { id: true, fullName: true, phone: true },
      orderBy: { createdAt: 'desc' },
    });
    if (members.length === 0) return [];

    const vnNow = new Date(Date.now() + 7 * 3600_000);
    const isCurrentMonth = vnNow.getUTCFullYear() === year && vnNow.getUTCMonth() + 1 === month;

    const ids = members.map((m) => m.id);
    if (isCurrentMonth) {
      for (const id of ids) {
        await this.recomputeStaffMonth(id, year, month);
      }
    }
    const [profiles, monthRows] = await Promise.all([
      this.prisma.staffProfile.findMany({ where: { userId: { in: ids } } }),
      this.prisma.payrollMonth.findMany({ where: { staffId: { in: ids }, year, month } }),
    ]);
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const monthMap = new Map(monthRows.map((r) => [r.staffId, r]));

    return members.map((m) => {
      const profile = profileMap.get(m.id) ?? null;
      // Chưa có bảng lương cho tháng đó (nhân sự mới, hoặc tháng chưa có ca nào) → số 0, không
      // tạo bản ghi rỗng chỉ vì admin mở màn hình.
      const monthRow =
        monthMap.get(m.id) ?? { staffId: m.id, year, month, totalMinutes: 0, gross: 0, totalFines: 0, net: 0, status: 'OPEN' };
      return {
        staff: m,
        month: monthRow,
        profile,
        qrImageUrl: this.buildQr(profile, monthRow.net, `Luong T${month}/${year} ${m.fullName ?? ''}`.trim()),
      };
    });
  }

  private buildQr(
    profile: { bankBin: string | null; bankAccountNo: string | null; bankAccountName: string | null; qrImageUrl: string | null } | null,
    amount: number,
    memo: string,
  ): string | null {
    if (!profile) return null;
    if (profile.qrImageUrl) return profile.qrImageUrl;
    if (!profile.bankBin || !profile.bankAccountNo || amount <= 0) return null;
    // dựng chuỗi VietQR (đảm bảo hợp lệ) + URL ảnh tiện hiển thị
    buildVietQrPayload({ bin: profile.bankBin, accountNo: profile.bankAccountNo, amount, addInfo: memo });
    return (
      `https://img.vietqr.io/image/${profile.bankBin}-${profile.bankAccountNo}-compact2.png` +
      `?amount=${amount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(profile.bankAccountName ?? '')}`
    );
  }

  async finalize(staffId: string, year: number, month: number) {
    return this.withMonthLock(staffId, year, month, async (tx) => {
      await this.recomputeMonthIn(tx, staffId, year, month);
      const r = await tx.payrollMonth.updateMany({
        where: { staffId, year, month, status: 'OPEN' },
        data: { status: 'FINALIZED', finalizedAt: new Date() },
      });
      if (r.count === 0) throw new BadRequestException('Tháng lương không ở trạng thái mở (hoặc đã chốt/trả).');
      return { finalized: true };
    });
  }

  async markPaid(
    staffId: string,
    year: number,
    month: number,
    proofImageUrl: string,
    note: string | undefined,
    adminId: string,
  ) {
    if (!proofImageUrl) throw new BadRequestException('Cần ảnh xác nhận đã chuyển khoản.');
    // Tính lại TRƯỚC khi đóng băng: tháng OPEN có thể vừa nhận thêm phiên chấm công vài phút
    // trước. Đóng băng số cũ là phần công đó không bao giờ được trả (PAID chặn recompute vĩnh
    // viễn). recomputeStaffMonth tự bỏ qua tháng đã FINALIZED nên gọi luôn là an toàn.
    // Tính lại và đóng băng trong CÙNG khoá tháng: recompute của nơi khác không chen vào giữa hai bước được.
    await this.withMonthLock(staffId, year, month, async (tx) => {
      await this.recomputeMonthIn(tx, staffId, year, month);
      const r = await tx.payrollMonth.updateMany({
        where: { staffId, year, month, status: { in: ['OPEN', 'FINALIZED'] } },
        data: { status: 'PAID', paidAt: new Date(), paidBy: adminId, proofImageUrl, note },
      });
      if (r.count === 0) {
        const existing = await tx.payrollMonth.findUnique({
          where: { staffId_year_month: { staffId, year, month } },
          select: { status: true },
        });
        // Phân biệt "chưa có bảng lương" với "đã trả" — trước đây cả hai đều báo "đã được đánh
        // dấu đã trả", che mất lỗi thật (vd gõ nhầm staffId).
        if (!existing) throw new NotFoundException('Chưa có bảng lương cho tháng này.');
        throw new BadRequestException('Tháng lương đã được đánh dấu đã trả.');
      }
    });
    this.logger.warn(`Admin ${adminId} đánh dấu ĐÃ TRẢ lương ${staffId} T${month}/${year}`);
    return { paid: true };
  }

  /**
   * Mở lại tháng đã chốt/đã trả để sửa.
   *
   * Trước đây FINALIZED là ngõ cụt: không có endpoint nào đưa trạng thái về OPEN, recompute bị
   * chặn vĩnh viễn, và FE ẩn luôn nút "Chốt" khi khác OPEN. Phát hiện sai giờ sau khi chốt là
   * không còn cách nào sửa trong app.
   */
  async reopen(staffId: string, year: number, month: number, adminId: string) {
    // Xoá luôn dấu vết ĐÃ TRẢ. Mở lại một tháng PAID rồi sửa giờ sẽ làm `net` đổi, trong khi
    // paidAt/paidBy/proofImageUrl vẫn là của lần chuyển khoản CŨ — sổ sách nói "đã chuyển X đồng
    // lúc T, ảnh chứng từ Y" cho một số tiền không còn là X, và màn "Lương của tôi" vẫn hiện ảnh
    // chứng từ cũ cho nhân viên. Chốt và trả lại là hai thao tác phải làm lại từ đầu.
    const r = await this.prisma.payrollMonth.updateMany({
      where: { staffId, year, month, status: { in: ['FINALIZED', 'PAID'] } },
      data: { status: 'OPEN', finalizedAt: null, paidAt: null, paidBy: null, proofImageUrl: null },
    });
    if (r.count === 0) throw new BadRequestException('Tháng lương đang mở (hoặc chưa tồn tại).');
    this.logger.warn(`Admin ${adminId} MỞ LẠI bảng lương ${staffId} T${month}/${year}`);
    return this.recomputeStaffMonth(staffId, year, month);
  }

  async adjust(
    staffId: string,
    workDate: Date,
    amount: number,
    reason: string,
    adminId: string,
    opts: { allowDuplicate?: boolean } = {},
  ) {
    await this.assertStaffMember(staffId, true);
    // Chống gửi trùng: unique (shiftId, type) không áp cho MANUAL vì shiftId là NULL, mà Postgres
    // coi mỗi NULL là một giá trị riêng. findFirst() dưới đây chỉ là HEURISTIC — KHÔNG phải
    // constraint DB thật — nên hai request gần nhau (double-click, retry mạng khi gửi khoản trừ
    // 500.000) có thể ĐỀU đọc "chưa có" trước khi request đầu commit, rồi cả hai cùng tạo → trừ
    // một triệu thay vì 500.000.
    //
    // Khoá tháng (advisory, trong transaction) bao cả phạm vi (staffId, workDate): request thứ 2 phải đợi tới khi
    // request 1 COMMIT xong, lúc đó findFirst đọc được bản ghi vừa tạo và trả 409 thay vì tạo thêm.
    //
    // Trùng thì BÁO, không nuốt: hai khoản phạt giống hệt trong cùng ngày có thể đều hợp lệ (đi trễ hai ca), nên
    // admin cần biết lần gửi thứ hai chưa được ghi và gửi lại kèm allowDuplicate nếu đó thật là khoản thứ hai.
    await this.writeInMonth(
      staffId,
      workDate,
      async (tx) => {
        if (!opts.allowDuplicate) {
          const recent = await tx.payrollAdjustment.findFirst({
            where: {
              staffId,
              workDate,
              type: 'MANUAL',
              amount,
              reason,
              createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
            },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          });
          if (recent) {
            const kind = amount > 0 ? `trừ ${formatVnd(amount)}` : `thưởng ${formatVnd(-amount)}`;
            throw new ConflictException({
              statusCode: 409,
              error: 'Conflict',
              code: PAYROLL_ADJUST_DUPLICATE,
              message:
                `Đã có khoản ${kind} giống hệt (cùng ngày, cùng lý do "${reason}") vừa ghi lúc ${formatVnDateTime(recent.createdAt)} — ` +
                'lần gửi này CHƯA được ghi. Nếu đây thật là khoản thứ hai, xác nhận ghi thêm.',
              adjustmentId: recent.id,
            });
          }
        }

        await tx.payrollAdjustment.create({
          data: { staffId, workDate, type: 'MANUAL', amount, reason, createdBy: adminId },
        });
      },
      'Tháng lương đã chốt/đã trả — mở lại tháng trước khi điều chỉnh.',
    );
    return { adjusted: true };
  }
}
