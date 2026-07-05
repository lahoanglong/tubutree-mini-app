import { FaqService } from './faq.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(overrides: any = {}) {
  return {
    faqEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ...overrides,
  } as unknown as PrismaService;
}

describe('FaqService.listActive', () => {
  it('chỉ lấy entry isActive=true, sắp theo sortOrder tăng dần', async () => {
    const prisma = makePrisma();
    const svc = new FaqService(prisma);
    await svc.listActive();
    expect((prisma as any).faqEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: expect.arrayContaining([{ sortOrder: 'asc' }]),
      }),
    );
  });

  it('trả về mảng rỗng khi chưa có FAQ nào (không throw)', async () => {
    const prisma = makePrisma();
    const svc = new FaqService(prisma);
    await expect(svc.listActive()).resolves.toEqual([]);
  });
});

describe('FaqService.listAll (admin)', () => {
  it('lấy tất cả entry, không lọc isActive', async () => {
    const prisma = makePrisma();
    const svc = new FaqService(prisma);
    await svc.listAll();
    const call = (prisma as any).faqEntry.findMany.mock.calls[0][0];
    expect(call.where).toBeUndefined();
  });
});

describe('FaqService.create', () => {
  it('tạo entry mới với default sortOrder=0, isActive=true', async () => {
    const prisma = makePrisma();
    (prisma as any).faqEntry.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'f1', ...data }));
    const svc = new FaqService(prisma);
    const out = await svc.create({ question: 'Ship bao lâu?', answer: 'Nội thành 1-2 ngày.' });
    expect(out.sortOrder).toBe(0);
    expect(out.isActive).toBe(true);
    expect(out.category).toBeNull();
  });

  it('giữ category + sortOrder + isActive khi truyền vào', async () => {
    const prisma = makePrisma();
    (prisma as any).faqEntry.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'f1', ...data }));
    const svc = new FaqService(prisma);
    const out = await svc.create({
      category: 'Vận chuyển',
      question: 'Ship bao lâu?',
      answer: 'Nội thành 1-2 ngày.',
      sortOrder: 5,
      isActive: false,
    });
    expect(out).toMatchObject({ category: 'Vận chuyển', sortOrder: 5, isActive: false });
  });
});

describe('FaqService.update', () => {
  it('gọi prisma.faqEntry.update với data truyền vào', async () => {
    const prisma = makePrisma();
    (prisma as any).faqEntry.update.mockResolvedValue({ id: 'f1', question: 'Q mới' });
    const svc = new FaqService(prisma);
    await svc.update('f1', { question: 'Q mới' });
    expect((prisma as any).faqEntry.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { question: 'Q mới' } });
  });
});

describe('FaqService.remove', () => {
  it('xoá entry + trả {ok:true}', async () => {
    const prisma = makePrisma();
    (prisma as any).faqEntry.delete.mockResolvedValue({});
    const svc = new FaqService(prisma);
    const out = await svc.remove('f1');
    expect((prisma as any).faqEntry.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    expect(out).toEqual({ ok: true });
  });
});
