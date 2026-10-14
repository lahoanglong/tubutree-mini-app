import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  AdminController,
  ConfirmOrderPaymentDto,
  CreateCouponDto,
  DealerAppsQuery,
  DealerPriceHistoryQuery,
  GomdonMarkHandledDto,
  GomdonRetryDto,
  ListOrdersQuery,
  ResolvePancakeAttentionDto,
  SetUserRoleDto,
} from './admin.controller';
import { ReturnRequestsQuery, ReturnsAdminController } from '../orders/returns-admin.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

const asBodyDto = (metatype: new () => object, value: Record<string, unknown>) =>
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }).transform(value, {
    type: 'body',
    metatype,
    data: undefined,
  });

// Kiểm chứng 2 finding tồn đọng từ Phase 1 (đã sửa ở admin.controller.ts):
// 1) perUserLimit: @Min(0) — 0 vẫn hợp lệ (= không giới hạn, nhất quán coupons.service.ts).
// 2) value: @MaxIfPercent(100) — chặn admin nhập PERCENT > 100% nhưng KHÔNG áp cho AMOUNT.
describe('CreateCouponDto validation (Phase 1 findings)', () => {
  const base = {
    code: 'SALE10',
    type: 'PERCENT',
    value: 10,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
    scope: 'PUBLIC',
  };

  function makeDto(overrides: Record<string, unknown>) {
    return plainToInstance(CreateCouponDto, { ...base, ...overrides });
  }

  it('perUserLimit âm → lỗi validate (chặn số vô nghĩa)', async () => {
    const errors = await validate(makeDto({ perUserLimit: -1 }));
    expect(errors.some((e) => e.property === 'perUserLimit')).toBe(true);
  });

  it('perUserLimit = 0 → HỢP LỆ (0 = không giới hạn, nhất quán với coupons.service.ts)', async () => {
    const errors = await validate(makeDto({ perUserLimit: 0 }));
    expect(errors.some((e) => e.property === 'perUserLimit')).toBe(false);
  });

  it('perUserLimit không truyền → hợp lệ (optional)', async () => {
    const errors = await validate(makeDto({}));
    expect(errors.some((e) => e.property === 'perUserLimit')).toBe(false);
  });

  it('type=PERCENT, value=500 → lỗi validate (chặn % vô lý)', async () => {
    const errors = await validate(makeDto({ type: 'PERCENT', value: 500 }));
    expect(errors.some((e) => e.property === 'value')).toBe(true);
  });

  it('type=PERCENT, value=100 → hợp lệ (biên trên cho phép)', async () => {
    const errors = await validate(makeDto({ type: 'PERCENT', value: 100 }));
    expect(errors.some((e) => e.property === 'value')).toBe(false);
  });

  it('type=AMOUNT, value=500 → hợp lệ (không giới hạn trên cho AMOUNT)', async () => {
    const errors = await validate(makeDto({ type: 'AMOUNT', value: 500 }));
    expect(errors.some((e) => e.property === 'value')).toBe(false);
  });

  it('value âm → lỗi validate (cả PERCENT lẫn AMOUNT)', async () => {
    const errors = await validate(makeDto({ type: 'AMOUNT', value: -5 }));
    expect(errors.some((e) => e.property === 'value')).toBe(true);
  });
});

