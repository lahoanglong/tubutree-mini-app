import { randomInt } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  ANY_TUBU_ORDER_CODE_RE,
  LEGACY_ORDER_CODE_RE,
  NOTE_ORDER_CODE_RE,
  ORDER_CODE_ALPHABET,
  SHORT_ORDER_CODE_RE,
} from '@tubutree/shared-types';
import { generateUniqueOrderCode, type OrderCodeKind } from './order-code';

jest.mock('node:crypto', () => ({ ...jest.requireActual('node:crypto'), randomInt: jest.fn() }));

type Prisma = { order: { findUnique: jest.Mock } };

const randomIntMock = randomInt as unknown as jest.Mock;
const realRandomInt = (jest.requireActual('node:crypto') as typeof import('node:crypto')).randomInt;
const makePrisma = (taken: number): Prisma => {
  const findUnique = jest.fn();
  for (let i = 0; i < taken; i++) findUnique.mockResolvedValueOnce({ id: `o${i}` });
  findUnique.mockResolvedValue(null);
  return { order: { findUnique } };
};
const gen = (prisma: Prisma, kind: OrderCodeKind) => generateUniqueOrderCode(prisma as never, kind);
const triedCodes = (prisma: Prisma) => prisma.order.findUnique.mock.calls.map((c) => (c[0] as { where: { code: string } }).where.code);
/** randomInt trả lần lượt chỉ số của từng ký tự trong `chars`, rồi quay vòng. */
const drawChars = (chars: string) => {
  let i = 0;
  randomIntMock.mockImplementation(() => ORDER_CODE_ALPHABET.indexOf(chars[i++ % chars.length]!));
};

const LEGACY = ['TUBU2026112212345', 'TUBUSUB1234567890', 'DLR12345678901', 'TUBU42', 'TUBUSUB0000123007'];
const SHORT = ['TB7K4M', 'DL2X9Q', 'TS4MNP', 'TB7K4MZ', 'DLR234', 'TS22222'];
const NOT_CODES = [
  'TB0K4M', // số 0
  'TB1K4M', // số 1
  'TBIK4M', // chữ I
  'TBOK4M', // chữ O
  'TB7K4', // 3 ký tự
  'TB7K4MZX', // 6 ký tự
  'tb7k4m',
  'XX7K4M',
  'TUBU',
  'TUBU2026A',
  'DLR',
  'TUBUTEST1',
  ' TB7K4M',
  'TB7K4M ',
  'TB-7K4M',
];

describe('khuôn mã đơn (shared-types)', () => {
  it('bảng ký tự đúng 32 ký tự khác nhau, không có 0/1/I/O, khớp lớp ký tự của khuôn mã ngắn', () => {
    expect(ORDER_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(ORDER_CODE_ALPHABET).size).toBe(32);
    expect(ORDER_CODE_ALPHABET).not.toMatch(/[01IO]/);
    for (const c of ORDER_CODE_ALPHABET) expect(SHORT_ORDER_CODE_RE.test(`TB${c.repeat(4)}`)).toBe(true);
    for (const c of '01IO') expect(SHORT_ORDER_CODE_RE.test(`TB${c.repeat(4)}`)).toBe(false);
  });

  it.each(LEGACY)('mã dài cũ %s: khớp LEGACY và ANY, không khớp SHORT', (code) => {
    expect(LEGACY_ORDER_CODE_RE.test(code)).toBe(true);
    expect(ANY_TUBU_ORDER_CODE_RE.test(code)).toBe(true);
    expect(SHORT_ORDER_CODE_RE.test(code)).toBe(false);
  });

  it.each(SHORT)('mã ngắn %s: khớp SHORT và ANY', (code) => {
    expect(SHORT_ORDER_CODE_RE.test(code)).toBe(true);
    expect(ANY_TUBU_ORDER_CODE_RE.test(code)).toBe(true);
  });

  it.each(NOT_CODES)('không phải mã đơn: %j', (code) => {
    expect(ANY_TUBU_ORDER_CODE_RE.test(code)).toBe(false);
    expect(SHORT_ORDER_CODE_RE.test(code)).toBe(false);
  });

  describe('NOTE_ORDER_CODE_RE ("Order code: <mã>" trong ghi chú Pancake)', () => {
    const read = (note: string) => note.match(NOTE_ORDER_CODE_RE)?.[1] ?? null;

    it.each([...LEGACY, ...SHORT])('đọc trọn mã %s ở mọi kiểu ghi chú nhân viên sửa', (code) => {
      for (const note of [
        `Order code: ${code}`,
        `Order code: ${code} | [THU COD 230.000đ]`,
        `GẤP Order code: ${code} - đổi size`,
        `Order code:\u00a0${code}`,
        `ghi chú\nOrder code: ${code} | COD`,
        `Order code:${code}`,
      ]) {
        expect(read(note)).toBe(code);
      }
    });

    it('mã ngắn có chữ ở giữa không bị cắt còn phần trước chữ số đầu (TB7K4M không thành TB7)', () => {
      expect(read('Order code: TB7K4M | [THU COD 230.000đ]')).toBe('TB7K4M');
      expect(read('Order code: TBKM4X')).toBe('TBKM4X');
    });

    it('chuỗi dính thêm chữ/số sau mã thì không phải mã của ta', () => {
      expect(read('Order code: TB7K4M2X9')).toBeNull();
      expect(read('Order code: TUBU123ABC')).toBeNull();
      expect(read('Order code: TB0K4M')).toBeNull();
    });

    it('không có "Order code:" hoặc mã lạ thì null', () => {
      expect(read('Khách hỏi đơn TB7K4M')).toBeNull();
      expect(read('Order code: IT1732000000ABCDE')).toBeNull();
      expect(read('Order code: TUBUTEST1')).toBeNull();
    });
  });
});

