import { BadRequestException } from '@nestjs/common';
import { AiAdvisorService } from './ai-advisor.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmClient } from './llm.client';
import type { FaqService } from '../faq/faq.service';

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
function makeFaq(entries: unknown[] = []) {
  return { listActive: jest.fn().mockResolvedValue(entries) } as unknown as FaqService;
}

const PRODUCTS = [
  { id: 'p1', name: 'Nước rửa chén sinh học', slug: 'nrc', brand: 'Tubu', shortDesc: 'an toàn', thumbnail: 't', basePrice: 50000, salePrice: 40000 },
];

describe('AiAdvisorService.chat', () => {
  it('câu hỏi trống → BadRequest', async () => {
    await expect(new AiAdvisorService(makePrisma(), makeLlm(), makeFaq()).chat('u1', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('LLM chưa cấu hình → trả lời graceful (không gọi complete) + vẫn gợi ý sản phẩm', async () => {
    const llm = makeLlm({ isConfigured: jest.fn().mockReturnValue(false), complete: jest.fn() });
    const r = await new AiAdvisorService(makePrisma(PRODUCTS), llm, makeFaq()).chat('u1', 'cần nước rửa chén');
    expect((llm.complete as jest.Mock)).not.toHaveBeenCalled();
    expect(r.products).toHaveLength(1);
    expect(r.reply.length).toBeGreaterThan(0);
  });

  it('hợp lệ → gắn context sản phẩm vào system prompt + gọi complete + trả reply & products', async () => {
    const llm = makeLlm();
    const prisma = makePrisma(PRODUCTS);
    const r = await new AiAdvisorService(prisma, llm, makeFaq()).chat('u1', 'cần nước rửa chén an toàn');
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
    await new AiAdvisorService(makePrisma(), llm, makeFaq()).chat('u1', 'hỏi', history);
    const messages = (llm.complete as jest.Mock).mock.calls[0][0];
    expect(messages.length).toBe(8); // system + 6 history + 1 user
  });
});

describe('AiAdvisorService.chat — nạp FAQ vào ngữ cảnh AI', () => {
  const FAQS = [
    { id: 'f1', category: 'Vận chuyển', question: 'Giao hàng mất bao lâu?', answer: 'Nội thành 1-2 ngày, ngoại thành 3-5 ngày.', isActive: true, sortOrder: 0 },
    { id: 'f2', category: 'Đổi trả', question: 'Đổi trả thế nào?', answer: 'Đổi trả trong 7 ngày nếu còn nguyên tem.', isActive: true, sortOrder: 1 },
  ];

  it('có FAQ + LLM cấu hình → system prompt chứa câu hỏi & câu trả lời FAQ', async () => {
    const llm = makeLlm();
    const faq = makeFaq(FAQS);
    await new AiAdvisorService(makePrisma(), llm, faq).chat('u1', 'ship bao lâu vậy shop');
    expect(faq.listActive).toHaveBeenCalled();
    const messages = (llm.complete as jest.Mock).mock.calls[0][0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Giao hàng mất bao lâu?');
    expect(messages[0].content).toContain('Nội thành 1-2 ngày, ngoại thành 3-5 ngày.');
    expect(messages[0].content).toContain('Đổi trả thế nào?');
  });

  it('không có FAQ nào → không có block FAQ trong system prompt, chat vẫn hoạt động bình thường', async () => {
    const llm = makeLlm();
    const faq = makeFaq([]);
    const r = await new AiAdvisorService(makePrisma(), llm, faq).chat('u1', 'hỏi gì đó');
    expect(r.reply).toBe('Xin chào! 🌿');
    const messages = (llm.complete as jest.Mock).mock.calls[0][0];
    expect(messages[0].content).not.toContain('Câu hỏi thường gặp');
  });

  it('giới hạn tối đa 20 FAQ nạp vào prompt (chống phình token)', async () => {
    const llm = makeLlm();
    const manyFaqs = Array.from({ length: 30 }, (_, i) => ({
      id: `f${i}`,
      category: null,
      question: `Câu hỏi số ${i}?`,
      answer: `Trả lời số ${i}.`,
      isActive: true,
      sortOrder: i,
    }));
    const faq = makeFaq(manyFaqs);
    await new AiAdvisorService(makePrisma(), llm, faq).chat('u1', 'hỏi');
    const messages = (llm.complete as jest.Mock).mock.calls[0][0];
    // Chỉ 20 câu đầu được nạp — câu thứ 21 trở đi (index >= 20) không xuất hiện.
    expect(messages[0].content).toContain('Câu hỏi số 19?');
    expect(messages[0].content).not.toContain('Câu hỏi số 20?');
  });

  it('LLM chưa cấu hình → KHÔNG cần gọi FAQ, vẫn trả OFFLINE_REPLY', async () => {
    const llm = makeLlm({ isConfigured: jest.fn().mockReturnValue(false), complete: jest.fn() });
    const faq = makeFaq(FAQS);
    const r = await new AiAdvisorService(makePrisma(), llm, faq).chat('u1', 'hỏi gì đó');
    expect(r.reply.length).toBeGreaterThan(0);
    expect((llm.complete as jest.Mock)).not.toHaveBeenCalled();
  });
});
