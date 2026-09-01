import { CskhService } from './cskh.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(overrides: any = {}) {
  return {
    quickReplyTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ...overrides,
  } as unknown as PrismaService;
}

describe('CskhService.create', () => {
  it('tạo template mới với default sortOrder=0, isActive=true, isGreeting=false', async () => {
    const prisma = makePrisma();
    (prisma as any).quickReplyTemplate.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'q1', ...data }),
    );
    const svc = new CskhService(prisma);
    const out = await svc.create({ keywords: ['ship'], title: 'Phí ship', content: 'Nội thành freeship.' });
    expect(out.sortOrder).toBe(0);
    expect(out.isActive).toBe(true);
    expect(out.isGreeting).toBe(false);
    expect(out.category).toBeNull();
  });
});

describe('CskhService.update / remove', () => {
  it('update gọi prisma.quickReplyTemplate.update với data truyền vào', async () => {
    const prisma = makePrisma();
    (prisma as any).quickReplyTemplate.update.mockResolvedValue({ id: 'q1', title: 'Mới' });
    const svc = new CskhService(prisma);
    await svc.update('q1', { title: 'Mới' });
    expect((prisma as any).quickReplyTemplate.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { title: 'Mới' },
    });
  });

  it('remove xoá template + trả {ok:true}', async () => {
    const prisma = makePrisma();
    (prisma as any).quickReplyTemplate.delete.mockResolvedValue({});
    const svc = new CskhService(prisma);
    const out = await svc.remove('q1');
    expect((prisma as any).quickReplyTemplate.delete).toHaveBeenCalledWith({ where: { id: 'q1' } });
    expect(out).toEqual({ ok: true });
  });
});

describe('CskhService.matchTemplate', () => {
  const TEMPLATES = [
    { id: 't1', isGreeting: false, sortOrder: 1, keywords: ['đổi trả', 'hoàn hàng'] },
    { id: 't2', isGreeting: false, sortOrder: 0, keywords: ['ship', 'phí vận chuyển'] },
  ];

  it('khớp từ khoá case-insensitive substring', async () => {
    const prisma = makePrisma({
      quickReplyTemplate: { findMany: jest.fn().mockResolvedValue(TEMPLATES) },
    });
    const svc = new CskhService(prisma);
    const out = await svc.matchTemplate('Cho hỏi PHÍ SHIP nội thành bao nhiêu?');
    expect(out?.id).toBe('t2');
  });

  it('nhiều template khớp → ưu tiên sortOrder nhỏ nhất (đã ORDER BY asc từ query)', async () => {
    const prisma = makePrisma({
      // findMany trả về đã sort theo sortOrder asc — t2 (sortOrder 0) đứng trước t1 (sortOrder 1).
      quickReplyTemplate: { findMany: jest.fn().mockResolvedValue([TEMPLATES[1], TEMPLATES[0]]) },
    });
    const svc = new CskhService(prisma);
    // Câu chứa cả "ship" (t2) lẫn "đổi trả" (t1) → phải trả t2 vì sortOrder thấp hơn.
    const out = await svc.matchTemplate('Ship rồi mà giờ muốn đổi trả thì sao?');
    expect(out?.id).toBe('t2');
  });

  it('không khớp keyword nào → null', async () => {
    const prisma = makePrisma({
      quickReplyTemplate: { findMany: jest.fn().mockResolvedValue(TEMPLATES) },
    });
    const svc = new CskhService(prisma);
    const out = await svc.matchTemplate('Cho hỏi giờ mở cửa shop?');
    expect(out).toBeNull();
  });

  it('text rỗng → null, không query DB', async () => {
    const prisma = makePrisma();
    const svc = new CskhService(prisma);
    const out = await svc.matchTemplate('   ');
    expect(out).toBeNull();
    expect((prisma as any).quickReplyTemplate.findMany).not.toHaveBeenCalled();
  });
});

describe('CskhService.getGreetingTemplate', () => {
  it('query đúng where isGreeting=true, isActive=true, sort theo sortOrder', async () => {
    const prisma = makePrisma();
    const svc = new CskhService(prisma);
    await svc.getGreetingTemplate();
    expect((prisma as any).quickReplyTemplate.findFirst).toHaveBeenCalledWith({
      where: { isActive: true, isGreeting: true },
      orderBy: { sortOrder: 'asc' },
    });
  });
});
