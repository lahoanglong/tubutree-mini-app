import { AiAdvisorService } from './ai-advisor.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmClient } from './llm.client';
import type { FaqService } from '../faq/faq.service';

function makePrisma(products: unknown[] = []) {
  return { product: { findMany: jest.fn().mockResolvedValue(products) } } as unknown as PrismaService;
}
const offlineLlm = () =>
  ({ isConfigured: jest.fn().mockReturnValue(false), complete: jest.fn() }) as unknown as LlmClient;
const faq = () => ({ listActive: jest.fn().mockResolvedValue([]) }) as unknown as FaqService;

const p = (id: string, name: string) => ({
  id, name, slug: id, brand: 'Tubu', shortDesc: null, thumbnail: null, basePrice: 10000, salePrice: null,
});

async function suggest(query: string, candidates: unknown[]) {
  const prisma = makePrisma(candidates);
  const r = await new AiAdvisorService(prisma, offlineLlm(), faq()).chat('u1', query);
  return { names: r.products.map((x) => x.name), findMany: prisma.product.findMany as jest.Mock };
}

// ENGAGE-15: gợi ý nhạy dấu, token rác ('tôi', 'cho', 'mua') và xếp theo độ nổi bật thay vì độ liên quan.
describe('AiAdvisorService — gợi ý sản phẩm theo độ liên quan (ENGAGE-15)', () => {
  it('gõ không dấu vẫn tìm: tra trên cột nameSearch bằng token đã bỏ dấu (như GET /products?q=)', async () => {
    const { names, findMany } = await suggest('nuoc rua chen', [p('a', 'Nước rửa chén sinh học Fuwa3e')]);
    const where = findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { nameSearch: { contains: 'nuoc' } },
        { nameSearch: { contains: 'rua' } },
        { nameSearch: { contains: 'chen' } },
      ]),
    );
    expect(names).toEqual(['Nước rửa chén sinh học Fuwa3e']);
  });

  it.each(['cho tôi', 'Tôi muốn mua', 'giúp mình với nhé'])(
    'câu chỉ có từ đệm (%s) → không gợi ý gì, không truy vấn DB',
    async (q) => {
      const { names, findMany } = await suggest(q, [p('a', 'Dầu tràm cho bé')]);
      expect(names).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('bỏ từ đệm khỏi điều kiện tìm: "tôi/muốn/mua/cho" không nằm trong OR', async () => {
    const { findMany } = await suggest('Tôi muốn mua nước rửa chén an toàn cho bé', [p('a', 'Nước rửa chén')]);
    const terms = findMany.mock.calls[0][0].where.OR.map((c: { nameSearch: { contains: string } }) => c.nameSearch.contains);
    expect(terms).toEqual(expect.arrayContaining(['nuoc', 'rua', 'chen']));
    for (const noise of ['toi', 'muon', 'mua', 'cho']) expect(terms).not.toContain(noise);
  });

  it('câu nhiều từ khoá: sản phẩm chỉ khớp 1 từ ("Nước tẩy trang", "Nước giặt") bị loại, khớp đủ lên đầu', async () => {
    const { names } = await suggest('nước rửa chén', [
      p('a', 'Nước tẩy trang rau má Visante'),
      p('b', 'Nước giặt sinh học'),
      p('c', 'Nước rửa chén sinh học'),
    ]);
    expect(names).toEqual(['Nước rửa chén sinh học']);
  });

  it('khớp theo nguyên từ: "mat" không dính "Matte" (sáp vuốt tóc)', async () => {
    const { names } = await suggest('mat ong rung', [p('a', 'Sáp vuốt tóc Hector Matte'), p('b', 'Mật ong rừng nguyên chất')]);
    expect(names).toEqual(['Mật ong rừng nguyên chất']);
  });

  it('xếp theo số từ khoá khớp trước, độ nổi bật (thứ tự DB) chỉ để phá hoà', async () => {
    const { names } = await suggest('dầu tràm cho bé an toàn', [
      p('a', 'Dầu massage cho bé'),
      p('b', 'Dầu tràm cho bé'),
      p('c', 'Dầu tràm cho bé an toàn tuyệt đối'),
    ]);
    expect(names).toEqual(['Dầu tràm cho bé an toàn tuyệt đối', 'Dầu tràm cho bé', 'Dầu massage cho bé']);
  });

  it('một từ khoá duy nhất vẫn gợi ý được', async () => {
    const { names } = await suggest('tràm', [p('a', 'Dầu tràm cho bé'), p('b', 'Nước giặt')]);
    expect(names).toEqual(['Dầu tràm cho bé']);
  });

  it('tối đa 5 gợi ý', async () => {
    const many = Array.from({ length: 12 }, (_, i) => p(`p${i}`, `Nước rửa chén loại ${i}`));
    const { names } = await suggest('nước rửa chén', many);
    expect(names).toHaveLength(5);
  });
});
