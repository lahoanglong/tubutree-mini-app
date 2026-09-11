import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { buildVietQrPayload } from '../../integrations/payment/vietqr';
import { computeDayPay, sumWorkedMinutes, type ShiftWindow } from './payroll.calc';

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

  private monthRange(year: number, month: number) {
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
  }

  private effWindow(shift: { startAt: Date; endAt: Date; approvedStart: Date | null; approvedEnd: Date | null }) {
    return { effStart: shift.approvedStart ?? shift.startAt, effEnd: shift.approvedEnd ?? shift.endAt };
  }

  /** Tạo phạt tự động (idempotent theo shiftId+type): trễ (late_fine) & huỷ trễ (1h công=rate). */
  async ensureFines(staffId: string, workDate: Date, rate: number) {
    const shifts = await this.prisma.shift.findMany({
      where: { staffId, workDate },
      select: { id: true, cancelPenalty: true, sessions: { select: { isLate: true } } },
    });
    const lateFine = await this.config.get<number>('attendance.late_fine', 10000);
    for (const s of shifts) {
      const hasLate = s.sessions.some((x) => x.isLate);
      if (hasLate) await this.ensureAdjustment(staffId, workDate, s.id, 'LATE', lateFine, 'Đi trễ quá quy định');
      if (s.cancelPenalty)
        await this.ensureAdjustment(staffId, workDate, s.id, 'LATE_CANCEL', rate, 'Huỷ ca trễ (1h công)');
    }
  }

  private async ensureAdjustment(
    staffId: string,
    workDate: Date,
    shiftId: string,
    type: 'LATE' | 'LATE_CANCEL',
    amount: number,
    reason: string,
  ) {
    // Pre-check nhanh + guard thật là unique index (shiftId, type) — 2 request recompute
    // song song (vd 2 tab mở /staff/payroll) đều có thể đọc "chưa có phạt" trước khi request
    // đầu commit; P2002 chặn tạo trùng, tránh trừ phạt 2 lần.
    const existing = await this.prisma.payrollAdjustment.findFirst({ where: { shiftId, type } });
    if (existing) {
      // Số tiền phạt huỷ ca = 1 GIỜ CÔNG, tức phụ thuộc đơn giá. Trước đây tạo một lần rồi
      // không bao giờ cập nhật: nhân viên mới chưa có hồ sơ lương thì rate = 0 → phiếu phạt
      // amount = 0 VĨNH VIỄN, sau này admin đặt đơn giá thật cũng không sửa được.
      if (existing.amount !== amount) {
        await this.prisma.payrollAdjustment.update({ where: { id: existing.id }, data: { amount } });
      }
      return;
    }
    try {
      await this.prisma.payrollAdjustment.create({ data: { staffId, workDate, type, amount, reason, shiftId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }
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
  async recomputeDay(
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
    if (!opts.monthAlreadyChecked && (await this.isMonthLocked(staffId, workDate))) {
      throw new BadRequestException('Tháng lương đã chốt/đã trả — mở lại tháng trước khi sửa.');
    }
    const [profile, existingDay] = await Promise.all([
      this.prisma.staffProfile.findUnique({ where: { userId: staffId } }),
      this.prisma.payrollDay.findUnique({ where: { staffId_workDate: { staffId, workDate } }, select: { hourlyRate: true } }),
    ]);
    const currentRate = profile?.hourlyRate ?? 0;
    // hourlyRate = 0 nghĩa là ngày đó tính khi hồ sơ chưa có đơn giá → không phải mốc đáng khoá.
    const rate = !opts.reprice && existingDay && existingDay.hourlyRate > 0 ? existingDay.hourlyRate : currentRate;
    await this.ensureFines(staffId, workDate, rate);

    const shifts = await this.prisma.shift.findMany({
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
    const adjustments = await this.prisma.payrollAdjustment.findMany({
      where: { staffId, workDate },
      select: { amount: true },
    });
    const pay = computeDayPay(minutes, rate, adjustments);

    await this.prisma.payrollDay.upsert({
      where: { staffId_workDate: { staffId, workDate } },
      update: { workedMinutes: pay.workedMinutes, hourlyRate: rate, gross: pay.gross, fines: pay.fines, net: pay.net },
      create: { staffId, workDate, workedMinutes: pay.workedMinutes, hourlyRate: rate, gross: pay.gross, fines: pay.fines, net: pay.net },
    });
    return pay;
  }

  /**
   * Ném lỗi nếu tháng chứa `workDate` đã chốt/đã trả.
   *
   * Public để nơi GHI dữ liệu chấm công gọi được TRƯỚC khi ghi: nếu chỉ chặn ở recomputeDay
   * (chạy SAU lần ghi và không nằm chung transaction) thì phiên đã đổi trong DB rồi API mới trả
   * 400 — quản lý tưởng thất bại, còn dữ liệu thì đã lệch.
   */
  async assertMonthEditable(staffId: string, workDate: Date): Promise<void> {
    if (await this.isMonthLocked(staffId, workDate)) {
      throw new BadRequestException('Tháng lương đã chốt/đã trả — mở lại tháng trước khi sửa.');
    }
  }

  /** Tháng chứa `workDate` đã FINALIZED/PAID chưa (theo mốc VN — workDate là midnight UTC của date-key VN). */
  private async isMonthLocked(staffId: string, workDate: Date): Promise<boolean> {
    const month = await this.prisma.payrollMonth.findUnique({
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
    const { start, end } = this.monthRange(year, month);
    const existing = await this.prisma.payrollMonth.findUnique({
      where: { staffId_year_month: { staffId, year, month } },
    });
    if (existing && (existing.status === 'FINALIZED' || existing.status === 'PAID')) return existing;

    // Các ngày có ca hoặc điều chỉnh trong tháng
    const [shiftDays, adjDays] = await Promise.all([
      this.prisma.shift.findMany({ where: { staffId, workDate: { gte: start, lt: end } }, select: { workDate: true }, distinct: ['workDate'] }),
      this.prisma.payrollAdjustment.findMany({ where: { staffId, workDate: { gte: start, lt: end } }, select: { workDate: true }, distinct: ['workDate'] }),
    ]);
    const dayMs = new Set<number>([...shiftDays, ...adjDays].map((d) => d.workDate.getTime()));
    // Trạng thái tháng đã kiểm ở ngay trên (return sớm nếu FINALIZED/PAID) — không kiểm lại
    // cho từng ngày.
    for (const ms of dayMs) await this.recomputeDay(staffId, new Date(ms), { ...opts, monthAlreadyChecked: true });

    const days = await this.prisma.payrollDay.findMany({ where: { staffId, workDate: { gte: start, lt: end } } });
    const totalMinutes = days.reduce((s, d) => s + d.workedMinutes, 0);
    const gross = days.reduce((s, d) => s + d.gross, 0);
    const totalFines = days.reduce((s, d) => s + d.fines, 0);
    // Kẹp ≥ 0 ở mức THÁNG, không phải từng ngày: ngày huỷ ca không có giờ công nên gross = 0,
    // kẹp theo ngày sẽ nuốt mất tiền phạt (xem computeDayPay). Tổng âm cả tháng nghĩa là phạt
    // vượt lương — vẫn trả 0, không đòi ngược nhân viên.
    const net = Math.max(0, days.reduce((s, d) => s + d.net, 0));

    return this.prisma.payrollMonth.upsert({
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

  async setRate(userId: string, hourlyRate: number) {
    if (hourlyRate < 0) throw new BadRequestException('Đơn giá không hợp lệ.');
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
    await this.recomputeStaffMonth(staffId, year, month);
    const r = await this.prisma.payrollMonth.updateMany({
      where: { staffId, year, month, status: 'OPEN' },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
    });
    if (r.count === 0) throw new BadRequestException('Tháng lương không ở trạng thái mở (hoặc đã chốt/trả).');
    return { finalized: true };
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
    await this.recomputeStaffMonth(staffId, year, month);
    const r = await this.prisma.payrollMonth.updateMany({
      where: { staffId, year, month, status: { in: ['OPEN', 'FINALIZED'] } },
      data: { status: 'PAID', paidAt: new Date(), paidBy: adminId, proofImageUrl, note },
    });
    if (r.count === 0) {
      const existing = await this.prisma.payrollMonth.findUnique({
        where: { staffId_year_month: { staffId, year, month } },
        select: { status: true },
      });
      // Phân biệt "chưa có bảng lương" với "đã trả" — trước đây cả hai đều báo "đã được đánh
      // dấu đã trả", che mất lỗi thật (vd gõ nhầm staffId).
      if (!existing) throw new NotFoundException('Chưa có bảng lương cho tháng này.');
      throw new BadRequestException('Tháng lương đã được đánh dấu đã trả.');
    }
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

  async adjust(staffId: string, workDate: Date, amount: number, reason: string, adminId: string) {
    if (await this.isMonthLocked(staffId, workDate)) {
      throw new BadRequestException('Tháng lương đã chốt/đã trả — mở lại tháng trước khi điều chỉnh.');
    }
    // Chống gửi trùng: unique (shiftId, type) không áp cho MANUAL vì shiftId là NULL, mà Postgres
    // coi mỗi NULL là một giá trị riêng. Một lần retry/timeout mạng khi gửi khoản trừ 500.000
    // trước đây tạo hai bản ghi → trừ một triệu. Cùng (ngày, số tiền, lý do) trong 5 phút coi là
    // một thao tác.
    const recent = await this.prisma.payrollAdjustment.findFirst({
      where: {
        staffId,
        workDate,
        type: 'MANUAL',
        amount,
        reason,
        createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
      },
      select: { id: true },
    });
    if (recent) return { adjusted: true, deduped: true };

    await this.prisma.payrollAdjustment.create({
      data: { staffId, workDate, type: 'MANUAL', amount, reason, createdBy: adminId },
    });
    await this.recomputeDay(staffId, workDate);
    return { adjusted: true };
  }
}
