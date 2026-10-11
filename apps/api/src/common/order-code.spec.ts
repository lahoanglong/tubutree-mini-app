import { randomInt } from 'node:crypto';
import { generateUniqueOrderCode } from './order-code';

jest.mock('node:crypto', () => ({ ...jest.requireActual('node:crypto'), randomInt: jest.fn() }));

type Prisma = { order: { findUnique: jest.Mock } };
type Generator = (prisma: Prisma) => Promise<string>;

const GENERATORS: Record<string, { gen: Generator; prefix: string; randomMax: number }> = {
  'checkout (TUBU)': { gen: (p) => generateUniqueOrderCode(p as never, 'RETAIL'), prefix: 'TUBU', randomMax: 100000 },
  'affiliate (TUBU, đơn lên hộ)': {
    gen: (p) => generateUniqueOrderCode(p as never, 'RETAIL'),
    prefix: 'TUBU',
    randomMax: 100000,
  },
  'dealer (DLR)': { gen: (p) => generateUniqueOrderCode(p as never, 'DEALER'), prefix: 'DLR', randomMax: 1000 },
  'subscriptions (TUBUSUB)': {
    gen: (p) => generateUniqueOrderCode(p as never, 'SUBSCRIPTION'),
    prefix: 'TUBUSUB',
    randomMax: 1000,
  },
};

const randomIntMock = randomInt as unknown as jest.Mock;
const makePrisma = (taken: number): Prisma => {
  const findUnique = jest.fn();
  for (let i = 0; i < taken; i++) findUnique.mockResolvedValueOnce({ id: `o${i}` });
  findUnique.mockResolvedValue(null);
  return { order: { findUnique } };
};

describe('sinh mã đơn (đặc tả hành vi từng nơi)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    randomIntMock.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  describe.each(Object.entries(GENERATORS))('%s', (_name, { gen, prefix, randomMax }) => {
    it('hỏi DB theo đúng mã vừa sinh và trả mã đó khi chưa có đơn nào trùng', async () => {
      jest.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
      randomIntMock.mockReturnValue(7);
      const prisma = makePrisma(0);
      const code = await gen(prisma);
      expect(code.startsWith(prefix)).toBe(true);
      expect(prisma.order.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.order.findUnique).toHaveBeenCalledWith({ where: { code } });
      expect(randomIntMock).toHaveBeenCalledWith(0, randomMax);
    });

    it('trùng mã thì thử lại, trả mã của lần thử không trùng', async () => {
      randomIntMock.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);
      const prisma = makePrisma(2);
      const code = await gen(prisma);
      const tried = prisma.order.findUnique.mock.calls.map((c) => (c[0] as { where: { code: string } }).where.code);
      expect(tried).toHaveLength(3);
      expect(new Set(tried).size).toBe(3);
      expect(code).toBe(tried[2]);
    });

    it('trùng liên tiếp 6 lần thì dừng và trả mã dự phòng prefix + Date.now(), không kiểm tra thêm', async () => {
      jest.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
      randomIntMock.mockReturnValue(5);
      const prisma = makePrisma(99);
      const code = await gen(prisma);
      expect(prisma.order.findUnique).toHaveBeenCalledTimes(6);
      expect(code).toBe(`${prefix}${new Date('2026-10-09T12:00:00.000Z').getTime()}`);
    });
  });

  describe('định dạng từng loại', () => {
    it('checkout và affiliate: TUBU + yyyymmdd theo UTC + 5 số ngẫu nhiên (đơn 01:30 VN ngày 10/10 mang ngày 09)', async () => {
      jest.setSystemTime(new Date('2026-10-09T18:30:00.000Z'));
      randomIntMock.mockReturnValue(42);
      expect(await GENERATORS['checkout (TUBU)']!.gen(makePrisma(0))).toBe('TUBU2026100900042');
      expect(await GENERATORS['affiliate (TUBU, đơn lên hộ)']!.gen(makePrisma(0))).toBe('TUBU2026100900042');
    });

    it('checkout và affiliate: tháng/ngày một chữ số được đệm 0, số ngẫu nhiên đệm đủ 5 chữ số', async () => {
      jest.setSystemTime(new Date('2026-03-05T00:00:00.000Z'));
      randomIntMock.mockReturnValue(99999);
      expect(await GENERATORS['checkout (TUBU)']!.gen(makePrisma(0))).toBe('TUBU2026030599999');
    });

    it('dealer: DLR + 8 chữ số cuối của epoch ms + 3 số ngẫu nhiên, không có ngày lịch', async () => {
      jest.setSystemTime(1760000000123);
      randomIntMock.mockReturnValue(7);
      expect(await GENERATORS['dealer (DLR)']!.gen(makePrisma(0))).toBe('DLR00000123007');
    });

    it('subscriptions: TUBUSUB + 7 chữ số cuối của epoch ms + 3 số ngẫu nhiên', async () => {
      jest.setSystemTime(1760000000123);
      randomIntMock.mockReturnValue(7);
      expect(await GENERATORS['subscriptions (TUBUSUB)']!.gen(makePrisma(0))).toBe('TUBUSUB0000123007');
    });
  });
});
