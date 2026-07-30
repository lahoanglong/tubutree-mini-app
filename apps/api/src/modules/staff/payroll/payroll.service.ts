import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
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
    const existing = await this.prisma.payrollAdjustment.findFirst({ where: { shiftId, type } });
    if (existing) return;
    await this.prisma.payrollAdjustment.create({ data: { staffId, workDate, type, amount, reason, shiftId } });
  }

  /** Tính lại lương 1 ngày (workDate = midnight UTC của date-key VN). */
  async recomputeDay(staffId: string, workDate: Date) {
    const profile = await this.prisma.staffProfile.findUnique({ where: { userId: staffId } });
    const rate = profile?.hourlyRate ?? 0;
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

  /** Tính lại cả tháng (bỏ qua nếu đã FINALIZED/PAID). Trả PayrollMonth. */
  async recomputeStaffMonth(staffId: string, year: number, month: number) {
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
    for (const ms of dayMs) await this.recomputeDay(staffId, new Date(ms));

    const days = await this.prisma.payrollDay.findMany({ where: { staffId, workDate: { gte: start, lt: end } } });
    const totalMinutes = days.reduce((s, d) => s + d.workedMinutes, 0);
    const gross = days.reduce((s, d) => s + d.gross, 0);
    const totalFines = days.reduce((s, d) => s + d.fines, 0);
    const net = days.reduce((s, d) => s + d.net, 0);

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

  async adminMonth(year: number, month: number) {
    const members = await this.prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] } },
      select: { id: true, fullName: true, phone: true },
      orderBy: { createdAt: 'desc' },
    });
    const rows = [];
    for (const m of members) {
      const monthRow = await this.recomputeStaffMonth(m.id, year, month);
      const profile = await this.prisma.staffProfile.findUnique({ where: { userId: m.id } });
      rows.push({
        staff: m,
        month: monthRow,
        profile,
        qrImageUrl: this.buildQr(profile, monthRow.net, `Luong T${month}/${year} ${m.fullName ?? ''}`.trim()),
      });
    }
    return rows;
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
    const r = await this.prisma.payrollMonth.updateMany({
      where: { staffId, year, month, status: { in: ['OPEN', 'FINALIZED'] } },
      data: { status: 'PAID', paidAt: new Date(), paidBy: adminId, proofImageUrl, note },
    });
    if (r.count === 0) throw new BadRequestException('Tháng lương đã được đánh dấu đã trả.');
    this.logger.warn(`Admin ${adminId} đánh dấu ĐÃ TRẢ lương ${staffId} T${month}/${year}`);
    return { paid: true };
  }

  async adjust(staffId: string, workDate: Date, amount: number, reason: string, adminId: string) {
    await this.prisma.payrollAdjustment.create({
      data: { staffId, workDate, type: 'MANUAL', amount, reason, createdBy: adminId },
    });
    await this.recomputeDay(staffId, workDate);
    return { adjusted: true };
  }
}