// Bug 2 (audit round): code chỉ @IsString() thiếu @IsNotEmpty()/@MaxLength(); startAt/endAt chỉ
// @IsString() thay vì @IsDateString() — ngày sai định dạng lọt qua validation, new Date() ra
// Invalid Date, Prisma serialize RangeError khi ghi → lọt qua PrismaExceptionFilter (chỉ bắt
// PrismaClientKnownRequestError) → 500 trần thay vì 400 rõ ràng cho admin.
describe('CreateCouponDto — code/startAt/endAt validation (Bug 2)', () => {
  const base = {
    code: 'SALE10',
    type: 'PERCENT',
    value: 10,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
    scope: 'PUBLIC',
  };

  function makeDto(overrides: Record<string, unknown>) {
    return plainToInstance(CreateCouponDto, { ...base, ...overrides });
  }

  it('code rỗng → lỗi validate', async () => {
    const errors = await validate(makeDto({ code: '' }));
    expect(errors.some((e) => e.property === 'code')).toBe(true);
  });

  it('code quá dài (>64 ký tự) → lỗi validate', async () => {
    const errors = await validate(makeDto({ code: 'A'.repeat(65) }));
    expect(errors.some((e) => e.property === 'code')).toBe(true);
  });

  it('code hợp lệ → PASS', async () => {
    const errors = await validate(makeDto({ code: 'SALE10' }));
    expect(errors.some((e) => e.property === 'code')).toBe(false);
  });

  it('startAt sai định dạng ngày (vd chuỗi bất kỳ) → lỗi validate thay vì lọt qua tới Prisma', async () => {
    const errors = await validate(makeDto({ startAt: 'khong-phai-ngay' }));
    expect(errors.some((e) => e.property === 'startAt')).toBe(true);
  });

  it('endAt sai định dạng ngày → lỗi validate', async () => {
    const errors = await validate(makeDto({ endAt: 'không phải ngày' }));
    expect(errors.some((e) => e.property === 'endAt')).toBe(true);
  });

  it('startAt/endAt là ISO date string hợp lệ → PASS', async () => {
    const errors = await validate(makeDto({}));
    expect(errors.some((e) => e.property === 'startAt' || e.property === 'endAt')).toBe(false);
  });
});

describe('CreateCouponDto — chuẩn hoá mã + chặn số vô lý (ADMINOPS-7/8)', () => {
  const base = {
    code: 'SALE10',
    type: 'AMOUNT',
    value: 10000,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
    scope: 'PUBLIC',
  };
  const run = (over: Record<string, unknown>) => asBodyDto(CreateCouponDto, { ...base, ...over });

  it('mã chữ thường + khoảng trắng hai đầu → tự chuẩn hoá HOA, bỏ khoảng trắng', async () => {
    const dto = (await run({ code: '  summer10 ' })) as CreateCouponDto;
    expect(dto.code).toBe('SUMMER10');
  });

  it('mã có khoảng trắng ở giữa / ký tự lạ → 400 tiếng Việt', async () => {
    await expect(run({ code: 'sale 50' })).rejects.toMatchObject({ response: { message: expect.arrayContaining([expect.stringContaining('Mã chỉ gồm')]) } });
    await expect(run({ code: 'GIẢM50' })).rejects.toBeDefined();
  });

  it('minOrder/maxDiscount âm, usageLimit âm hoặc 0 → 400', async () => {
    await expect(run({ minOrder: -5 })).rejects.toBeDefined();
    await expect(run({ maxDiscount: -100 })).rejects.toBeDefined();
    await expect(run({ usageLimit: -1 })).rejects.toBeDefined();
    await expect(run({ usageLimit: 0 })).rejects.toBeDefined();
  });

  it('AMOUNT 999.999.999đ → 400 (vượt trần 5.000.000đ)', async () => {
    await expect(run({ value: 999_999_999 })).rejects.toBeDefined();
    await expect(run({ value: 5_000_000 })).resolves.toBeDefined();
  });
});

