import { BadRequestException } from '@nestjs/common';
import { AiAdvisorService } from './ai-advisor.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { LlmUnavailableException, type LlmClient } from './llm.client';
import type { FaqService } from '../faq/faq.service';

// Id bắt đầu bằng `g` là tài khoản khách (zaloId guest_*, chưa có SĐT); còn lại là user thật.
function makePrisma(products: unknown[] = []) {
  const findUnique = jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id.startsWith('g') ? { phone: null, zaloId: `guest_${where.id}` } : { phone: null, zaloId: `z_${where.id}` }),
  );
  return { product: { findMany: jest.fn().mockResolvedValue(products) }, user: { findUnique } } as unknown as PrismaService;
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

describe('AiAdvisorService.chat — fallback và giới hạn', () => {
  const svc = (llm: LlmClient) => new AiAdvisorService(makePrisma(PRODUCTS), llm, makeFaq());

  it('LLM timeout → câu xin lỗi "chậm", vẫn kèm sản phẩm, không ném lỗi', async () => {
    const llm = makeLlm({ complete: jest.fn().mockRejectedValue(new LlmUnavailableException('timeout')) });
    const r = await svc(llm).chat('u1', 'cần nước rửa chén');
    expect(r.reply).toContain('phản hồi chậm');
    expect(r.products).toHaveLength(1);
  });

  it('LLM bận (trần toàn hệ thống) → câu xin lỗi "nhiều bạn hỏi"', async () => {
    const llm = makeLlm({ complete: jest.fn().mockRejectedValue(new LlmUnavailableException('busy')) });
    expect((await svc(llm).chat('u1', 'cần nước rửa chén')).reply).toContain('nhiều bạn hỏi');
  });

  it('lỗi lạ chứa khoá/URL → khách chỉ thấy câu offline, không lộ nội dung lỗi', async () => {
    const llm = makeLlm({ complete: jest.fn().mockRejectedValue(new Error('Gateway 500 http://gw:8097 Bearer SECRET')) });
    const r = await svc(llm).chat('u1', 'cần nước rửa chén');
    expect(r.reply).toContain('tạm nghỉ');
    expect(JSON.stringify(r)).not.toMatch(/SECRET|8097|Gateway/);
  });

  it('cắt câu hỏi ở 500 ký tự trước khi vào prompt', async () => {
    const llm = makeLlm();
    await svc(llm).chat('u1', 'y'.repeat(900));
    const messages = (llm.complete as jest.Mock).mock.calls[0][0];
    expect(messages[messages.length - 1].content).toHaveLength(500);
  });

  it('một user hỏi quá 30 lượt/giờ → câu xin nghỉ, không gọi LLM thêm; user khác không bị ảnh hưởng', async () => {
    const llm = makeLlm();
    const s = svc(llm);
    for (let i = 0; i < 30; i++) await s.chat('u1', 'cần nước rửa chén');
    const over = await s.chat('u1', 'cần nước rửa chén');
    expect(over.reply).toContain('hỏi khá nhiều');
    expect(over.products).toHaveLength(1);
    expect(llm.complete).toHaveBeenCalledTimes(30);
    await s.chat('u2', 'cần nước rửa chén');
    expect(llm.complete).toHaveBeenCalledTimes(31);
  });
});

