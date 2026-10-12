import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AttendanceService } from '../../src/modules/staff/attendance/attendance.service';
import { createUser, setConfig, warmPool } from './helpers';

/**
 * C-056 trên Postgres THẬT: heartbeat ngoài vùng chỉ tự chấm ra sau N nhịp liên tiếp (hoặc M phút ngoài vùng),
 * bộ đếm tăng nguyên tử khi nhiều heartbeat song song, và phiên đã đóng không bị ghi đè.
 */
describe('Chấm công: heartbeat ngoài vùng (real Postgres)', () => {
  let prisma: PrismaService;
  const IN_IP = '113.161.1.5';
  const OUT_IP = '8.8.8.8';
  const HERE = { lat: 10.7769, lng: 106.7009 };
  const KEYS = [
    'attendance.office_ips',
    'attendance.office_lat',
    'attendance.office_lng',
    'attendance.radius_m',
    'attendance.enforce_ip',
    'attendance.out_of_range_max_count',
    'attendance.out_of_range_max_min',
  ];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await setConfig(prisma, 'attendance.office_ips', ['113.161.1.0/24']);
    await setConfig(prisma, 'attendance.office_lat', 10.7769);
    await setConfig(prisma, 'attendance.office_lng', 106.7009);
    await setConfig(prisma, 'attendance.radius_m', 150);
    await setConfig(prisma, 'attendance.enforce_ip', true);
  });

  afterAll(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { in: KEYS } } });
    await prisma?.$disconnect();
  });

  // SystemConfigService cache 60s theo instance → mỗi kịch bản dựng instance mới sau khi ghi config.
  async function svcWith(maxCount: number, maxMin = 15) {
    await setConfig(prisma, 'attendance.out_of_range_max_count', maxCount);
    await setConfig(prisma, 'attendance.out_of_range_max_min', maxMin);
    return new AttendanceService(prisma, new SystemConfigService(prisma));
  }

  async function openSession() {
    const staff = await createUser(prisma, { role: 'STAFF' });
    const now = Date.now();
    const shift = await prisma.shift.create({
      data: {
        staffId: staff.id,
        workDate: new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00.000Z'),
        startAt: new Date(now - 3 * 3600_000),
        endAt: new Date(now + 5 * 3600_000),
        status: 'APPROVED',
      },
    });
    const session = await prisma.attendanceSession.create({
      data: {
        shiftId: shift.id,
        staffId: staff.id,
        checkinAt: new Date(now - 3 * 3600_000),
        checkinLat: HERE.lat,
        checkinLng: HERE.lng,
        checkinIp: IN_IP,
      },
    });
    return { staff, shift, session };
  }

  const reload = (id: string) => prisma.attendanceSession.findUniqueOrThrow({ where: { id } });

  it('một nhịp ngoài vùng KHÔNG chấm ra; nhịp hợp lệ kế tiếp reset bộ đếm', async () => {
    const svc = await svcWith(3);
    const { staff, session } = await openSession();

    const r1 = await svc.heartbeat(staff.id, OUT_IP, HERE);
    expect(r1).toMatchObject({ open: true, outOfRange: true, missed: 1, maxMissed: 3 });
    let row = await reload(session.id);
    expect(row.checkoutAt).toBeNull();
    expect(row.outOfRangeCount).toBe(1);
    expect(row.outOfRangeSince).not.toBeNull();

    const r2 = await svc.heartbeat(staff.id, IN_IP, HERE);
    expect(r2).toEqual({ open: true });
    row = await reload(session.id);
    expect(row.outOfRangeCount).toBe(0);
    expect(row.outOfRangeSince).toBeNull();
    expect(row.checkoutAt).toBeNull();
  });

  it('chuỗi ngoài vùng bị cắt bởi một nhịp hợp lệ thì đếm lại từ đầu (2 + hợp lệ + 2 vẫn mở)', async () => {
    const svc = await svcWith(3);
    const { staff, session } = await openSession();
    await svc.heartbeat(staff.id, OUT_IP, HERE);
    await svc.heartbeat(staff.id, OUT_IP, HERE);
    await svc.heartbeat(staff.id, IN_IP, HERE);
    await svc.heartbeat(staff.id, OUT_IP, HERE);
    const last = await svc.heartbeat(staff.id, OUT_IP, HERE);
    expect(last).toMatchObject({ open: true, outOfRange: true, missed: 2 });
    expect((await reload(session.id)).checkoutAt).toBeNull();
  });

  it('đủ N nhịp liên tiếp → đóng OUT_OF_RANGE, giờ ra = nhịp ngoài vùng đầu tiên (không phải nhịp thứ N)', async () => {
    const svc = await svcWith(3);
    const { staff, session } = await openSession();
    await svc.heartbeat(staff.id, OUT_IP, HERE);
    const first = (await reload(session.id)).outOfRangeSince as Date;
    await svc.heartbeat(staff.id, OUT_IP, HERE);
    const r3 = await svc.heartbeat(staff.id, OUT_IP, HERE);
    expect(r3).toEqual({ open: false, closed: true, reason: 'IP_NOT_ALLOWED' });
    const row = await reload(session.id);
    expect(row.closeReason).toBe('OUT_OF_RANGE');
    expect(row.checkoutAt?.getTime()).toBe(first.getTime());
  });

  it('heartbeat thưa: chuỗi ngoài vùng ≥ M phút → đóng dù chưa đủ N nhịp, giờ ra = mốc bắt đầu chuỗi', async () => {
    const svc = await svcWith(10, 15);
    const { staff, session } = await openSession();
    const since = new Date(Date.now() - 40 * 60_000);
    await prisma.attendanceSession.update({
      where: { id: session.id },
      data: { outOfRangeCount: 1, outOfRangeSince: since },
    });
    const out = await svc.heartbeat(staff.id, OUT_IP, HERE);
    expect(out).toMatchObject({ open: false, closed: true });
    const row = await reload(session.id);
    expect(row.closeReason).toBe('OUT_OF_RANGE');
    expect(row.checkoutAt?.getTime()).toBe(since.getTime());
  });

  it('10 heartbeat ngoài vùng SONG SONG (N=100) → bộ đếm = 10, không mất nhịp, phiên vẫn mở', async () => {
    const svc = await svcWith(100);
    const { staff, session } = await openSession();
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.heartbeat(staff.id, OUT_IP, HERE)));
    expect(results.every((r) => r.open === true)).toBe(true);
    const row = await reload(session.id);
    expect(row.outOfRangeCount).toBe(10);
    expect(row.checkoutAt).toBeNull();
    expect(row.outOfRangeSince).not.toBeNull();
  });

  it('8 heartbeat ngoài vùng SONG SONG (N=3) → phiên đóng đúng một lần với OUT_OF_RANGE, giờ ra không đổi sau đó', async () => {
    const svc = await svcWith(3);
    const { staff, session } = await openSession();
    await Promise.all(Array.from({ length: 8 }, () => svc.heartbeat(staff.id, OUT_IP, HERE)));
    const row = await reload(session.id);
    expect(row.closeReason).toBe('OUT_OF_RANGE');
    expect(row.checkoutAt).not.toBeNull();
    expect(row.checkoutAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row.checkoutAt!.getTime()).toBeGreaterThan(row.checkinAt.getTime());
    const again = await svc.heartbeat(staff.id, OUT_IP, HERE);
    expect(again).toEqual({ open: false });
    expect((await reload(session.id)).checkoutAt!.getTime()).toBe(row.checkoutAt!.getTime());
  });

  it('phiên đã được QL đóng trước → heartbeat ngoài vùng muộn không mở lại, không ghi đè giờ ra/lý do đóng', async () => {
    const svc = await svcWith(1);
    const { staff, session } = await openSession();
    const adminOut = new Date(Date.now() - 60_000);
    await prisma.attendanceSession.update({
      where: { id: session.id },
      data: { checkoutAt: adminOut, closeReason: 'ADMIN' },
    });
    expect(await svc.heartbeat(staff.id, OUT_IP, HERE)).toEqual({ open: false });
    const row = await reload(session.id);
    expect(row.closeReason).toBe('ADMIN');
    expect(row.checkoutAt!.getTime()).toBe(adminOut.getTime());
  });
});