// Việc 9 (audit round 2): CreateCouponDto thiếu scopeMeta cho scope TIER/USER_GROUP → coupon tạo
// ra fail-closed ở MỌI user trong isCouponEligible (coupon-scope.ts), không lỗi khi tạo — bug
// chức năng im lặng. RequiredScopeMeta() bắt buộc đúng field theo scope.
describe('CreateCouponDto.scopeMeta validation (Việc 9)', () => {
  const base = {
    code: 'SALE10',
    type: 'PERCENT',
    value: 10,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
  };

  function makeDto(overrides: Record<string, unknown>) {
    return plainToInstance(CreateCouponDto, { ...base, ...overrides });
  }

  it('scope=PUBLIC, không truyền scopeMeta → hợp lệ (không bắt buộc)', async () => {
    const errors = await validate(makeDto({ scope: 'PUBLIC' }));
    expect(errors.some((e) => e.property === 'scopeMeta')).toBe(false);
  });

  it('scope=TIER, thiếu scopeMeta hoàn toàn → lỗi validate (tránh coupon fail-closed im lặng)', async () => {
    const errors = await validate(makeDto({ scope: 'TIER' }));
    expect(errors.some((e) => e.property === 'scopeMeta')).toBe(true);
  });

  it('scope=TIER, scopeMeta.tierId rỗng → lỗi validate', async () => {
    const errors = await validate(makeDto({ scope: 'TIER', scopeMeta: { tierId: '   ' } }));
    expect(errors.some((e) => e.property === 'scopeMeta')).toBe(true);
  });

  it('scope=TIER, scopeMeta.tierId hợp lệ → PASS', async () => {
    const errors = await validate(makeDto({ scope: 'TIER', scopeMeta: { tierId: 'GOLD' } }));
    expect(errors.some((e) => e.property === 'scopeMeta')).toBe(false);
  });

  it('scope=USER_GROUP, thiếu scopeMeta hoàn toàn → lỗi validate', async () => {
    const errors = await validate(makeDto({ scope: 'USER_GROUP' }));
    expect(errors.some((e) => e.property === 'scopeMeta')).toBe(true);
  });

  it('scope=USER_GROUP, scopeMeta.userId rỗng → lỗi validate', async () => {
    const errors = await validate(makeDto({ scope: 'USER_GROUP', scopeMeta: { userId: '' } }));
    expect(errors.some((e) => e.property === 'scopeMeta')).toBe(true);
  });

  it('scope=USER_GROUP, scopeMeta.userId hợp lệ → PASS', async () => {
    const errors = await validate(makeDto({ scope: 'USER_GROUP', scopeMeta: { userId: 'u1' } }));
    expect(errors.some((e) => e.property === 'scopeMeta')).toBe(false);
  });

  it('scope=USER_GROUP nhưng gửi nhầm scopeMeta.tierId (thiếu userId) → lỗi validate', async () => {
    const errors = await validate(makeDto({ scope: 'USER_GROUP', scopeMeta: { tierId: 'GOLD' } }));
    expect(errors.some((e) => e.property === 'scopeMeta')).toBe(true);
  });
});

// ── Query có lọc + endpoint thu gom Gomdon ──

/** Đúng cấu hình ValidationPipe toàn cục ở main.ts. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asQuery = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype, data: undefined });
const asBody = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype, data: undefined });

/**
 * Trước đây controller nhận `@Query() q: PaginationQuery` + `@Query('status')` riêng. Với
 * forbidNonWhitelisted, cả object query bị kiểm theo PaginationQuery → `?status=` / `?search=` luôn
 * 400 "property status should not exist": lọc trạng thái + tìm đơn, lọc hồ sơ đại lý (mặc định PENDING),
 * lọc đổi/trả (mặc định REQUESTED) trên web admin đều hỏng.
 */
