import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { verifyPresence, type AttnConfig, type VerifyReason } from './verify';
import { vnDateKey } from '../../../common/vn-time';

const REASON_MSG: Record<VerifyReason, string> = {
  NOT_CONFIGURED: 'Chưa cấu hình chấm công, vui lòng liên hệ quản trị.',
  IP_NOT_ALLOWED: 'Bạn chưa kết nối mạng nội bộ công ty.',
  OUT_OF_RADIUS: 'Bạn đang ở ngoài vùng công ty.',
};

export interface Coords {
  lat: number;
  lng: number;
}

// Miniapp gửi heartbeat mỗi 3 phút: 3 nhịp liên tiếp ≈ 6–9 phút ngoài vùng mới tự chấm ra.
const DEFAULT_OUT_MAX_COUNT = 3;
const DEFAULT_OUT_MAX_MIN = 15;

/** Cấu hình admin nhập tay có thể là 0/âm/chuỗi — 0 nghĩa là "chấm ra ngay", đúng lỗi cần tránh. */
function positiveInt(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private async loadCfg(): Promise<
    AttnConfig & { graceMin: number; staleMin: number; earlyMin: number; outMaxCount: number; outMaxMin: number }
  > {
    const [officeIps, lat, lng, radiusM, enforceIp, graceMin, staleMin, earlyMin, outMaxCount, outMaxMin] =
      await Promise.all([
        this.config.get<string[]>('attendance.office_ips', []),
        this.config.get<number | null>('attendance.office_lat', null),
        this.config.get<number | null>('attendance.office_lng', null),
        this.config.get<number>('attendance.radius_m', 150),
        this.config.get<boolean>('attendance.enforce_ip', true),
        this.config.get<number>('attendance.late_grace_min', 30),
        this.config.get<number>('attendance.heartbeat_stale_min', 10),
        this.config.get<number>('attendance.checkin_early_min', 60),
        this.config.get<number>('attendance.out_of_range_max_count', DEFAULT_OUT_MAX_COUNT),
        this.config.get<number>('attendance.out_of_range_max_min', DEFAULT_OUT_MAX_MIN),
      ]);
    return {
      officeIps,
      lat,
      lng,
      radiusM,
      enforceIp,
      graceMin,
      staleMin,
      earlyMin,
      outMaxCount: positiveInt(outMaxCount, DEFAULT_OUT_MAX_COUNT),
      outMaxMin: positiveInt(outMaxMin, DEFAULT_OUT_MAX_MIN),
    };
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

  /** `db`: controller chạy check-in trong khoá tháng lương (PayrollService.writeInMonth) nên truyền tx vào đây. */
  async checkin(staffId: string, ip: string, body: { shiftId: string } & Coords, db: Db = this.prisma) {
    const shift = await db.shift.findFirst({
      where: { id: body.shiftId, staffId, status: 'APPROVED' },
    });
    if (!shift) throw new NotFoundException('Không tìm thấy ca đã duyệt.');

    const cfg = await this.loadCfg();

    // Phiên chấm công phải nằm trong CỬA SỔ của chính ca đó. Trước đây checkin nhận bất kỳ ca
    // đã duyệt nào của mình, không xét giờ: NV đang ở công ty lúc 17:05 checkin được vào ca
    // 08:00–17:00 NGÀY MAI. Cron chỉ đóng phiên khi đã quá giờ hết ca, nên phiên đó mở suốt
    // tới 17:00 hôm sau và payroll tính phần giao với cửa sổ ca = 9 giờ công đầy đủ cho một
    // ngày không đi làm phút nào. Xét theo MỐC GIỜ của ca chứ không theo ngày lịch — ca qua
    // đêm (23:00 hôm nay → 02:00 hôm sau) vẫn checkin bình thường.
    const now = Date.now();
    const effStart = shift.approvedStart ?? shift.startAt;
    const effEnd = shift.approvedEnd ?? shift.endAt;
    if (now < effStart.getTime() - cfg.earlyMin * 60000) {
      throw new BadRequestException(`Chưa tới giờ ca — chỉ checkin được sớm nhất ${cfg.earlyMin} phút trước giờ vào.`);
    }
    if (now > effEnd.getTime()) {
      throw new BadRequestException('Ca đã kết thúc — nhờ quản lý bổ sung phiên chấm công giúp bạn.');
    }

    const v = verifyPresence(cfg, ip, body.lat, body.lng);
    if (!v.ok) throw new BadRequestException(REASON_MSG[v.reason]);

    // Pre-check nhanh cho UX (thông báo sớm) — KHÔNG phải guard chính: 2 request checkin()
    // song song đều có thể đọc "chưa có phiên mở" trước khi phiên đầu commit. Guard thật là
    // unique index partial `attendance_sessions_open_staff_key` (staffId WHERE checkoutAt
    // IS NULL) bắt bằng P2002 bên dưới — chống double-checkin khai khống giờ công payroll.
    const open = await db.attendanceSession.findFirst({
      where: { staffId, checkoutAt: null },
      select: { id: true },
    });
    if (open) throw new BadRequestException('Bạn đang trong ca, hãy checkout trước.');

    const priorCount = await db.attendanceSession.count({ where: { shiftId: shift.id } });
    const isLate = priorCount === 0 && now > effStart.getTime() + cfg.graceMin * 60000;

    let session: { id: string };
    try {
      session = await db.attendanceSession.create({
        data: {
          shiftId: shift.id,
          staffId,
          checkinLat: body.lat,
          checkinLng: body.lng,
          checkinIp: ip,
          isLate,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Bạn đang trong ca, hãy checkout trước.');
      }
      throw err;
    }
    if (isLate) this.logger.warn(`Checkin TRỄ: staff ${staffId} ca ${shift.id}`);
    return { sessionId: session.id, isLate };
  }

  /**
   * Checkout. `at` (tuỳ chọn) = giờ lùi về quá khứ cho trường hợp quên checkout (VD nghỉ trưa):
   * phải nằm trong (checkinAt, now] — chỉ GIẢM được giờ, không thể khai khống tăng.
   */
  async checkout(staffId: string, at?: Date) {
    const open = await this.prisma.attendanceSession.findFirst({
      where: { staffId, checkoutAt: null },
      orderBy: { checkinAt: 'desc' },
    });
    if (!open) throw new BadRequestException('Không có phiên đang mở để checkout.');
    let checkoutAt = new Date();
    if (at) {
      if (at.getTime() > Date.now()) throw new BadRequestException('Giờ checkout không được ở tương lai.');
      if (at.getTime() <= open.checkinAt.getTime())
        throw new BadRequestException('Giờ checkout phải sau giờ checkin.');
      checkoutAt = at;
    }
    await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: { checkoutAt, closeReason: 'MANUAL' },
    });
    return { checkedOut: true };
  }

  /**
   * Heartbeat khi app mở — re-verify vị trí.
   *
   * Ngoài vùng KHÔNG tự chấm ra ngay: GPS trong nhà hay nhảy vài trăm mét một nhịp, và trước đây
   * một nhịp lệch là phiên đóng OUT_OF_RANGE, nhân viên mất phần giờ công còn lại của ca mà quản lý
   * lại không có UI chấm bù. Chỉ đóng khi (a) ngoài vùng đủ N nhịp LIÊN TIẾP, hoặc (b) chuỗi ngoài
   * vùng kéo dài ≥ M phút (heartbeat thưa vì app bị cất vào túi nên N nhịp lâu mới đủ). Một nhịp
   * hợp lệ xoá cả hai bộ đếm. Giờ ra ghi lùi về nhịp ngoài vùng ĐẦU TIÊN của chuỗi — cùng mốc mà
   * cách cũ (đóng ngay nhịp đầu) vẫn ghi — nên giờ ngoài vùng không được cộng vào công.
   */
  async heartbeat(staffId: string, ip: string, body: Coords) {
    const open = await this.prisma.attendanceSession.findFirst({
      where: { staffId, checkoutAt: null },
      orderBy: { checkinAt: 'desc' },
    });
    if (!open) return { open: false };
    const cfg = await this.loadCfg();
    const v = verifyPresence(cfg, ip, body.lat, body.lng);
    const now = new Date();
    if (v.ok) {
      await this.prisma.attendanceSession.update({
        where: { id: open.id },
        data: { lastHeartbeatAt: now, outOfRangeCount: 0, outOfRangeSince: null },
      });
      return { open: true };
    }

    // increment là một câu UPDATE nguyên tử: hai heartbeat song song (thử lại mạng, hai thiết bị)
    // không đọc cùng một giá trị rồi ghi đè nhau làm mất một nhịp.
    const after = await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: {
        outOfRangeCount: { increment: 1 },
        ...(open.outOfRangeSince ? {} : { outOfRangeSince: now }),
      },
      select: { outOfRangeCount: true, outOfRangeSince: true },
    });
    const since = after.outOfRangeSince ?? now;
    const overCount = after.outOfRangeCount >= cfg.outMaxCount;
    const overTime = now.getTime() - since.getTime() >= cfg.outMaxMin * 60000;
    if (!overCount && !overTime) {
      return {
        open: true,
        outOfRange: true,
        reason: v.reason,
        missed: after.outOfRangeCount,
        maxMissed: cfg.outMaxCount,
      };
    }

    // checkoutAt: null trong where — phiên đã bị checkout tay/QL đóng song song thì không ghi đè
    // giờ ra và lý do đóng của lần đóng đó. Không lùi trước giờ checkin (QL có thể đã sửa checkin).
    const closed = await this.prisma.attendanceSession.updateMany({
      where: { id: open.id, checkoutAt: null },
      data: {
        checkoutAt: new Date(Math.max(since.getTime(), open.checkinAt.getTime())),
        closeReason: 'OUT_OF_RANGE',
      },
    });
    if (closed.count === 0) return { open: false };
    return { open: false, closed: true, reason: v.reason };
  }

  // ─────────────── Admin ───────────────

  listLive() {
    return this.prisma.attendanceSession.findMany({
      where: { checkoutAt: null },
      orderBy: { checkinAt: 'asc' },
      include: {
        shift: {
          select: {
            id: true,
            workDate: true,
            startAt: true,
            endAt: true,
            approvedStart: true,
            approvedEnd: true,
            staff: { select: { id: true, fullName: true, phone: true } },
          },
        },
      },
    });
  }

  async manualCheckout(sessionId: string, db: Db = this.prisma) {
    // Chỉ đóng phiên còn mở: nhân viên tự ra ca cùng lúc thì giữ giờ ra ca của họ, không ghi đè bằng giờ bấm nút.
    const { count } = await db.attendanceSession.updateMany({
      where: { id: sessionId, checkoutAt: null },
      data: { checkoutAt: new Date(), closeReason: 'ADMIN' },
    });
    if (count === 0) {
      const s = await db.attendanceSession.findUnique({ where: { id: sessionId }, select: { id: true } });
      if (!s) throw new NotFoundException('Không tìm thấy phiên.');
      throw new BadRequestException('Phiên đã đóng.');
    }
    return { checkedOut: true };
  }

  /** Lịch sử phiên trong khoảng (theo giờ checkin). Dùng cho màn lương/lịch sử chấm công. */
  history(staffId: string, from: Date, to: Date) {
    return this.prisma.attendanceSession.findMany({
      where: { staffId, checkinAt: { gte: from, lte: to } },
      orderBy: { checkinAt: 'asc' },
      select: {
        id: true,
        shiftId: true,
        checkinAt: true,
        checkoutAt: true,
        isLate: true,
        closeReason: true,
      },
    });
  }


  /**
   * Chặn phiên chấm công CHỒNG GIỜ trong cùng một ca.
   *
   * `sumWorkedMinutes` cộng phần giao của TỪNG phiên với cửa sổ ca, nên hai phiên 08:00–17:00
   * của cùng một ca cho ra 18 giờ công trong một ngày. Quản lý tưởng nhân viên quên chấm rồi
   * thêm tay một phiên nữa là đủ để xảy ra — mà endpoint thêm phiên lại không có UI nên lỗi
   * kiểu này rất dễ lọt.
   */
  private async assertNoOverlap(
    shiftId: string,
    checkinAt: Date,
    checkoutAt: Date | null,
    excludeSessionId?: string,
    db: Db = this.prisma,
  ): Promise<void> {
    const siblings = await db.attendanceSession.findMany({
      where: { shiftId, ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) },
      select: { checkinAt: true, checkoutAt: true },
    });
    // Phiên CHƯA ĐÓNG kết thúc ở "bây giờ", KHÔNG phải vô hạn.
    //
    // Coi nó là vô hạn sẽ chặn đúng tình huống cần sửa nhất: nhân viên checkin 08:00 rồi quên
    // checkout, quản lý muốn thêm phiên chiều 13:00–17:00 giúp thì MỌI khoảng giờ sau 08:00 đều
    // "chồng" → không thêm được, mà thông báo lỗi cũng không gợi ý gì.
    const now = Date.now();
    const end = checkoutAt?.getTime() ?? now;
    const start = checkinAt.getTime();
    for (const other of siblings) {
      const oStart = other.checkinAt.getTime();
      const openOther = other.checkoutAt == null;
      const oEnd = other.checkoutAt?.getTime() ?? now;
      if (start < oEnd && oStart < end) {
        throw new BadRequestException(
          openOther
            ? 'Có một phiên chấm công CHƯA ĐÓNG trùng khoảng giờ này — đóng phiên đó trước rồi thử lại.'
            : 'Khoảng giờ này chồng với một phiên chấm công khác của cùng ca.',
        );
      }
    }
  }

  /** Tra nhanh {staffId, workDate} của một phiên — khoá tháng lương lấy theo đây, kiểm tháng và ghi nằm trong khoá. */
  async sessionOwner(sessionId: string): Promise<{ staffId: string; workDate: Date }> {
    const s = await this.prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      select: { staffId: true, shift: { select: { workDate: true } } },
    });
    if (!s) throw new NotFoundException('Không tìm thấy phiên.');
    return { staffId: s.staffId, workDate: s.shift.workDate };
  }

  /** Tra nhanh {staffId, workDate} của một ca — khoá tháng lương lấy theo đây, kiểm tháng và ghi nằm trong khoá. */
  async shiftOwner(shiftId: string): Promise<{ staffId: string; workDate: Date }> {
    const sh = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      select: { staffId: true, workDate: true },
    });
    if (!sh) throw new NotFoundException('Không tìm thấy ca.');
    return { staffId: sh.staffId, workDate: sh.workDate };
  }

  /** QL sửa giờ phiên (điều chỉnh giờ làm). Chạy trong PayrollService.writeInMonth: tính lại lương ngày do writeInMonth làm. */
  async adminEditSession(sessionId: string, patch: { checkinAt?: Date; checkoutAt?: Date | null }, db: Db = this.prisma) {
    const s = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { shift: { select: { workDate: true } } },
    });
    if (!s) throw new NotFoundException('Không tìm thấy phiên.');
    const checkinAt = patch.checkinAt ?? s.checkinAt;
    const checkoutAt = patch.checkoutAt === undefined ? s.checkoutAt : patch.checkoutAt;
    if (checkoutAt && checkoutAt.getTime() <= checkinAt.getTime())
      throw new BadRequestException('Giờ checkout phải sau giờ checkin.');
    // closeReason chỉ đổi khi CALL NÀY thực sự thay đổi checkoutAt — sửa riêng checkinAt không
    // được ghi đè lý do đóng phiên gốc (MANUAL/SHIFT_END/OUT_OF_RANGE), phá mất audit trail.
    await this.assertNoOverlap(s.shiftId, checkinAt, checkoutAt, sessionId, db);
    const closeReason =
      patch.checkoutAt === undefined ? s.closeReason : checkoutAt ? 'ADMIN' : null;
    await db.attendanceSession.update({
      where: { id: sessionId },
      data: { checkinAt, checkoutAt, closeReason },
    });
    return { staffId: s.staffId, workDate: s.shift.workDate };
  }

  /** QL thêm phiên thủ công cho ca (NV quên chấm hẳn). Chạy trong PayrollService.writeInMonth: tính lại lương ngày do writeInMonth làm. */
  async adminAddSession(shiftId: string, checkinAt: Date, checkoutAt: Date, db: Db = this.prisma) {
    if (checkoutAt.getTime() <= checkinAt.getTime())
      throw new BadRequestException('Giờ checkout phải sau giờ checkin.');
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      select: { id: true, staffId: true, workDate: true },
    });
    if (!shift) throw new NotFoundException('Không tìm thấy ca.');
    await this.assertNoOverlap(shiftId, checkinAt, checkoutAt, undefined, db);
    await db.attendanceSession.create({
      data: {
        shiftId,
        staffId: shift.staffId,
        checkinAt,
        checkoutAt,
        checkinLat: 0,
        checkinLng: 0,
        checkinIp: 'admin',
        closeReason: 'ADMIN',
      },
    });
    return { staffId: shift.staffId, workDate: shift.workDate };
  }
}
