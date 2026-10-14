import { Test, type TestingModule } from '@nestjs/testing';
import type { ProductApprovalStatus } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AiAdvisorService } from '../../src/modules/ai-advisor/ai-advisor.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import type { LlmClient } from '../../src/modules/ai-advisor/llm.client';
import type { FaqService } from '../../src/modules/faq/faq.service';
import { randCode, warmPool } from './helpers';

/**
 * R2-ENGAGE-4: SP đối tác chờ duyệt/bị từ chối vẫn isActive:true. Trợ lý AI phải dùng cùng điều kiện hiện công khai với
 * catalog: chỉ SP APPROVED + đang bán được gợi ý (và vào system prompt), kèm slug khách bấm vào được.
 */
describe('Trợ lý AI chỉ gợi ý sản phẩm hiện công khai (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let advisor: AiAdvisorService;
  let catalog: CatalogService;
  const tag = randCode(6).toLowerCase();
  // Token chỉ có ở dữ liệu của spec này; không dấu nên khớp nameSearch.
  const keyword = `zzquux${tag}`;

  const llm = { isConfigured: () => false, complete: jest.fn() } as unknown as LlmClient;
  const faq = { listActive: jest.fn().mockResolvedValue([]) } as unknown as FaqService;

  async function product(status: ProductApprovalStatus, over: { isActive?: boolean } = {}) {
    const slug = `it-adv-${status.toLowerCase()}-${over.isActive === false ? 'off' : 'on'}-${tag}`;
    return prisma.product.create({
      data: {
        brand: 'IT Brand',
        slug,
        name: `${keyword} ${status} ${over.isActive === false ? 'off' : 'on'}`,
        description: 'IT',
        basePrice: 100_000,
        approvalStatus: status,
        isActive: over.isActive ?? true,
      },
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    advisor = new AiAdvisorService(prisma, llm, faq);
    catalog = new CatalogService(prisma);
    await product('APPROVED');
    await product('PENDING_REVIEW');
    await product('REJECTED');
    await product('APPROVED', { isActive: false });
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { slug: { endsWith: `-${tag}` } } });
    await moduleRef?.close();
  });

  it('hỏi đúng tên: chỉ SP đã duyệt và đang bán được trả về, không có slug của SP chờ duyệt/từ chối', async () => {
    const r = await advisor.chat('u1', keyword);
    expect(r.products.map((p) => p.slug)).toEqual([`it-adv-approved-on-${tag}`]);
  });

  it('khớp với catalog: cùng truy vấn, catalog.list cũng chỉ thấy SP đó', async () => {
    const list = await catalog.list({ page: 1, limit: 20, q: keyword } as never);
    expect(list.data.map((p: { slug: string }) => p.slug)).toEqual([`it-adv-approved-on-${tag}`]);
  });
});
