import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { createUser, randCode, warmPool } from './helpers';

/**
 * POST /affiliate/click khử trùng bằng ràng buộc duy nhất (shortCode, ipHash, dedupeDay): nhiều request song song cùng IP chỉ đếm
 * một lần, và lần bị chặn hoàn tác luôn phần +1 clicks của link (giao dịch dạng mảng).
 */
describe('AffiliateService.recordLinkClick (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        { provide: AffiliateService, useFactory: (p: PrismaService) => new AffiliateService(p, {} as never, {} as never, {} as never, {} as never, {} as never), inject: [PrismaService] },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const day1 = new Date('2026-10-18T05:00:00.000Z');
  const day2 = new Date('2026-10-19T05:00:00.000Z');

  async function makeLink() {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const shortCode = `it${randCode(8)}`;
    await prisma.affiliateLink.create({ data: { userId: ctv.id, shortCode, targetType: 'HOMEPAGE' } });
    return shortCode;
  }
  const clicksOf = async (shortCode: string) => (await prisma.affiliateLink.findUniqueOrThrow({ where: { shortCode } })).clicks;
  const rowsOf = (shortCode: string) => prisma.affiliateClick.count({ where: { shortCode } });

  it('8 request song song cùng IP cùng ngày → đếm đúng 1 lần, clicks và số dòng khớp nhau', async () => {
    const code = await makeLink();
    const results = await Promise.all(Array.from({ length: 8 }, () => affiliate.recordLinkClick(code, '203.0.113.7', day1)));
    expect(results.filter((r) => r.counted)).toHaveLength(1);
    expect(await clicksOf(code)).toBe(1);
    expect(await rowsOf(code)).toBe(1);
  });

  it('IP khác đếm riêng; sang ngày VN khác thì cùng IP đếm lại', async () => {
    const code = await makeLink();
    expect(await affiliate.recordLinkClick(code, '203.0.113.7', day1)).toEqual({ counted: true });
    expect(await affiliate.recordLinkClick(code, '203.0.113.8', day1)).toEqual({ counted: true });
    expect(await affiliate.recordLinkClick(code, '203.0.113.7', day1)).toEqual({ counted: false });
    expect(await affiliate.recordLinkClick(code, '203.0.113.7', day2)).toEqual({ counted: true });
    expect(await clicksOf(code)).toBe(3);
    expect(await rowsOf(code)).toBe(3);
  });

  it('mã link không tồn tại → không đếm, không lỗi', async () => {
    expect(await affiliate.recordLinkClick(`zz${randCode(8)}`, '203.0.113.7', day1)).toEqual({ counted: false });
  });
});