describe('Query DTO lọc danh sách admin — qua ValidationPipe thật (forbidNonWhitelisted)', () => {
  it('ListOrdersQuery nhận status + search + recycling + page', async () => {
    const q = (await asQuery(ListOrdersQuery, {
      page: '2',
      status: 'CONFIRMED',
      search: 'TB-1',
      recycling: 'attention',
    })) as ListOrdersQuery;
    expect(q).toEqual(expect.objectContaining({ page: 2, limit: 20, status: 'CONFIRMED', search: 'TB-1', recycling: 'attention' }));
  });

  it('ListOrdersQuery từ chối recycling/status lạ', async () => {
    await expect(asQuery(ListOrdersQuery, { recycling: 'bogus' })).rejects.toThrow();
    await expect(asQuery(ListOrdersQuery, { status: 'SHIPPED' })).rejects.toThrow();
  });

  it('DealerAppsQuery / ReturnRequestsQuery nhận status hợp lệ, chặn giá trị lạ (không để Prisma ném 500)', async () => {
    const d = (await asQuery(DealerAppsQuery, { status: 'PENDING', limit: '100' })) as DealerAppsQuery;
    expect(d).toEqual(expect.objectContaining({ status: 'PENDING', limit: 100 }));
    const r = (await asQuery(ReturnRequestsQuery, { status: 'REQUESTED' })) as ReturnRequestsQuery;
    expect(r.status).toBe('REQUESTED');
    expect(((await asQuery(ReturnRequestsQuery, { status: 'TO_RECEIVE' })) as ReturnRequestsQuery).status).toBe('TO_RECEIVE');
    await expect(asQuery(DealerAppsQuery, { status: 'pending' })).rejects.toThrow();
    await expect(asQuery(ReturnRequestsQuery, { status: 'PENDING' })).rejects.toThrow();
  });

  it('DealerAppsQuery / ReturnRequestsQuery nhận order=asc|desc (hàng chờ duyệt xem cũ nhất trước), chặn giá trị lạ', async () => {
    const d = (await asQuery(DealerAppsQuery, { status: 'PENDING', order: 'asc' })) as DealerAppsQuery;
    expect(d).toEqual(expect.objectContaining({ status: 'PENDING', order: 'asc' }));
    const r = (await asQuery(ReturnRequestsQuery, { status: 'REQUESTED', order: 'desc' })) as ReturnRequestsQuery;
    expect(r.order).toBe('desc');
    expect(((await asQuery(ReturnRequestsQuery, {})) as ReturnRequestsQuery).order).toBeUndefined();
    for (const bad of ['ASC', 'random', 'createdAt']) {
      await expect(asQuery(DealerAppsQuery, { order: bad })).rejects.toThrow();
      await expect(asQuery(ReturnRequestsQuery, { order: bad })).rejects.toThrow();
    }
  });

  it('controller chuyển order xuống AdminService (thiếu → undefined, service mặc định desc)', async () => {
    const admin = {
      listDealerApplications: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.dealerApps(Object.assign(new DealerAppsQuery(), { page: 1, limit: 20, status: 'PENDING' as const, order: 'asc' as const }));
    expect(admin.listDealerApplications).toHaveBeenCalledWith('PENDING', 1, 20, 'asc');
    const returns = { listForAdmin: jest.fn().mockResolvedValue({ data: [], meta: {} }) };
    await new ReturnsAdminController(returns as never).list(Object.assign(new ReturnRequestsQuery(), { page: 2, limit: 10 }));
    expect(returns.listForAdmin).toHaveBeenCalledWith(undefined, 2, 10, undefined);
  });

  it('DealerPriceHistoryQuery nhận variationId', async () => {
    const q = (await asQuery(DealerPriceHistoryQuery, { variationId: 'v1' })) as DealerPriceHistoryQuery;
    expect(q.variationId).toBe('v1');
  });

  it('GomdonRetryDto: confirmedNoWaybill boolean tuỳ chọn, chặn field lạ', async () => {
    await expect(asBody(GomdonRetryDto, {})).resolves.toEqual({});
    await expect(asBody(GomdonRetryDto, { confirmedNoWaybill: true })).resolves.toEqual({ confirmedNoWaybill: true });
    await expect(asBody(GomdonRetryDto, { confirmedNoWaybill: 'yes' })).rejects.toThrow();
    await expect(asBody(GomdonRetryDto, { force: true })).rejects.toThrow();
  });

  it('GomdonMarkHandledDto: note chuỗi tuỳ chọn ≤ 500 ký tự, chặn field lạ', async () => {
    await expect(asBody(GomdonMarkHandledDto, {})).resolves.toEqual({});
    await expect(asBody(GomdonMarkHandledDto, { note: 'Đã tạo vận đơn GHN tay' })).resolves.toEqual({ note: 'Đã tạo vận đơn GHN tay' });
    await expect(asBody(GomdonMarkHandledDto, { note: 'x'.repeat(501) })).rejects.toThrow();
    await expect(asBody(GomdonMarkHandledDto, { note: 5 })).rejects.toThrow();
    await expect(asBody(GomdonMarkHandledDto, { gomdonStatus: 'MANUAL_HANDLED' })).rejects.toThrow();
  });
});

describe('AdminController — quyền + passthrough endpoint thu gom', () => {
  it('@Roles(ADMIN) ở cấp controller; endpoint Gomdon/config KHÔNG hạ quyền ở cấp method', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['ADMIN']);
    for (const m of ['retryGomdon', 'cancelGomdonWaybill', 'markGomdonHandled', 'gomdonStatus', 'getConfig', 'setConfig', 'orders'] as const) {
      const methodRoles = Reflect.getMetadata(ROLES_KEY, AdminController.prototype[m]);
      expect(methodRoles === undefined || JSON.stringify(methodRoles) === JSON.stringify(['ADMIN'])).toBe(true);
    }
  });

  it('retry/cancel chuyển đúng tham số xuống AdminService', async () => {
    const admin = {
      retryGomdonPush: jest.fn().mockResolvedValue({ queued: true, message: 'ok' }),
      cancelGomdonWaybill: jest.fn().mockResolvedValue({ result: 'QUEUED', message: 'ok' }),
      listOrders: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.retryGomdon('admin-1', 'o1', { confirmedNoWaybill: true });
    expect(admin.retryGomdonPush).toHaveBeenCalledWith('admin-1', 'o1', true);
    await ctrl.cancelGomdonWaybill('admin-1', 'o1');
    expect(admin.cancelGomdonWaybill).toHaveBeenCalledWith('admin-1', 'o1');
    await ctrl.orders(Object.assign(new ListOrdersQuery(), { page: 1, limit: 20, recycling: 'attention' as const }));
    expect(admin.listOrders).toHaveBeenCalledWith(1, 20, undefined, undefined, 'attention', undefined, undefined, undefined, undefined);
  });

  it('POST orders/:id/gomdon/mark-handled chuyển adminId + id + note xuống AdminService', async () => {
    const admin = { markGomdonHandled: jest.fn().mockResolvedValue({ result: 'MANUAL_HANDLED', message: 'ok' }) };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.markGomdonHandled('admin-1', 'o1', { note: 'đã hẹn lại' });
    expect(admin.markGomdonHandled).toHaveBeenCalledWith('admin-1', 'o1', 'đã hẹn lại');
    expect(Reflect.getMetadata(PATH_METADATA, AdminController.prototype.markGomdonHandled)).toBe('orders/:id/gomdon/mark-handled');
    expect(Reflect.getMetadata(METHOD_METADATA, AdminController.prototype.markGomdonHandled)).toBe(RequestMethod.POST);
  });
});

