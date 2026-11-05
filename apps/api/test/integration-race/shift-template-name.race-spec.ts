import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ShiftsService } from '../../src/modules/staff/shifts/shifts.service';
import { randCode, warmPool } from './helpers';

/** Kiểm tên ca chuẩn trên Postgres thật: `_` và `%` là ký tự thường (Prisma `mode: insensitive` dịch thành ILIKE nên từng coi chúng là ký tự đại diện). */
describe('ShiftsService.createTemplate / updateTemplate — so tên ca chuẩn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: ShiftsService;
  const created: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = new ShiftsService(prisma, { get: async (_k: string, d: number) => d } as never);
  });

  afterAll(async () => {
    await prisma.shiftTemplate.deleteMany({ where: { id: { in: created } } });
    await moduleRef?.close();
  });

  const make = async (name: string) => {
    const t = await svc.createTemplate({ name, startMin: 480, endMin: 720 });
    created.push(t.id);
    return t;
  };

  it('"Ca sáng" gõ dạng tổ hợp (NFD) trùng với dạng dựng sẵn (NFC), và tên lưu là NFC', async () => {
    const tag = randCode(6);
    const nfc = `Ca sáng ${tag}`;
    await make(nfc);
    await expect(make(nfc.normalize('NFD'))).rejects.toBeInstanceOf(ConflictException);
    const other = await make(`Ca chiều ${tag}`.normalize('NFD'));
    expect((await prisma.shiftTemplate.findUniqueOrThrow({ where: { id: other.id } })).name).toBe(`Ca chiều ${tag}`.normalize('NFC'));
  });

  it('hai dấu cách liền nhau trùng với một dấu cách, và tên lưu gộp thành một', async () => {
    const tag = randCode(6);
    await make(`Ca đêm ${tag}`);
    await expect(make(`Ca  đêm ${tag}`)).rejects.toBeInstanceOf(ConflictException);
    const t = await make(`Ca   khuya ${tag}`);
    expect((await prisma.shiftTemplate.findUniqueOrThrow({ where: { id: t.id } })).name).toBe(`Ca khuya ${tag}`);
  });

  it('"Ca_1" không bị coi là trùng "Ca 1" (dấu gạch dưới không phải ký tự đại diện)', async () => {
    const tag = randCode(6);
    await make(`Ca 1 ${tag}`);
    await expect(make(`Ca_1 ${tag}`)).resolves.toMatchObject({ name: `Ca_1 ${tag}` });
  });

  it('tên "%" không trùng mọi ca đang có', async () => {
    const tag = randCode(6);
    await make(`Ca ${tag}`);
    await expect(make(`%${tag}`)).resolves.toBeDefined();
  });

  it('trùng tên thật (khác hoa thường, thừa khoảng trắng) vẫn 409', async () => {
    const tag = randCode(6);
    await make(`Ca sáng ${tag}`);
    await expect(make(`  CA SÁNG ${tag.toLowerCase()} `)).rejects.toBeInstanceOf(ConflictException);
  });

  it('đổi tên sang tên ca khác → 409; đổi sang tên có "_" khác nghĩa đen thì được', async () => {
    const tag = randCode(6);
    await make(`Ca A ${tag}`);
    const b = await make(`Ca B ${tag}`);
    await expect(svc.updateTemplate(b.id, { name: ` ca a ${tag} ` })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.updateTemplate(b.id, { name: `Ca_A ${tag}` })).resolves.toEqual({ updated: true });
  });
});
