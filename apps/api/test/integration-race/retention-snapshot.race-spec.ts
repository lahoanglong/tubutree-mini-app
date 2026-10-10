import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsAggregationService } from '../../src/modules/analytics/analytics-aggregation.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * retention_daily_snapshot (C-101) trên Postgres THẬT: kết quả phải đúng định nghĩa khách hàng
 * (SĐT chuẩn hoá > endCustomerKey của đơn lên hộ > userId), đúng ranh giới ngày giờ VN và đúng "khách mới"
 * (đơn đầu tiên trong đời của khách). Ngày dùng năm 2030 để không đụng dữ liệu của spec khác trong cùng DB.
 */
describe('Retention snapshot (real Postgres)', () => {
  let prisma: PrismaService;
  let svc: AnalyticsAggregationService;
  const tag = randCode(6);
  // Số ngẫu nhiên 9 chữ số để không đụng SĐT unique của spec khác chạy lại trên cùng DB.
  const phoneBase = String(Math.floor(100_000_000 + Math.random() * 800_000_000));

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    svc = new AnalyticsAggregationService(prisma);
    // Chạy lại trên cùng DB: dọn đơn của lần trước trong cửa sổ năm 2030 (chỉ spec này dùng năm đó).
    await prisma.order.deleteMany({ where: { createdAt: { gte: new Date('2029-12-01T00:00:00Z'), lt: new Date('2031-01-01T00:00:00Z') } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const at = (iso: string) => new Date(iso);
  const order = (userId: string, createdAt: string, extra: Record<string, unknown> = {}) =>
    createOrder(prisma, { userId, createdAt: at(createdAt), ...extra });

  it('đếm khách mới / khách hoạt động / đơn trong ngày VN và luỹ kế tháng đúng định nghĩa', async () => {
    // Ngày tính: 2030-03-15 VN = [2030-03-14T17:00Z, 2030-03-15T17:00Z)
    const returning = await createUser(prisma, { phone: `0${phoneBase}` });
    await order(returning.id, '2030-02-10T05:00:00Z'); // đơn trước -> khách cũ
    await order(returning.id, '2030-03-15T03:00:00Z');

    const fresh = await createUser(prisma, { phone: `1${phoneBase}` });
    await order(fresh.id, '2030-03-14T17:00:00Z'); // đúng 00:00 VN ngày 15 -> trong ngày
    await order(fresh.id, '2030-03-15T16:59:59Z'); // 23:59:59 VN -> trong ngày, cùng khách

    // Hai tài khoản cùng SĐT khác định dạng = một khách; đơn trước của tài khoản kia đã HUỶ nên không tính.
    const twinA = await createUser(prisma, { phone: `84${phoneBase}` });
    const twinB = await createUser(prisma, { phone: `+84-${phoneBase}` });
    await order(twinA.id, '2030-03-01T05:00:00Z', { status: 'CANCELLED' });
    await order(twinB.id, '2030-03-15T04:00:00Z');
    // Một cặp khác: đơn trước hợp lệ ở tài khoản này, đơn trong ngày ở tài khoản kia -> khách cũ.
    const twinC = await createUser(prisma, { phone: `85${phoneBase}` });
    const twinD = await createUser(prisma, { phone: `+85-${phoneBase}` });
    await order(twinC.id, '2030-03-02T05:00:00Z', { status: 'DELIVERED' });
    await order(twinD.id, '2030-03-15T05:00:00Z');

    // Không SĐT -> khoá là userId. Có đơn trước -> khách cũ; user không SĐT khác chưa từng mua -> khách mới.
    const noPhoneOld = await createUser(prisma);
    await order(noPhoneOld.id, '2030-01-05T05:00:00Z');
    await order(noPhoneOld.id, '2030-03-15T06:00:00Z');
    const noPhoneNew = await createUser(prisma);
    await order(noPhoneNew.id, '2030-03-15T06:30:00Z');

    // Đơn lên hộ khách: khoá = endCustomerKey. CTV khác nhau nhưng cùng người nhận -> cùng một khách.
    const ctv1 = await createUser(prisma, { phone: `86${phoneBase}` });
    const ctv2 = await createUser(prisma, { phone: `87${phoneBase}` });
    const keyNew = `hash-new-${tag}`;
    const keyOld = `hash-old-${tag}`;
    await order(ctv1.id, '2030-03-15T07:00:00Z', { placedForCustomer: true, endCustomerKey: keyNew });
    await order(ctv1.id, '2030-03-03T07:00:00Z', { placedForCustomer: true, endCustomerKey: keyOld });
    await order(ctv2.id, '2030-03-15T08:00:00Z', { placedForCustomer: true, endCustomerKey: keyOld });
    // Đơn của CTV (không lên hộ) vẫn tính theo SĐT CTV, không bị lẫn với khoá lên hộ: CTV1 chưa từng mua cho mình.
    await order(ctv1.id, '2030-03-15T09:00:00Z');

    // Không được tính: đã huỷ/trả trong ngày, sai loại đơn, sát ngoài ranh giới ngày.
    const noise = await createUser(prisma, { phone: `88${phoneBase}` });
    await order(noise.id, '2030-03-15T05:00:00Z', { status: 'CANCELLED' });
    await order(noise.id, '2030-03-15T05:10:00Z', { status: 'RETURNED' });
    await order(noise.id, '2030-03-15T05:20:00Z', { type: 'DEALER' });
    await order(noise.id, '2030-03-15T17:00:00Z'); // 00:00 VN ngày 16
    await order(noise.id, '2030-03-14T16:59:59Z'); // 23:59:59 VN ngày 14

    const result = await svc.computeRetentionSnapshot('2030-03-15');

    // Khách trong ngày 15: returning, fresh, twin(A/B), twinD, noPhoneOld, noPhoneNew, keyNew, keyOld, ctv1(đơn thường) = 9
    // Đơn trong ngày: 1 + 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1 = 10
    // Khách mới: fresh, twin(A/B), noPhoneNew, keyNew, ctv1(đơn thường) = 5 (còn lại đều đã có đơn hợp lệ trước đó)
    expect(result.activeBuyers).toBe(9);
    expect(result.ordersCount).toBe(10);
    expect(result.newBuyers).toBe(5);
  });

  it('endCustomerKey của đơn lên hộ trùng SĐT chuẩn hoá của tài khoản: cùng một khách ở cả hai chiều', async () => {
    // endCustomerKey là SĐT nội địa 0xxxxxxxxx - cùng không gian khoá với User.phone chuẩn hoá.
    const ctv = await createUser(prisma, { phone: `93${phoneBase}` });

    // Chiều 1: khách tự mua trước, CTV lên hộ cho đúng SĐT đó trong ngày -> khách cũ.
    const selfFirst = await createUser(prisma, { phone: `0${phoneBase.slice(1)}9` });
    await order(selfFirst.id, '2030-09-01T05:00:00Z');
    await order(ctv.id, '2030-09-05T05:00:00Z', { placedForCustomer: true, endCustomerKey: `0${phoneBase.slice(1)}9` });

    // Chiều 2: CTV lên hộ trước, chính khách đó tự mua trong ngày -> khách cũ.
    const proxyKey = `0${phoneBase.slice(1)}8`;
    const selfLater = await createUser(prisma, { phone: proxyKey });
    await order(ctv.id, '2030-09-02T05:00:00Z', { placedForCustomer: true, endCustomerKey: proxyKey });
    await order(selfLater.id, '2030-09-05T06:00:00Z');

    // Đối chứng: khách thật sự mới trong ngày.
    const brandNew = await createUser(prisma, { phone: `0${phoneBase.slice(1)}7` });
    await order(brandNew.id, '2030-09-05T07:00:00Z');

    const result = await svc.computeRetentionSnapshot('2030-09-05');

    expect(result.activeBuyers).toBe(3);
    expect(result.newBuyers).toBe(1);
  });

  it('luỹ kế tháng chỉ tính trong tháng VN, tới hết ngày đang tính', async () => {
    // Tháng 2030-07, ngày tính 2030-07-10.
    const u1 = await createUser(prisma, { phone: `91${phoneBase}` });
    const u2 = await createUser(prisma, { phone: `92${phoneBase}` });
    await order(u1.id, '2030-06-30T16:59:59Z'); // 23:59:59 VN 30/6 -> ngoài tháng 7
    await order(u1.id, '2030-06-30T17:00:00Z'); // 00:00 VN 1/7 -> trong tháng
    await order(u1.id, '2030-07-05T05:00:00Z');
    await order(u2.id, '2030-07-10T05:00:00Z');
    await order(u2.id, '2030-07-10T16:59:59Z'); // 23:59:59 VN 10/7 -> còn trong
    await order(u2.id, '2030-07-10T17:00:00Z'); // 11/7 -> ngoài
    await order(u2.id, '2030-07-20T05:00:00Z'); // sau ngày tính -> ngoài
    await order(u2.id, '2030-07-06T05:00:00Z', { status: 'CANCELLED' });

    const result = await svc.computeRetentionSnapshot('2030-07-10');

    // 4 đơn hợp lệ, 2 khách => 2 đơn/khách
    expect(result.ordersPerBuyerMtd).toBe(2);
    expect(result.ordersCount).toBe(2);
    expect(result.activeBuyers).toBe(1);
  });

  it('ngày không có đơn nào -> toàn số 0, vẫn ghi snapshot', async () => {
    const result = await svc.computeRetentionSnapshot('2030-11-02');
    expect(result).toMatchObject({ newBuyers: 0, activeBuyers: 0, ordersCount: 0, ordersPerBuyerMtd: 0 });
    const row = await prisma.retentionDailySnapshot.findUnique({ where: { date: new Date('2030-11-02') } });
    expect(row).not.toBeNull();
  });
});
