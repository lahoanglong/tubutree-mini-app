import { BadRequestException } from '@nestjs/common';
import { AiAdvisorService } from './ai-advisor.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmClient } from './llm.client';

function makePrisma(products: unknown[] = []) {
  return { product: { findMany: jest.fn().mockResolvedValue(products) } } as unknown as PrismaService;
}
function makeLlm(over: Record<string, unknown> = {}) {
  return {
    isConfigured: jest.fn().mockReturnValue(true),
    complete: jest.fn().mockResolvedValue('Xin chào! 🌿'),
    ...over,
  } as unknown as LlmClient;
}

const PRODUCTS = [
  { id: 'p1', name: 'Nước rửa chén sinh học', slug: 'nrc', brand: 'Tubu', shortDesc: 'an toàn', thumbnail: 't', basePrice: 50000, salePrice: 40000 },
];

describe('AiAdvisorService.chat', () => {
  it('câu hỏi trống → BadRequest', async () => {
    await expect(new AiAdvisorService(makePrisma(), makeLlm()).chat('u1', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('LLM chưa cấu hình → trả lời graceful (không gọi complete) + vẫn gợi ý sản phẩm', async () => {
    const llm = makeLlm({ isConfigured: jest.fn().mockReturnValue(false), complete: jest.fn() });
    const r = await new AiAdvisorService(makePrisma(PRODUCTS), llm).chat('u1', 'cần nước rửa chén');
    expect((llm.complete as jest.Mock)).not.toHaveBeenCalled();
    expect(r.products).toHaveLength(1);
    expect(r.reply.length).toBeGreaterThan(0);
  });

  it('hợp lệ → gắn context sản phẩm vào system prompt + gọi complete + trả reply & products', async () => {
    const llm = makeLlm();
    const prisma = makePrisma(PRODUCTS);
    const r = await new AiAdvisorService(prisma, llm).chat('u1', 'cần nước rửa chén an toàn');
    expect(r.reply).toBe('Xin chào! 🌿');
    expect(r.products[0]).toMatchObject({ slug: 'nrc', name: 'Nước rửa chén sinh học', salePrice: 40000 });
    const messages = (llm.complete as jest.Mock).mock.calls[0][0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Nước rửa chén sinh học'); // RAG context
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'cần nước rửa chén an toàn' });
    const where = (prisma.product.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
  });

  it('giữ tối đa 6 lượt lịch sử gần nhất (chống prompt phình)', async () => {
    const llm = makeLlm();
    const history = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `h${i}` }));
    await new AiAdvisorService(makePrisma(), llm).chat('u1', 'hỏi', history);
    const messages = (llm.complete as jest.Mock).mock.calls[0][0];
    expect(messages.length).toBe(8); // system + 6 history + 1 user
  });
});
