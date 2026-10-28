import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AffiliateService } from './affiliate.service';
import { RegisterAffiliateDto } from './dto/register-affiliate.dto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { RewardPointsService } from '../wallet/reward-points.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { SessionStateService } from '../auth/session-state.service';

const noop = {} as never;

function makeService(user: Record<string, unknown>, sessionState?: SessionStateService) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user), update },
  } as unknown as PrismaService;
  const svc = new AffiliateService(
    prisma,
    noop as SystemConfigService,
    noop as PricingService,
    noop as PancakeOrderService,
    noop as RewardPointsService,
    noop as AnalyticsEventsService,
    undefined,
    undefined,
    undefined,
    sessionState,
  );
  return { svc, update };
}

describe('AffiliateService.register — ghi nhận đồng ý điều khoản CTV (C-117)', () => {
  it('đăng ký kèm termsVersion: lên role AFFILIATE và lưu phiên bản + thời điểm đồng ý, giữ metadata cũ', async () => {
    const { svc, update } = makeService({
      id: 'u1', role: 'CUSTOMER', referralCode: 'TUBU1', metadata: { segments: ['eco'] },
    });
    const before = Date.now();
    const res = await svc.register('u1', '2026-10');
    expect(res).toEqual({ ok: true, referralCode: 'TUBU1' });
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.role).toBe('AFFILIATE');
    expect(data.metadata.segments).toEqual(['eco']);
    expect(data.metadata.affiliateTerms.version).toBe('2026-10');
    const at = Date.parse(data.metadata.affiliateTerms.acceptedAt);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('đổi vai trò lên AFFILIATE thì xoá bản nhớ phiên, để route CTV (Học viện) không còn thấy vai trò cũ', async () => {
    const invalidate = jest.fn();
    const { svc } = makeService({ id: 'u1', role: 'CUSTOMER', referralCode: 'TUBU1', metadata: null }, { invalidate } as unknown as SessionStateService);
    await svc.register('u1', '2026-10');
    expect(invalidate).toHaveBeenCalledWith('u1');
  });

  it('đã là AFFILIATE (không đổi vai trò) thì không cần xoá bản nhớ', async () => {
    const invalidate = jest.fn();
    const { svc } = makeService({ id: 'u1', role: 'AFFILIATE', referralCode: 'TUBU1', metadata: null }, { invalidate } as unknown as SessionStateService);
    await svc.register('u1', '2026-10');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('metadata đang rỗng (null) vẫn lưu được', async () => {
    const { svc, update } = makeService({ id: 'u1', role: 'CUSTOMER', referralCode: 'TUBU1', metadata: null });
    await svc.register('u1', '2026-10');
    expect(update.mock.calls[0][0].data.metadata.affiliateTerms.version).toBe('2026-10');
  });

  it('client cũ không gửi termsVersion: vẫn đăng ký được, không ghi metadata', async () => {
    const { svc, update } = makeService({ id: 'u1', role: 'CUSTOMER', referralCode: 'TUBU1', metadata: { a: 1 } });
    await svc.register('u1');
    const data = update.mock.calls[0][0].data;
    expect(data).toEqual({ role: 'AFFILIATE' });
  });

  it('termsVersion chỉ toàn khoảng trắng coi như không gửi', async () => {
    const { svc, update } = makeService({ id: 'u1', role: 'CUSTOMER', referralCode: 'TUBU1', metadata: null });
    await svc.register('u1', '   ');
    expect(update.mock.calls[0][0].data).toEqual({ role: 'AFFILIATE' });
  });

  it('đã là CTV và đã đồng ý đúng phiên bản này: không ghi đè thời điểm đồng ý đầu tiên', async () => {
    const { svc, update } = makeService({
      id: 'u1', role: 'AFFILIATE', referralCode: 'TUBU1',
      metadata: { affiliateTerms: { version: '2026-10', acceptedAt: '2026-10-01T00:00:00.000Z' } },
    });
    await svc.register('u1', '2026-10');
    expect(update).not.toHaveBeenCalled();
  });

  it('đã là CTV nhưng đồng ý phiên bản điều khoản mới: ghi phiên bản mới, không đổi role', async () => {
    const { svc, update } = makeService({
      id: 'u1', role: 'AFFILIATE', referralCode: 'TUBU1',
      metadata: { affiliateTerms: { version: '2026-10', acceptedAt: '2026-10-01T00:00:00.000Z' } },
    });
    await svc.register('u1', '2027-01');
    const data = update.mock.calls[0][0].data;
    expect(data.role).toBeUndefined();
    expect(data.metadata.affiliateTerms.version).toBe('2027-01');
  });

  it('tài khoản DEALER/ADMIN/STAFF vẫn bị chặn, không ghi gì', async () => {
    for (const role of ['DEALER', 'ADMIN', 'STAFF']) {
      const { svc, update } = makeService({ id: 'u1', role, referralCode: 'X', metadata: null });
      await expect(svc.register('u1', '2026-10')).rejects.toThrow('không thể đăng ký CTV');
      expect(update).not.toHaveBeenCalled();
    }
  });
});

describe('RegisterAffiliateDto', () => {
  const errs = async (plain: Record<string, unknown>) =>
    (await validate(plainToInstance(RegisterAffiliateDto, plain), { whitelist: true, forbidNonWhitelisted: true }))
      .flatMap((e) => Object.keys(e.constraints ?? {}));

  it('cho phép body rỗng (client cũ) và termsVersion ngắn', async () => {
    expect(await errs({})).toEqual([]);
    expect(await errs({ termsVersion: '2026-10' })).toEqual([]);
  });
  it('từ chối termsVersion quá dài hoặc không phải chuỗi', async () => {
    expect((await errs({ termsVersion: 'x'.repeat(33) })).length).toBeGreaterThan(0);
    expect((await errs({ termsVersion: 5 })).length).toBeGreaterThan(0);
  });
});