describe('AiAdvisorService.chat — trần chung cho tài khoản khách', () => {
  it('lượt thứ 11 trong phút từ các khách khác nhau bị từ chối, user thật vẫn qua', async () => {
    const llm = makeLlm();
    const s = new AiAdvisorService(makePrisma(PRODUCTS), llm, makeFaq());
    for (let i = 0; i < 10; i++) await s.chat(`g${i}`, 'cần nước rửa chén');
    expect(llm.complete).toHaveBeenCalledTimes(10);
    const refused = await s.chat('g10', 'cần nước rửa chén');
    expect(refused.reply).toContain('nhiều bạn hỏi');
    expect(llm.complete).toHaveBeenCalledTimes(10);
    const real = await s.chat('u1', 'cần nước rửa chén');
    expect(real.reply).toBe('Xin chào! 🌿');
    expect(llm.complete).toHaveBeenCalledTimes(11);
  });

  it('lượt của user thật không tốn phần trần của khách', async () => {
    const llm = makeLlm();
    const s = new AiAdvisorService(makePrisma(PRODUCTS), llm, makeFaq());
    for (let i = 0; i < 20; i++) await s.chat(`u${i}`, 'cần nước rửa chén');
    const guest = await s.chat('g1', 'cần nước rửa chén');
    expect(guest.reply).toBe('Xin chào! 🌿');
  });

  it('qua phút mới thì trần khách được làm mới', async () => {
    const llm = makeLlm();
    const s = new AiAdvisorService(makePrisma(PRODUCTS), llm, makeFaq());
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      for (let i = 0; i < 11; i++) await s.chat(`g${i}`, 'cần nước rửa chén');
      expect(llm.complete).toHaveBeenCalledTimes(10);
      now.mockReturnValue(1_000_000 + 61_000);
      expect((await s.chat('g11', 'cần nước rửa chén')).reply).toBe('Xin chào! 🌿');
    } finally {
      now.mockRestore();
    }
  });

  it('khách bị từ chối vì trần chung không bị trừ vào hạn mức theo giờ của chính mình', async () => {
    const llm = makeLlm();
    const s = new AiAdvisorService(makePrisma(PRODUCTS), llm, makeFaq());
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(2_000_000);
      for (let i = 0; i < 10; i++) await s.chat(`g${i}`, 'cần nước rửa chén');
      for (let i = 0; i < 35; i++) expect((await s.chat('g99', 'cần nước rửa chén')).reply).toContain('nhiều bạn hỏi');
      now.mockReturnValue(2_000_000 + 61_000);
      expect((await s.chat('g99', 'cần nước rửa chén')).reply).toBe('Xin chào! 🌿');
    } finally {
      now.mockRestore();
    }
  });
});