describe('AdminController — hàng đợi "Cần xử lý Pancake"', () => {
  it('GET /admin/orders nhận ?pancake=attention (giá trị lạ bị chặn) và chuyển xuống listOrders', async () => {
    await expect(asQuery(ListOrdersQuery, { pancake: 'attention' })).resolves.toMatchObject({ pancake: 'attention' });
    await expect(asQuery(ListOrdersQuery, { pancake: 'all' })).rejects.toThrow();
    const admin = { listOrders: jest.fn().mockResolvedValue({ data: [], meta: {} }) };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.orders(Object.assign(new ListOrdersQuery(), { page: 1, limit: 1, pancake: 'attention' as const }));
    expect(admin.listOrders).toHaveBeenCalledWith(1, 1, undefined, undefined, undefined, undefined, 'attention', undefined, undefined);
  });

  it('POST orders/:id/pancake-attention/resolve: chỉ ADMIN, chuyển adminId + id + note; note ≤ 500, chặn field lạ', async () => {
    const admin = { resolvePancakeAttention: jest.fn().mockResolvedValue({ ok: true, message: 'ok' }) };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.resolvePancakeAttention('admin-1', 'o1', { note: 'đã gọi khách' });
    expect(admin.resolvePancakeAttention).toHaveBeenCalledWith('admin-1', 'o1', 'đã gọi khách');
    expect(Reflect.getMetadata(PATH_METADATA, AdminController.prototype.resolvePancakeAttention)).toBe(
      'orders/:id/pancake-attention/resolve',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, AdminController.prototype.resolvePancakeAttention)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, AdminController.prototype.resolvePancakeAttention)).toBeUndefined();
    await expect(asBody(ResolvePancakeAttentionDto, {})).resolves.toEqual({});
    await expect(asBody(ResolvePancakeAttentionDto, { note: 'x'.repeat(501) })).rejects.toThrow();
    await expect(asBody(ResolvePancakeAttentionDto, { pancakeAttention: null })).rejects.toThrow();
  });
});