describe('sinh mã đơn', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    randomIntMock.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  describe.each([
    ['RETAIL', 'TB'],
    ['DEALER', 'DL'],
    ['SUBSCRIPTION', 'TS'],
  ] as const)('%s', (kind, prefix) => {
    it(`mã ngắn ${prefix} + 4 ký tự, hỏi DB đúng mã đó và trả khi chưa trùng`, async () => {
      drawChars('7K4M');
      const prisma = makePrisma(0);
      const code = await gen(prisma, kind);
      expect(code).toBe(`${prefix}7K4M`);
      expect(prisma.order.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.order.findUnique).toHaveBeenCalledWith({ where: { code } });
      expect(randomIntMock).toHaveBeenCalledWith(0, 32);
    });

    it('trùng 6 lần mã 4 ký tự thì chuyển sang 5 ký tự, mã trả ra là mã đã hỏi DB', async () => {
      drawChars('23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
      const prisma = makePrisma(6);
      const code = await gen(prisma, kind);
      const tried = triedCodes(prisma);
      expect(tried).toHaveLength(7);
      expect(tried.slice(0, 6).every((c) => c.length === 6)).toBe(true);
      expect(code).toHaveLength(7);
      expect(code).toBe(tried[6]);
      expect(SHORT_ORDER_CODE_RE.test(code)).toBe(true);
    });

    it('trùng thêm 6 lần mã 5 ký tự thì dùng mã dài cũ, vẫn hỏi DB trước khi trả', async () => {
      jest.setSystemTime(new Date('2026-10-09T18:30:00.000Z'));
      drawChars('7K4M9');
      const prisma = makePrisma(12);
      const code = await gen(prisma, kind);
      expect(prisma.order.findUnique).toHaveBeenCalledTimes(13);
      expect(code).toBe(triedCodes(prisma)[12]);
      expect(LEGACY_ORDER_CODE_RE.test(code)).toBe(true);
      expect(ANY_TUBU_ORDER_CODE_RE.test(code)).toBe(true);
    });

    it('trùng hết 18 lần thì báo lỗi, không trả mã chưa kiểm', async () => {
      drawChars('7K4M9');
      const prisma = makePrisma(99);
      await expect(gen(prisma, kind)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.order.findUnique).toHaveBeenCalledTimes(18);
    });

    it('mọi nhánh (ngắn, 5 ký tự, dài cũ) chỉ gồm chữ và số, tối đa 25 ký tự: nội dung chuyển khoản MSS trùng đúng mã Tubu đối soát', async () => {
      // MSS: transferMemo(code) = code.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) (hợp đồng W4-02, câu hỏi 2); Tubu: nội dung CK = order.code.
      const transferMemo = (code: string) => code.replace(/[^A-Za-z0-9]/g, '').slice(0, 25);
      jest.setSystemTime(new Date('2026-12-31T23:59:59.999Z'));
      randomIntMock.mockImplementation((_min: number, max: number) => max - 1);
      for (const taken of [0, 6, 12]) {
        const code = await gen(makePrisma(taken), kind);
        expect(transferMemo(code)).toBe(code);
      }
    });
  });

  describe('mã dài cũ (chỉ khi mã ngắn trùng hết lượt) giữ đúng định dạng PROD', () => {
    it('RETAIL: TUBU + yyyymmdd theo UTC + 5 số (đơn 01:30 VN ngày 10/10 mang ngày 09)', async () => {
      jest.setSystemTime(new Date('2026-10-09T18:30:00.000Z'));
      randomIntMock.mockImplementation((_min: number, max: number) => (max === 32 ? 0 : 42));
      expect(await gen(makePrisma(12), 'RETAIL')).toBe('TUBU2026100900042');
    });

    it('DEALER: DLR + 8 chữ số cuối của epoch ms + 3 số', async () => {
      jest.setSystemTime(1760000000123);
      randomIntMock.mockImplementation((_min: number, max: number) => (max === 32 ? 0 : 7));
      expect(await gen(makePrisma(12), 'DEALER')).toBe('DLR00000123007');
    });

    it('SUBSCRIPTION: TUBUSUB + 7 chữ số cuối của epoch ms + 3 số', async () => {
      jest.setSystemTime(1760000000123);
      randomIntMock.mockImplementation((_min: number, max: number) => (max === 32 ? 0 : 7));
      expect(await gen(makePrisma(12), 'SUBSCRIPTION')).toBe('TUBUSUB0000123007');
    });
  });

  describe('chuỗi đọc lên khó coi', () => {
    it.each([
      ['CAC2', 'TBCAC2'],
      ['2DM3', 'TB2DM3'],
      ['VL22', 'TBVL22'],
      ['EX22', 'TSEX22'],
    ])('phần ngẫu nhiên %s tạo mã %s thì bốc lại, không hỏi DB mã đó', async (bad, badCode) => {
      const kind: OrderCodeKind = badCode.startsWith('TS') ? 'SUBSCRIPTION' : 'RETAIL';
      drawChars(`${bad}7K4M`);
      const prisma = makePrisma(0);
      const code = await gen(prisma, kind);
      expect(code).toBe(`${badCode.slice(0, 2)}7K4M`);
      expect(triedCodes(prisma)).toEqual([code]);
    });

    it('bốc lại có trần: mock luôn ra chuỗi khó coi thì vẫn trả mã hợp lệ, không lặp vô hạn', async () => {
      drawChars('CAC2');
      const code = await gen(makePrisma(0), 'RETAIL');
      expect(code).toBe('TBCAC2');
      expect(randomIntMock.mock.calls.length).toBe(20 * 4);
    });
  });

  it('10.000 mã sinh bằng randomInt thật: đúng khuôn, không có 0/1/I/O, không có chuỗi khó coi, phủ đủ 32 ký tự', async () => {
    randomIntMock.mockImplementation(realRandomInt);
    const prisma = makePrisma(0);
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = await gen(prisma, (['RETAIL', 'DEALER', 'SUBSCRIPTION'] as const)[i % 3]!);
      expect(SHORT_ORDER_CODE_RE.test(code)).toBe(true);
      expect(code.slice(2)).not.toMatch(/[01IO]/);
      expect(code).not.toMatch(/CAC|DM|VL|CL|SEX|FUCK/);
      seen.add(code);
      for (const c of code.slice(2)) chars.add(c);
    }
    expect(chars.size).toBe(32);
    // 10.000 mã trên ~3 triệu khả năng: trùng nhau trong mẫu là hiếm (DB kiểm trùng thật), chỉ chặn bộ sinh hỏng kiểu luôn ra một mã.
    expect(seen.size).toBeGreaterThan(9_900);
  });
});