describe('AiAdvisorService.chat — ngữ cảnh sản phẩm trung thực', () => {
  const FULL = {
    ...PRODUCTS[0],
    description: '<p>Nước rửa chén&nbsp;lên men từ vỏ dứa.</p><p>Quy cách 500ml.</p>',
    ingredients: [{ name: 'Enzyme lên men từ vỏ dứa', percentage: 5 }, { name: '  ' }, { name: 'Hương dứa', benefit: 'x' }],
  };
  const systemPromptOf = async (products: unknown[], q = 'nước rửa chén') => {
    const llm = makeLlm();
    const prisma = makePrisma(products);
    const r = await new AiAdvisorService(prisma, llm, makeFaq()).chat('u1', q);
    return { prompt: (llm.complete as jest.Mock).mock.calls[0][0][0].content as string, r, prisma };
  };

  it('nạp mô tả (đã bỏ thẻ HTML) và tên thành phần của sản phẩm vào prompt, không kèm phần trăm', async () => {
    const { prompt } = await systemPromptOf([FULL]);
    expect(prompt).toContain('Mô tả: Nước rửa chén lên men từ vỏ dứa. Quy cách 500ml.');
    expect(prompt).toContain('Thành phần: Enzyme lên men từ vỏ dứa, Hương dứa');
    expect(prompt).not.toMatch(/<\/?p>|&nbsp;/);
    expect(prompt).not.toContain('5%');
  });

  it('thành phần lưu dạng chuỗi (phân tách bằng dấu phẩy/chấm phẩy) cũng đọc được', async () => {
    const { prompt } = await systemPromptOf([{ ...PRODUCTS[0], description: '', ingredients: 'Dầu tràm; Dầu dừa, ' }]);
    expect(prompt).toContain('Thành phần: Dầu tràm, Dầu dừa');
  });

  it('cắt mô tả dài và giới hạn số thành phần để prompt không phình', async () => {
    const long = 'a'.repeat(2000);
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `tp${i}` }));
    const { prompt } = await systemPromptOf([{ ...PRODUCTS[0], description: long, ingredients: many }]);
    const desc = /Mô tả: (.*)/.exec(prompt)![1]!;
    expect(desc.length).toBeLessThanOrEqual(401);
    expect(desc.endsWith('…')).toBe(true);
    const tp = /Thành phần: (.*)/.exec(prompt)![1]!.split(', ');
    expect(tp).toHaveLength(8);
  });

  it('sản phẩm không có mô tả lẫn thành phần: không bịa dòng nào, ghi rõ là chưa có', async () => {
    const { prompt } = await systemPromptOf([{ ...PRODUCTS[0], description: '  ', ingredients: [] }]);
    expect(prompt).not.toContain('Mô tả:');
    expect(prompt).not.toContain('Thành phần:');
    expect(prompt).toContain('chưa có mô tả hay thành phần chi tiết');
  });

  it('tên thành phần hỏng ("[object Object]" do nhập sai) không vào prompt', async () => {
    const { prompt } = await systemPromptOf([{ ...PRODUCTS[0], description: '', ingredients: [{ name: '[object Object]' }, { name: 'Dầu dừa' }] }]);
    expect(prompt).toContain('Thành phần: Dầu dừa');
    expect(prompt).not.toContain('[object Object]');
  });

  it('DB trả thiếu cột (mock cũ, null) vẫn không lỗi', async () => {
    const { prompt } = await systemPromptOf([{ ...PRODUCTS[0], description: null, ingredients: null }]);
    expect(prompt).toContain('chưa có mô tả hay thành phần chi tiết');
  });

  it('truy vấn chọn thêm description và ingredients', async () => {
    const { prisma } = await systemPromptOf([FULL]);
    const select = (prisma.product.findMany as jest.Mock).mock.calls[0][0].select;
    expect(select).toMatchObject({ description: true, ingredients: true });
  });

  it('danh sách products trả cho khách KHÔNG lộ description/ingredients (chỉ các trường gợi ý như trước)', async () => {
    const { r } = await systemPromptOf([FULL]);
    expect(Object.keys(r.products[0]!).sort()).toEqual(['basePrice', 'brand', 'id', 'name', 'salePrice', 'shortDesc', 'slug', 'thumbnail']);
  });

  describe('luật trung thực trong system prompt', () => {
    it.each([
      ['chỉ nêu điều có trong dữ liệu', 'Chỉ nêu thông tin CÓ trong dữ liệu'],
      ['không bịa', 'Không bịa'],
      ['cấm chữa bệnh/điều trị', 'chữa bệnh'],
      ['cấm ví dụ trị rụng tóc', 'trị rụng tóc'],
      ['cấm kháng khuẩn kèm phần trăm', 'kháng khuẩn 99%'],
      ['cấm chứng nhận không có trong dữ liệu', 'chứng nhận'],
      ['thiếu dữ liệu thì nói chưa có thông tin', 'chưa có thông tin'],
    ])('%s', async (_name, needle) => {
      const { prompt } = await systemPromptOf([FULL]);
      expect(prompt).toContain(needle);
    });

    it('luật vẫn có khi không tìm thấy sản phẩm khớp', async () => {
      const { prompt } = await systemPromptOf([], 'xyz lạ hoắc');
      expect(prompt).toContain('chữa bệnh');
      expect(prompt).toContain('Chỉ nêu thông tin CÓ trong dữ liệu');
    });

    it('vẫn giữ luật cũ: chỉ gợi ý sản phẩm trong danh sách, không bịa tên hay giá', async () => {
      const { prompt } = await systemPromptOf([FULL]);
      expect(prompt).toContain('CHỈ gợi ý sản phẩm trong danh sách dưới đây');
      expect(prompt).toContain('Không bịa tên sản phẩm hay giá');
    });
  });
});