describe('POST /admin/orders/:id/confirm-payment (C-024)', () => {
  it('route POST, chỉ ADMIN (kế thừa class), chuyển adminId + id + body xuống AdminService', async () => {
    const admin = { confirmOrderPayment: jest.fn().mockResolvedValue({ ok: true }) };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.confirmOrderPayment('admin-1', 'TB-1', { bankRef: 'FT1' });
    expect(admin.confirmOrderPayment).toHaveBeenCalledWith('admin-1', 'TB-1', { bankRef: 'FT1' });
    expect(Reflect.getMetadata(PATH_METADATA, AdminController.prototype.confirmOrderPayment)).toBe('orders/:id/confirm-payment');
    expect(Reflect.getMetadata(METHOD_METADATA, AdminController.prototype.confirmOrderPayment)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['ADMIN']);
  });

  it('body rỗng hợp lệ; mã GD quá dài hoặc không phải chuỗi → lỗi validate', async () => {
    expect(await validate(plainToInstance(ConfirmOrderPaymentDto, {}))).toHaveLength(0);
    const long = await validate(plainToInstance(ConfirmOrderPaymentDto, { bankRef: 'x'.repeat(101) }));
    expect(long.some((e) => e.property === 'bankRef')).toBe(true);
    const notString = await validate(plainToInstance(ConfirmOrderPaymentDto, { note: 123 }));
    expect(notString.some((e) => e.property === 'note')).toBe(true);
  });
});

describe('POST /admin/users/role — tierId cho DEALER (C-008)', () => {
  it('DTO nhận tierId (forbidNonWhitelisted không chặn) và controller chuyển xuống AdminService', async () => {
    const dto = (await asBody(SetUserRoleDto, { phone: '0899625240', role: 'DEALER', tierId: 'dealer_l3' })) as SetUserRoleDto;
    expect(dto).toEqual(expect.objectContaining({ phone: '0899625240', role: 'DEALER', tierId: 'dealer_l3' }));
    const admin = { setUserRole: jest.fn().mockResolvedValue({ ok: true }) };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.setUserRole('admin-1', dto);
    expect(admin.setUserRole).toHaveBeenCalledWith('admin-1', '0899625240', 'DEALER', 'dealer_l3');
  });

  it('tierId sai kiểu / quá dài → 400', async () => {
    await expect(asBody(SetUserRoleDto, { phone: '0899625240', role: 'DEALER', tierId: 5 })).rejects.toThrow();
    await expect(asBody(SetUserRoleDto, { phone: '0899625240', role: 'DEALER', tierId: 'x'.repeat(101) })).rejects.toThrow();
  });
});
