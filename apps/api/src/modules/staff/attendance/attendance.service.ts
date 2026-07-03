import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { verifyPresence, type AttnConfig, type VerifyReason } from './verify';
import { vnDateKey } from '../shifts/time.util';

const REASON_MSG: Record<VerifyReason, string> = {
  NOT_CONFIGURED: 'Chưa cấu hình chấm công, vui lòng liên hệ quản trị.',
  IP_NOT_ALLOWED: 'Bạn chưa kết nối mạng nội bộ công ty.',
  OUT_OF_RADIUS: 'Bạn đang ở ngoài vùng công ty.',
};

export interface Coords {
  lat: number;
  lng: number;
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private async loadCfg(): Promise<AttnConfig & { graceMin: number; staleMin: number }> {
    const [officeIps, lat, lng, radiusM, enforceIp, graceMin, staleMin] = await Promise.all([
      this.config.get<string[]>('attendance.office_ips', []),
      this.config.get<number | null>('attendance.office_lat', null),
      this.config.get<number | null>('attendance.office_lng', null),
      this.config.get<number>('attendance.radius_m', 150),
      this.config.get<boolean>('attendance.enforce_ip', true),
      this.config.get<number>('attendance.late_grace_min', 30),
      this.config.get<number>('attendance.heartbeat_stale_min', 10),
    ]);
    return { officeIps, lat, lng, radiusM, enforceIp, graceMin, staleMin };
  }

  /** Ranh giới ngày VN của "hôm nay" (để khớp workDate @db.Date lưu midnight UTC theo date-key VN). */
  private todayRange() {
    const key = vnDateKey(new Date());
    const start = new Date(`${key}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86400000);
    return { start, end };
  }

  /** Ca APPROVED hôm nay + phiên đang mở (nếu có). */
  async status(staffId: string) {
    const { start, end } = this.todayRange();
    const [shifts, openSession] = await Promise.all([
      this.prisma.shift.findMany({
        where: { staffId, status: 'APPROVED', workDate: { gte: start, lt: end } },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.attendanceSession.findFirst({
        where: { staffId, checkoutAt: null },
        orderBy: { checkinAt: 'desc' },
      }),
    ]);
    return { shifts, openSession };
  }

  async checkin(staffId: string, ip: string, body: { shiftId: string } & Coords) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: body.shiftId, staffId, status: 'APPROVED' },
    });
    if (!shift) throw new NotFoundException('Không tìm thấy ca đã duyệt.');

    const cfg = await this.loadCfg();
    const v = verifyPresence(cfg, ip, body.lat, body.lng);
    if (!v.ok) throw new BadRequestException(REASON_MSG[v.reason]);

    const open = await this.prisma.attendanceSession.findFirst({
      where: { staffId, checkoutAt: null },
      select: { id: true },
    });
    if (open) throw new BadRequestException('Bạn đang trong ca, hãy checkout trước.');

    const priorCount = await this.prisma.attendanceSession.count({ where: { shiftId: shift.id } });
    const effectiveStart = shift.approvedStart ?? shift.startAt;
    const isLate =
      priorCount === 0 && Date.now() > effectiveStart.getTime() + cfg.graceMin * 60000;

    const session = await this.prisma.attendanceSession.create({
      data: {
        shiftId: shift.id,
        staffId,
        checkinLat: body.lat,
        checkinLng: body.lng,
        checkinIp: ip,
        isLate,
      },
    });
    if (isLate) this.logger.warn(`Checkin TRỄ: staff ${staffId} ca ${shift.id}`);
    return { sessionId: session.id, isLate };
  }

  async checkout(staffId: string) {
    const open = await this.prisma.attendanceSession.findFirst({
      where: { staffId, checkoutAt: null },
      orderBy: { checkinAt: 'desc' },
    });
    if (!open) throw new BadRequestException('Không có phiên đang mở để checkout.');
    await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: { checkoutAt: new Date(), closeReason: 'MANUAL' },
    });
    return { checkedOut: true };
  }

  /** Heartbeat khi app mở — re-verify; rớt vùng → auto checkout (OUT_OF_RANGE). */
  async heartbeat(staffId: string, ip: string, body: Coords) {
    const open = await this.prisma.attendanceSession.findFirst({
      where: { staffId, checkoutAt: null },
      orderBy: { checkinAt: 'desc' },
    });
    if (!open) return { open: false };
    const cfg = await this.loadCfg();
    const v = verifyPresence(cfg, ip, body.lat, body.lng);
    if (!v.ok) {
      await this.prisma.attendanceSession.update({
        where: { id: open.id },
        data: { checkoutAt: new Date(), closeReason: 'OUT_OF_RANGE' },
      });
      return { open: false, closed: true, reason: v.reason };
    }
    await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: { lastHeartbeatAt: new Date() },
    });
    return { open: true };
  }

  // ─────────────── Admin ───────────────

  listLive() {
    return this.prisma.attendanceSession.findMany({
      where: { checkoutAt: null },
      orderBy: { checkinAt: 'asc' },
      include: {
        shift: { select: { id: true, workDate: true, startAt: true, endAt: true, approvedStart: true, approvedEnd: true } },
      },
    });
  }

  async manualCheckout(sessionId: string) {
    const s = await this.prisma.attendanceSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Không tìm thấy phiên.');
    if (s.checkoutAt) throw new BadRequestException('Phiên đã đóng.');
    await this.prisma.attendanceSession.update({
      where: { id: sessionId },
      data: { checkoutAt: new Date(), closeReason: 'ADMIN' },
    });
    return { checkedOut: true };
  }
}
