import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { THROTTLER_LIMIT, THROTTLER_TRACKER, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AffiliateController, LinkClickDto } from './affiliate.controller';
import { AffiliateService } from './affiliate.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makeService(
  link: { id: string; targetType: string; targetId: string | null } | null,
  transactionResult: () => Promise<unknown> = () => Promise.resolve([]),
) {
  const linkUpdate = jest.fn().mockReturnValue('LINK_UPDATE');
  const clickCreate = jest.fn().mockReturnValue('CLICK_CREATE');
  const transaction = jest.fn().mockImplementation(transactionResult);
  const prisma = {
    affiliateLink: { findUnique: jest.fn().mockResolvedValue(link), update: linkUpdate },
    affiliateClick: { create: clickCreate },
    $transaction: transaction,
  } as unknown as PrismaService;
  const svc = new AffiliateService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, linkUpdate, clickCreate, transaction };
}

// 05:00 UTC = 12:00 giờ VN, ngày 2026-10-18.
const NOW = new Date('2026-10-18T05:00:00.000Z');

describe('AffiliateService.recordLinkClick (D3-06)', () => {
  it('link có thật → +1 click trên link và ghi một dòng AffiliateClick, trong cùng một giao dịch', async () => {
    const { svc, linkUpdate, clickCreate, transaction } = makeService({ id: 'l1', targetType: 'HOMEPAGE', targetId: null });
    await expect(svc.recordLinkClick('aB3_x-9', '203.0.113.7', NOW)).resolves.toEqual({ counted: true });
    expect(linkUpdate).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { clicks: { increment: 1 } } });
    expect(clickCreate).toHaveBeenCalledWith({
      data: { shortCode: 'aB3_x-9', visitorId: expect.any(String), ipHash: expect.any(String), dedupeDay: '2026-10-18' },
    });
    expect(transaction).toHaveBeenCalledWith(['LINK_UPDATE', 'CLICK_CREATE']);
  });

  it('không lưu IP thô; cùng IP ra cùng mã băm, IP khác ra mã khác', async () => {
    const a = makeService({ id: 'l1', targetType: 'HOMEPAGE', targetId: null });
    await a.svc.recordLinkClick('aB3_x-9', '203.0.113.7', NOW);
    await a.svc.recordLinkClick('aB3_x-9', '203.0.113.7', NOW);
    await a.svc.recordLinkClick('aB3_x-9', '203.0.113.8', NOW);
    const rows = a.clickCreate.mock.calls.map((c) => c[0].data as { visitorId: string; ipHash: string });
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
    expect(rows[0]!.ipHash).toBe(rows[1]!.ipHash);
    expect(rows[0]!.ipHash).not.toBe(rows[2]!.ipHash);
    expect(rows[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('khử trùng phía máy chủ theo (mã link, IP băm, ngày VN)', () => {
    const p2002 = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

    it('khoá duy nhất đã có (cùng mã, cùng IP, cùng ngày) → không đếm thêm, không lỗi', async () => {
      const { svc } = makeService({ id: 'l1', targetType: 'HOMEPAGE', targetId: null }, () => Promise.reject(p2002()));
      await expect(svc.recordLinkClick('aB3_x-9', '203.0.113.7', NOW)).resolves.toEqual({ counted: false });
    });

    it('lỗi khác P2002 vẫn nổi lên (không nuốt lỗi DB)', async () => {
      const { svc } = makeService({ id: 'l1', targetType: 'HOMEPAGE', targetId: null }, () => Promise.reject(new Error('db down')));
      await expect(svc.recordLinkClick('aB3_x-9', '203.0.113.7', NOW)).rejects.toThrow('db down');
    });

    it('khoá ngày theo giờ VN: 17:01 UTC đã là ngày hôm sau ở VN', async () => {
      const a = makeService({ id: 'l1', targetType: 'HOMEPAGE', targetId: null });
      await a.svc.recordLinkClick('aB3_x-9', '203.0.113.7', new Date('2026-10-18T16:59:00.000Z'));
      await a.svc.recordLinkClick('aB3_x-9', '203.0.113.7', new Date('2026-10-18T17:01:00.000Z'));
      const days = a.clickCreate.mock.calls.map((c) => (c[0].data as { dedupeDay: string }).dedupeDay);
      expect(days).toEqual(['2026-10-18', '2026-10-19']);
    });
  });

  it('mã link không tồn tại → không đếm gì, không lỗi', async () => {
    const { svc, transaction } = makeService(null);
    await expect(svc.recordLinkClick('zzzzzzz', '203.0.113.7', NOW)).resolves.toEqual({ counted: false });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('POST /affiliate/click', () => {
  const handler = AffiliateController.prototype.click;

  it('công khai (web chưa đăng nhập cũng gọi được) nhưng có giới hạn tốc độ theo IP', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBeLessThanOrEqual(30);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(60_000);
  });

  it('bộ đếm giới hạn luôn theo IP, kể cả khi request mang JWT của một user khác', () => {
    const tracker = Reflect.getMetadata(`${THROTTLER_TRACKER}default`, handler) as (req: unknown) => string;
    expect(typeof tracker).toBe('function');
    expect(tracker({ ip: '203.0.113.7', user: { sub: 'u1' }, headers: { authorization: 'Bearer x' } })).toBe('ip:203.0.113.7');
  });

  it('chuyển mã link và IP cho service', async () => {
    const affiliate = { recordLinkClick: jest.fn().mockResolvedValue({ counted: true }) };
    const c = new AffiliateController(affiliate as never);
    const out = await c.click({ shortCode: 'aB3_x-9' }, { ip: '203.0.113.7' } as never);
    expect(out).toEqual({ counted: true });
    expect(affiliate.recordLinkClick).toHaveBeenCalledWith('aB3_x-9', '203.0.113.7');
  });

  describe('DTO qua ValidationPipe', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: LinkClickDto });

    it('nhận mã dạng base64url do createLink sinh', async () => {
      await expect(run({ shortCode: 'aB3_x-9' })).resolves.toBeDefined();
    });

    it.each([[{}], [{ shortCode: '' }], [{ shortCode: 'a b' }], [{ shortCode: 'x'.repeat(33) }], [{ shortCode: 'ab' }], [{ shortCode: 5 }], [{ shortCode: 'abcd', extra: 1 }]])(
      'từ chối %j',
      async (body) => {
        await expect(run(body)).rejects.toThrow();
      },
    );
  });
});
