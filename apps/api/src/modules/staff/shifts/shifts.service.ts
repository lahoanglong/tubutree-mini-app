import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { rangesOverlap } from './time.util';
import { decideCancel } from './cancel-rule';

export interface ShiftItem {
  workDate: Date;
  startAt: Date;
  endAt: Date;
  templateId?: string;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  // ─────────────── Self (nhân viên) ───────────────

  listShifts(staffId: string, from: Date, to: Date) {
    return this.prisma.shift.findMany({
      where: { staffId, workDate: { gte: from, lte: to } },
      orderBy: [{ workDate: 'asc' }, { startAt: 'asc' }],
    });
  }

  listTemplates() {
    return this.prisma.shiftTemplate.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createShifts(staffId: string, items: ShiftItem[]) {
    if (items.length === 0) throw new BadRequestException('Chưa có ca nào để đăng ký.');
    for (const it of items) {
      if (it.endAt <= it.startAt) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu.');
    }
    // chồng trong batch
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (rangesOverlap(items[i].startAt, items[i].endAt, items[j].startAt, items[j].endAt)) {
          throw new BadRequestException('Các ca đăng ký bị chồng giờ nhau.');
        }
      }
    }
    // chồng với ca đã có (chỉ tính PENDING/APPROVED)
    const dates = items.map((i) => i.workDate);
    const existing = await this.prisma.shift.findMany({
      where: { staffId, workDate: { in: dates }, status: { in: ['PENDING', 'APPROVED'] } },
      select: { startAt: true, endAt: true },
    });
    for (const it of items) {
      for (const ex of existing) {
        if (rangesOverlap(it.startAt, it.endAt, ex.startAt, ex.endAt)) {
          throw new BadRequestException('Ca bị chồng với ca đã đăng ký.');
        }
      }
    }
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.shift.create({
          data: {
            staffId,
            workDate: it.workDate,
            startAt: it.startAt,
            endAt: it.endAt,
            templateId: it.templateId,
          },
        }),
      ),
    );
    return { created: items.length };
  }

  async updateShift(staffId: string, id: string, patch: { startAt?: Date; endAt?: Date }) {
    const shift = await this.prisma.shift.findFirst({ where: { id, staffId } });
    if (!shift) throw new NotFoundException('Không tìm thấy ca.');
    if (shift.status !== 'PENDING') throw new BadRequestException('Chỉ sửa được ca đang chờ duyệt.');
    const startAt = patch.startAt ?? shift.startAt;
    const endAt = patch.endAt ?? shift.endAt;
    if (endAt <= startAt) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu.');
    const others = await this.prisma.shift.findMany({
      where: { staffId, workDate: shift.workDate, status: { in: ['PENDING', 'APPROVED'] }, id: { not: id } },
      select: { startAt: true, endAt: true },
    });
    for (const ex of others) {
      if (rangesOverlap(startAt, endAt, ex.startAt, ex.endAt)) {
        throw new BadRequestException('Ca bị chồng giờ.');
      }
    }
    return this.prisma.shift.update({ where: { id }, data: { startAt, endAt } });
  }

  async deleteShift(staffId: string, id: string) {
    const del = await this.prisma.shift.deleteMany({ where: { id, staffId, status: 'PENDING' } });
    if (del.count === 0) throw new BadRequestException('Chỉ xoá được ca đang chờ duyệt.');
    return { deleted: true };
  }

  /** Copy toàn bộ ca tuần nguồn → tuần đích (tạo PENDING), bỏ ca chồng giờ với ca đã có tuần đích. */
  async copyWeek(staffId: string, sourceWeekStart: Date, targetWeekStart: Date) {
    const offset = targetWeekStart.getTime() - sourceWeekStart.getTime();
    if (offset === 0) throw new BadRequestException('Tuần nguồn và tuần đích trùng nhau.');
    const src = await this.prisma.shift.findMany({
      where: {
        staffId,
        workDate: { gte: sourceWeekStart, lt: new Date(sourceWeekStart.getTime() + 7 * 86400000) },
      },
    });
    const existing = await this.prisma.shift.findMany({
      where: {
        staffId,
        workDate: { gte: targetWeekStart, lt: new Date(targetWeekStart.getTime() + 7 * 86400000) },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      select: { startAt: true, endAt: true },
    });
    const toCreate = src
      .map((s) => ({
        workDate: new Date(s.workDate.getTime() + offset),
        startAt: new Date(s.startAt.getTime() + offset),
        endAt: new Date(s.endAt.getTime() + offset),
        templateId: s.templateId ?? undefined,
      }))
      .filter((c) => !existing.some((ex) => rangesOverlap(c.startAt, c.endAt, ex.startAt, ex.endAt)));
    if (toCreate.length) {
      await this.prisma.$transaction(
        toCreate.map((c) => this.prisma.shift.create({ data: { staffId, ...c } })),
      );
    }
    return { created: toCreate.length, skipped: src.length - toCreate.length };
  }

  async cancelShift(
    staffId: string,
    id: string,
    body: { reason: string; isEmergency?: boolean; evidenceUrl?: string },
  ) {
    const shift = await this.prisma.shift.findFirst({ where: { id, staffId } });
    if (!shift) throw new NotFoundException('Không tìm thấy ca.');
    if (shift.status !== 'APPROVED') throw new BadRequestException('Chỉ huỷ được ca đã duyệt.');
    const noticeDays = await this.config.get<number>('attendance.cancel_notice_days', 3);
    const cap = await this.config.get<number>('attendance.emergency_cap_month', 3);
    const workStart = shift.approvedStart ?? shift.startAt;
    const monthStart = new Date(Date.UTC(shift.workDate.getUTCFullYear(), shift.workDate.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(shift.workDate.getUTCFullYear(), shift.workDate.getUTCMonth() + 1, 1));
    // Đếm ca đột xuất đã ĐƯỢC MIỄN (penalty=false) trong tháng → áp cap.
    const emergencyCount = await this.prisma.shift.count({
      where: {
        staffId,
        status: 'CANCELLED',
        isEmergency: true,
        cancelPenalty: false,
        workDate: { gte: monthStart, lt: monthEnd },
      },
    });
    const decision = decideCancel({
      now: new Date(),
      workStart,
      isEmergency: !!body.isEmergency,
      hasEvidence: !!body.evidenceUrl,
      emergencyCountThisMonth: emergencyCount,
      noticeDays,
      emergencyCap: cap,
    });
    const updated = await this.prisma.shift.updateMany({
      where: { id, status: 'APPROVED' },
      data: {
        status: 'CANCELLED',
        cancelReason: body.reason,
        isEmergency: !!body.isEmergency,
        evidenceUrl: body.evidenceUrl,
        cancelledAt: new Date(),
        cancelPenalty: decision.penalty,
      },
    });
    if (updated.count === 0) throw new BadRequestException('Ca đã đổi trạng thái, thử lại.');
    return { cancelled: true, penalty: decision.penalty };
  }

  // ─────────────── Admin ───────────────

  listAll(from: Date, to: Date, staffId?: string) {
    return this.prisma.shift.findMany({
      where: { workDate: { gte: from, lte: to }, ...(staffId ? { staffId } : {}) },
      orderBy: [{ workDate: 'asc' }, { startAt: 'asc' }],
      include: { staff: { select: { id: true, fullName: true, phone: true, avatarUrl: true } } },
    });
  }

  async approve(adminId: string, id: string, times?: { approvedStart?: Date; approvedEnd?: Date }) {
    if (times?.approvedStart && times?.approvedEnd && times.approvedEnd <= times.approvedStart) {
      throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu.');
    }
    const r = await this.prisma.shift.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        approvedBy: adminId,
        approvedAt: new Date(),
        approvedStart: times?.approvedStart ?? null,
        approvedEnd: times?.approvedEnd ?? null,
      },
    });
    if (r.count === 0) throw new BadRequestException('Ca không ở trạng thái chờ duyệt.');
    return { approved: true };
  }

  async reject(adminId: string, id: string, reason: string) {
    const r = await this.prisma.shift.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectReason: reason, approvedBy: adminId, approvedAt: new Date() },
    });
    if (r.count === 0) throw new BadRequestException('Ca không ở trạng thái chờ duyệt.');
    return { rejected: true };
  }

  async bulkApprove(adminId: string, ids: string[]) {
    const r = await this.prisma.shift.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'APPROVED', approvedBy: adminId, approvedAt: new Date() },
    });
    return { approved: r.count };
  }

  // Templates (admin)
  listAllTemplates() {
    return this.prisma.shiftTemplate.findMany({ orderBy: { sortOrder: 'asc' } });
  }
  createTemplate(data: { name: string; startMin: number; endMin: number; sortOrder?: number }) {
    if (data.endMin <= data.startMin) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu.');
    return this.prisma.shiftTemplate.create({ data });
  }
  async updateTemplate(
    id: string,
    data: { name?: string; startMin?: number; endMin?: number; active?: boolean; sortOrder?: number },
  ) {
    const r = await this.prisma.shiftTemplate.updateMany({ where: { id }, data });
    if (r.count === 0) throw new NotFoundException('Không tìm thấy ca chuẩn.');
    return { updated: true };
  }
  async deleteTemplate(id: string) {
    await this.prisma.shiftTemplate.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Không tìm thấy ca chuẩn.');
    });
    return { deleted: true };
  }
}
