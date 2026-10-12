import { randomInt } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  ACCOUNT_DELETION_BLOCKED,
  ANONYMIZED_NAME,
  AccountDeletionService,
} from '../../src/modules/users/account-deletion.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * C-016 / A1-017 (docs/2026-10-review): yêu cầu xoá tài khoản trước đây chỉ được GHI, không có quy
 * trình xử lý. Admin bấm "Xử lý" → ẩn danh dữ liệu cá nhân trong một transaction, giữ nguyên đơn,
 * hoa hồng, sổ tiền; chặn khi khách còn tiền/việc dở; bấm nhiều lần (hoặc 2 admin cùng bấm) chỉ
 * xử lý đúng một lần.
 */
describe('Xử lý yêu cầu xoá tài khoản (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: AccountDeletionService;
  let admin: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [AccountDeletionService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(AccountDeletionService);
    admin = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function customerWithRequest(data: Parameters<typeof createUser>[1] = {}) {
    const user = await createUser(prisma, {
      phone: randomPhone(),
      zaloId: `zalo-${randCode(8)}`,
      zaloAccessToken: 'enc-access',
      zaloRefreshToken: 'enc-refresh',
      email: `it-${randCode(6).toLowerCase()}@example.com`,
      fullName: 'Nguyễn Văn Thật',
      avatarUrl: 'https://example.com/a.png',
      dob: new Date('1990-05-01'),
      metadata: { segments: ['skin'], onboardedAt: '2026-01-01T00:00:00.000Z' },
      ...data,
    });
    const request = await prisma.accountDeletionRequest.create({ data: { userId: user.id, reason: 'không dùng nữa' } });
    return { user, request };
  }

  it('ẩn danh dữ liệu cá nhân, giữ nguyên đơn/hoa hồng/sổ tiền, thu hồi token, đánh dấu RESOLVED', async () => {
    const { user, request } = await customerWithRequest({ role: 'AFFILIATE' });
    const address = await prisma.address.create({
      data: {
        userId: user.id,
        recipient: 'Nguyễn Văn Thật',
        phone: user.phone!,
        province: 'Hà Nội',
        district: 'Cầu Giấy',
        ward: 'Dịch Vọng',
        street: '12 Ngõ Thật',
        provinceCode: '01',
        districtCode: '005',
        wardCode: '00160',
        isDefault: true,
      },
    });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      total: 250_000,
      note: 'gọi trước số 0912345678',
    });
    const buyer = await createUser(prisma);
    const buyerOrder = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: user.id });
    const commission = await prisma.commission.create({
      data: {
        affiliateUserId: user.id,
        orderId: buyerOrder.id,
        orderTotal: 100_000,
        rate: 10,
        amount: 10_000,
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    const ledger = await prisma.walletTransaction.create({
      data: { userId: user.id, type: 'COMMISSION_PAYOUT', delta: 10_000, balanceAfter: 10_000, refType: 'PAYOUT', refId: commission.id },
    });
    await prisma.refreshToken.createMany({
      data: [
        { userId: user.id, tokenHash: `h-${randCode(12)}`, expiresAt: new Date(Date.now() + 86_400_000) },
        { userId: user.id, tokenHash: `h-${randCode(12)}`, expiresAt: new Date(Date.now() + 86_400_000) },
      ],
    });
    const storefront = await prisma.storefront.create({
      data: {
        type: 'CTV',
        slug: `it-${randCode(8).toLowerCase()}`,
        ownerUserId: user.id,
        title: 'Shop IT',
        bankAccountNo: '0123456789',
        bankAccountName: 'NGUYEN VAN THAT',
        warehousePhone: user.phone,
        warehouseAddress: '12 Ngõ Thật',
        isPublished: true,
      },
    });
    const dealerApp = await prisma.dealerApplication.create({
      data: {
        userId: user.id,
        businessName: 'Cửa hàng IT',
        ownerName: 'Nguyễn Văn Thật',
        phone: user.phone!,
        address: '12 Ngõ Thật',
        cccdFrontUrl: 'https://example.com/cccd-front.jpg',
        cccdBackUrl: 'https://example.com/cccd-back.jpg',
        status: 'REJECTED',
      },
    });

    const res = await svc.process(request.id, admin.id, 'đã gọi xác nhận');
    expect(res.alreadyProcessed).toBe(false);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({
      fullName: ANONYMIZED_NAME,
      phone: null,
      email: null,
      zaloId: null,
      zaloAccessToken: null,
      zaloRefreshToken: null,
      avatarUrl: null,
      dob: null,
      isBlocked: true,
    });
    expect(after.metadata).toMatchObject({ deletionRequestId: request.id });
    expect(JSON.stringify(after.metadata)).not.toContain('skin');

    const addr = await prisma.address.findUniqueOrThrow({ where: { id: address.id } });
    expect(addr.recipient).toBe(ANONYMIZED_NAME);
    expect(addr.phone).toBe('');
    expect(addr.street).toBe('');

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.total).toBe(250_000);
    expect(o.status).toBe('DELIVERED');
    expect(o.userId).toBe(user.id);
    expect(o.note).toBeNull();
    const ship = o.shippingAddress as Record<string, unknown>;
    expect(ship.recipient).toBe(ANONYMIZED_NAME);
    expect(ship.phone).toBe('');
    expect(ship.street).toBe('');
    expect(ship.province).toBe('Ha Noi');

    const c = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(c).toMatchObject({ amount: 10_000, status: 'PAID', affiliateUserId: user.id });
    const l = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: ledger.id } });
    expect(l.delta).toBe(10_000);
    const other = await prisma.order.findUniqueOrThrow({ where: { id: buyerOrder.id } });
    expect((other.shippingAddress as Record<string, unknown>).recipient).toBe('Khach IT');

    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);

    const sf = await prisma.storefront.findUniqueOrThrow({ where: { id: storefront.id } });
    expect(sf).toMatchObject({ isPublished: false, bankAccountNo: null, bankAccountName: null, warehousePhone: null, warehouseAddress: null });

    const da = await prisma.dealerApplication.findUniqueOrThrow({ where: { id: dealerApp.id } });
    expect(da).toMatchObject({ ownerName: ANONYMIZED_NAME, phone: '', address: '', cccdFrontUrl: '', cccdBackUrl: '' });

    const req = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(req).toMatchObject({ status: 'RESOLVED', reviewedBy: admin.id, adminNote: 'đã gọi xác nhận' });
    expect(req.reviewedAt).not.toBeNull();
  });

  it('mã/link giới thiệu cũ không còn ghi công cho tài khoản đã ẩn danh; gian hàng và hoá đơn bỏ thông tin cá nhân', async () => {
    const { user, request } = await customerWithRequest({ role: 'AFFILIATE' });
    const oldCode = user.referralCode;
    const storefront = await prisma.storefront.create({
      data: {
        type: 'CTV',
        slug: oldCode.toLowerCase(),
        ownerUserId: user.id,
        title: 'Shop của Nguyễn Văn Thật',
        headerNote: 'Gọi Thật: 0912345678',
        avatarUrl: 'https://example.com/that.png',
        coverUrl: 'https://example.com/that-cover.png',
        isPublished: true,
      },
    });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      invoiceRequest: { taxCode: '0101234567', companyName: 'Công ty IT', address: '1 Phố IT', email: 'that@example.com' },
      invoiceStatus: 'ISSUED',
    });
    const buyer = await createUser(prisma);
    await prisma.referralTouch.create({
      data: { userId: buyer.id, referrerUserId: user.id, storefrontSlug: storefront.slug, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await svc.process(request.id, admin.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.referralCode).not.toBe(oldCode);
    await expect(prisma.user.findUnique({ where: { referralCode: oldCode.toUpperCase() } })).resolves.toBeNull();
    const touch = await prisma.referralTouch.findUniqueOrThrow({ where: { userId: buyer.id } });
    expect(touch.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());

    const sf = await prisma.storefront.findUniqueOrThrow({ where: { id: storefront.id } });
    expect(sf).toMatchObject({ title: ANONYMIZED_NAME, headerNote: null, avatarUrl: null, coverUrl: null, isPublished: false });

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const inv = o.invoiceRequest as Record<string, unknown>;
    expect(inv.email).toBeUndefined();
    expect(inv).toMatchObject({ taxCode: '0101234567', companyName: 'Công ty IT' });
  });

  async function expectBlocked(requestId: string, userId: string, fragment: RegExp) {
    const err = await svc.process(requestId, admin.id).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as { code: string; message: string; blockers: { code: string }[] };
    expect(body.code).toBe(ACCOUNT_DELETION_BLOCKED);
    expect(body.message).toMatch(fragment);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.fullName).toBe('Nguyễn Văn Thật');
    expect(u.isBlocked).toBe(false);
    const req = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe('PENDING');
    return body;
  }

  it('chặn khi Ví Tubu còn số dư', async () => {
    const { user, request } = await customerWithRequest({ walletBalance: 50_000 });
    await expectBlocked(request.id, user.id, /Ví Tubu còn 50\.000đ/);
  });

  // PD-3: xu đã quy sang Điểm Xanh và bị khoá ở DB (users_coins_frozen) nên không còn chặn theo xu;
  // phần tiền trả trước nằm ở lô quy đổi (ca CONVERTED_POINTS bên dưới).
  it('chặn khi còn hoàn tiền đang chờ', async () => {
    const b = await customerWithRequest({ cashbackPending: 3000 });
    await expectBlocked(b.request.id, b.user.id, /hoàn tiền/i);
  });

  it('PD-3: chặn khi còn Điểm Xanh quy đổi (không hết hạn, không quy ra tiền) chưa dùng', async () => {
    const { user, request } = await customerWithRequest({ pointsConvertedBalance: 3 });
    const body = await expectBlocked(request.id, user.id, /còn 3 Điểm Xanh không hết hạn chưa dùng/);
    expect(body.blockers.map((b) => b.code)).toEqual(['CONVERTED_POINTS']);
  });

  it('chặn khi còn đơn đang xử lý/đang giao', async () => {
    const { user, request } = await customerWithRequest();
    await createOrder(prisma, { userId: user.id, status: 'SHIPPING' });
    await expectBlocked(request.id, user.id, /1 đơn hàng chưa hoàn tất/);
  });

  it('chặn khi còn yêu cầu rút tiền chờ xử lý', async () => {
    const { user, request } = await customerWithRequest({ role: 'AFFILIATE' });
    await prisma.payout.create({ data: { userId: user.id, amount: 100_000, method: 'BANK', status: 'APPROVED' } });
    await expectBlocked(request.id, user.id, /yêu cầu rút tiền/);
  });

  it('chặn khi còn hoa hồng chưa trả, gói định kỳ, đổi trả, công nợ đại lý; liệt kê đủ lý do', async () => {
    const { user, request } = await customerWithRequest({ role: 'DEALER' });
    const buyer = await createUser(prisma);
    const o = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: user.id });
    await prisma.commission.create({
      data: { affiliateUserId: user.id, orderId: o.id, orderTotal: 100_000, rate: 10, amount: 10_000, status: 'LOCKED' },
    });
    const mine = await createOrder(prisma, { userId: user.id, status: 'DELIVERED' });
    await prisma.returnRequest.create({ data: { orderId: mine.id, userId: user.id, reason: 'hỏng' } });
    await prisma.dealerCreditLedger.create({ data: { userId: user.id, delta: -200_000, refType: 'ORDER', refId: mine.id } });
    const body = await expectBlocked(request.id, user.id, /hoa hồng/);
    expect(body.blockers.map((b) => b.code).sort()).toEqual(['COMMISSION_UNPAID', 'DEALER_CREDIT', 'RETURN_PENDING'].sort());
  });

  it('chặn tài khoản quản trị/nhân viên', async () => {
    const { user, request } = await customerWithRequest({ role: 'STAFF' });
    await expectBlocked(request.id, user.id, /quyền/);
  });

  it('yêu cầu không tồn tại → 404', async () => {
    await expect(svc.process('khong-ton-tai', admin.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('2 admin cùng bấm Xử lý đồng thời: chỉ xử lý đúng một lần, các lần sau idempotent', async () => {
    const { user, request } = await customerWithRequest();
    const admin2 = await createUser(prisma, { role: 'ADMIN' });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => svc.process(request.id, i % 2 === 0 ? admin.id : admin2.id)),
    );
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    const fresh = s.fulfilled.filter((r) => !r.value.alreadyProcessed);
    expect(fresh).toHaveLength(1);

    const req = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(req.status).toBe('RESOLVED');
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u.fullName).toBe(ANONYMIZED_NAME);

    const again = await svc.process(request.id, admin.id);
    expect(again.alreadyProcessed).toBe(true);
  });

  it('xử lý một yêu cầu thì đóng luôn các yêu cầu PENDING trùng của cùng khách', async () => {
    const { user, request } = await customerWithRequest();
    const dup = await prisma.accountDeletionRequest.create({ data: { userId: user.id } });
    await svc.process(request.id, admin.id);
    const d = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: dup.id } });
    expect(d.status).toBe('RESOLVED');
  });

  it('danh sách cho admin: kèm thông tin khách và lý do đang bị chặn', async () => {
    const { request } = await customerWithRequest({ walletBalance: 20_000, pointsConvertedBalance: 4 });
    const list = await svc.list('PENDING');
    const row = list.find((r) => r.id === request.id);
    expect(row).toBeDefined();
    expect(row!.user?.fullName).toBe('Nguyễn Văn Thật');
    expect(row!.user?.pointsConvertedBalance).toBe(4);
    expect(row!.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['WALLET_BALANCE', 'CONVERTED_POINTS']));
  });
});
