import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import {
  AdminController,
  CreateCouponDto,
  DealerAppsQuery,
  DealerPriceHistoryQuery,
  GomdonRetryDto,
  ListOrdersQuery,
  ReturnRequestsQuery,
} from './admin.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

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
    await expect(asQuery(DealerAppsQuery, { status: 'pending' })).rejects.toThrow();
    await expect(asQuery(ReturnRequestsQuery, { status: 'PENDING' })).rejects.toThrow();
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
});

describe('AdminController — quyền + passthrough endpoint thu gom', () => {
  it('@Roles(ADMIN) ở cấp controller; endpoint Gomdon/config KHÔNG hạ quyền ở cấp method', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['ADMIN']);
    for (const m of ['retryGomdon', 'cancelGomdonWaybill', 'gomdonStatus', 'getConfig', 'setConfig', 'orders'] as const) {
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
    expect(admin.listOrders).toHaveBeenCalledWith(1, 20, undefined, undefined, 'attention');
  });
});
