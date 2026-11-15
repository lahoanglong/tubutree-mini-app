import 'reflect-metadata';
import { validate, type ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { InvoiceRequestDto, PickupOptionsQueryDto, PlaceOrderDto, QuoteDto } from './checkout.dto';
import { AddItemDto, UpdateItemDto } from '../../cart/dto/cart.dto';

async function errorsFor<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const dto = plainToInstance(cls, plain);
  const errs = await validate(dto);
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}));
}

/** Lỗi theo đường dẫn trường, đi vào cả đối tượng lồng nhau: "inlinePickup.lines.0.qty:min". */
async function pathErrorsFor<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const walk = (errs: ValidationError[], prefix = ''): string[] =>
    errs.flatMap((e) => {
      const path = prefix ? `${prefix}.${e.property}` : e.property;
      return [...Object.keys(e.constraints ?? {}).map((c) => `${path}:${c}`), ...walk(e.children ?? [], path)];
    });
  return walk(await validate(plainToInstance(cls, plain)));
}

describe('InvoiceRequestDto', () => {
  const base = { taxCode: '0312345678', companyName: 'Co', address: 'HN' };

  it('email không hợp lệ → lỗi isEmail', async () => {
    const keys = await errorsFor(InvoiceRequestDto, { ...base, email: 'not-an-email' });
    expect(keys).toContain('isEmail');
  });

  it('email hợp lệ → không lỗi', async () => {
    const keys = await errorsFor(InvoiceRequestDto, { ...base, email: 'ke.toan@cong-ty.vn' });
    expect(keys).toHaveLength(0);
  });

  // GIOHANG-10: trước đây 'abc' vẫn tạo được đơn và các trường dài MB được ghi vào đơn.
  const email = 'ke.toan@cong-ty.vn';
  it.each(['0312345678', '0312345678-001', '001234567890'])('mã số thuế %s hợp lệ (10 số, chi nhánh -3 số, CCCD 12 số)', async (taxCode) => {
    expect(await errorsFor(InvoiceRequestDto, { ...base, taxCode, email })).toHaveLength(0);
  });
  it.each(['abc', '123', '031234567', '03123456789', '0312345678-01', '0312345678-0011', '0312-345678', ''])(
    'mã số thuế %j không hợp lệ',
    async (taxCode) => {
      expect(await errorsFor(InvoiceRequestDto, { ...base, taxCode, email })).toContain('matches');
    },
  );
  // Khách dán MST từ bảng tính hay dính khoảng trắng/NBSP/U+200B ở hai đầu: cắt trước khi kiểm mẫu, giữa chuỗi vẫn không hợp lệ.
  it.each(['0312345678 ', ' 0312345678', '0312345678\u00a0', '\u200b0312345678\u200b'])('mã số thuế %j được cắt hai đầu rồi hợp lệ', async (taxCode) => {
    expect(await errorsFor(InvoiceRequestDto, { ...base, taxCode, email })).toHaveLength(0);
  });
  it('tên công ty, địa chỉ, email quá dài → lỗi maxLength', async () => {
    expect(await errorsFor(InvoiceRequestDto, { ...base, email, companyName: 'x'.repeat(256) })).toContain('maxLength');
    expect(await errorsFor(InvoiceRequestDto, { ...base, email, address: 'x'.repeat(501) })).toContain('maxLength');
    expect(await errorsFor(InvoiceRequestDto, { ...base, email: `${'a'.repeat(250)}@cong-ty.vn` })).toEqual(expect.arrayContaining(['maxLength']));
  });
});

// P1-2 (docs/2026-09-08-review-progress.md): checkout.service chỉ có settlement path thật cho
// COD/BANK_TRANSFER/WALLET/ZALOPAY — VNPAY được DTO chấp nhận nhưng KHÔNG có service/
// controller/webhook nào xử lý. Đơn VNPAY vẫn trừ kho + đứng PENDING_PAYMENT vĩnh viễn (không
// cron nào hết hạn PENDING_PAYMENT) → lặp POST place-order với paymentMethod:VNPAY là cách rẻ
// tiền để khóa chết tồn kho. DTO phải từ chối phương thức chưa có nơi xử lý.
describe('PlaceOrderDto.paymentMethod — chỉ chấp nhận phương thức có settlement path thật', () => {
  const base = { addressId: 'a1' };

  it('VNPAY chưa có service/webhook nào xử lý → DTO từ chối', async () => {
    const keys = await errorsFor(PlaceOrderDto, { ...base, paymentMethod: 'VNPAY' });
    expect(keys).toContain('isIn');
  });

  // PD-3 (Q-03, T18): TubuXu đã gộp vào Điểm Xanh; điểm quy đổi tiêu qua pointsToUse, không còn là
  // phương thức thanh toán. Giá trị XU chỉ còn trong enum cho đơn cũ.
  it('XU (đã gộp vào Điểm Xanh) → DTO từ chối, client gửi nhận 400', async () => {
    const keys = await errorsFor(PlaceOrderDto, { ...base, paymentMethod: 'XU' });
    expect(keys).toContain('isIn');
  });

  it.each(['COD', 'BANK_TRANSFER', 'WALLET', 'ZALOPAY'])('%s (đã có xử lý thật) → hợp lệ', async (method) => {
    const keys = await errorsFor(PlaceOrderDto, { ...base, paymentMethod: method });
    expect(keys).not.toContain('isIn');
  });
});

describe('Cart quantity bounds', () => {
  it('AddItemDto: quantity 0 → lỗi (min 1)', async () => {
    const keys = await errorsFor(AddItemDto, { variationId: 'v1', quantity: 0 });
    expect(keys).toContain('min');
  });

  it('AddItemDto: quantity vượt 999 → lỗi (max)', async () => {
    const keys = await errorsFor(AddItemDto, { variationId: 'v1', quantity: 100000 });
    expect(keys).toContain('max');
  });

  it('AddItemDto: quantity hợp lệ → không lỗi', async () => {
    const keys = await errorsFor(AddItemDto, { variationId: 'v1', quantity: 3 });
    expect(keys).toHaveLength(0);
  });

  it('UpdateItemDto: 0 hợp lệ (xóa), 1000 lỗi', async () => {
    expect(await errorsFor(UpdateItemDto, { quantity: 0 })).toHaveLength(0);
    expect(await errorsFor(UpdateItemDto, { quantity: 1000 })).toContain('max');
  });
});

// P2 (docs/2026-09-08-review-progress.md): mảng trong body không có trần kích thước — mỗi phần
// tử kéo theo truy vấn/vòng lặp phía server nên 1 request đủ để ghim DB.
describe('Trần kích thước mảng trong body', () => {
  it('PlaceOrderDto: itemIds quá 200 phần tử → lỗi arrayMaxSize', async () => {
    const keys = await errorsFor(PlaceOrderDto, {
      addressId: 'a1',
      paymentMethod: 'COD',
      itemIds: Array.from({ length: 201 }, (_, i) => `i${i}`),
    });
    expect(keys).toContain('arrayMaxSize');
  });

  it('PlaceOrderDto: đúng 200 phần tử → hợp lệ', async () => {
    const keys = await errorsFor(PlaceOrderDto, {
      addressId: 'a1',
      paymentMethod: 'COD',
      itemIds: Array.from({ length: 200 }, (_, i) => `i${i}`),
    });
    expect(keys).not.toContain('arrayMaxSize');
  });
});

describe('PlaceOrderDto.wasteRequestId — thu kèm rác (§12.2 bước 2)', () => {
  const base = { addressId: 'a1', paymentMethod: 'COD' };

  it('wasteRequestId là chuỗi → hợp lệ; không gửi → hợp lệ', async () => {
    expect(await errorsFor(PlaceOrderDto, { ...base, wasteRequestId: 'clx0r1' })).toHaveLength(0);
    expect(await errorsFor(PlaceOrderDto, base)).toHaveLength(0);
  });

  it('wasteRequestId không phải chuỗi → isString; dài quá 64 → maxLength; chuỗi rỗng → isNotEmpty', async () => {
    expect(await errorsFor(PlaceOrderDto, { ...base, wasteRequestId: 42 })).toContain('isString');
    expect(await errorsFor(PlaceOrderDto, { ...base, wasteRequestId: 'x'.repeat(65) })).toContain('maxLength');
    expect(await errorsFor(PlaceOrderDto, { ...base, wasteRequestId: '' })).toContain('isNotEmpty');
  });

  it('hai trường cũ hasRecyclingPickup / recyclingNote bị từ chối khi forbidNonWhitelisted (client cũ nhận 400)', async () => {
    for (const extra of [{ hasRecyclingPickup: true }, { recyclingNote: 'Vỏ hộp sữa' }]) {
      const errs = await validate(plainToInstance(PlaceOrderDto, { ...base, ...extra }), { whitelist: true, forbidNonWhitelisted: true });
      expect(errs.flatMap((e) => Object.keys(e.constraints ?? {}))).toContain('whitelistValidation');
    }
  });
});

// W168-C: QuoteDto và PlaceOrderDto cùng nhận trường thu rác kèm đơn; bản app cũ không gửi trường nào vẫn hợp lệ.
describe.each([
  ['QuoteDto', QuoteDto, { addressId: 'a1' }],
  ['PlaceOrderDto', PlaceOrderDto, { addressId: 'a1', paymentMethod: 'COD' }],
] as const)('%s — trường thu rác kèm đơn và quà hiện vật', (_name, Cls, base) => {
  const lines = [{ itemId: 'w1', qty: 3 }];

  it('không gửi trường nào (app cũ) → hợp lệ', async () => {
    expect(await pathErrorsFor(Cls as never, base)).toEqual([]);
  });

  it('wasteRequestId như cũ → hợp lệ; rỗng hoặc quá dài → lỗi', async () => {
    expect(await pathErrorsFor(Cls as never, { ...base, wasteRequestId: 'r1' })).toEqual([]);
    expect(await pathErrorsFor(Cls as never, { ...base, wasteRequestId: '' })).toContain('wasteRequestId:isNotEmpty');
    expect(await pathErrorsFor(Cls as never, { ...base, wasteRequestId: 'x'.repeat(65) })).toContain('wasteRequestId:maxLength');
  });

  it('inlinePickup hợp lệ (có hoặc không có cân nặng)', async () => {
    expect(await pathErrorsFor(Cls as never, { ...base, inlinePickup: { lines } })).toEqual([]);
    expect(await pathErrorsFor(Cls as never, { ...base, inlinePickup: { lines, returnWeightGrams: 2_000 } })).toEqual([]);
  });

  it('inlinePickup: lines rỗng → lỗi arrayMinSize; thiếu lines → lỗi', async () => {
    expect(await pathErrorsFor(Cls as never, { ...base, inlinePickup: { lines: [] } })).toContain('inlinePickup.lines:arrayMinSize');
    expect((await pathErrorsFor(Cls as never, { ...base, inlinePickup: {} })).length).toBeGreaterThan(0);
  });

  it('inlinePickup: quá 50 dòng → lỗi arrayMaxSize, đúng 50 dòng → hợp lệ', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ itemId: `w${i}`, qty: 1 }));
    expect(await pathErrorsFor(Cls as never, { ...base, inlinePickup: { lines: many(51) } })).toContain('inlinePickup.lines:arrayMaxSize');
    expect(await pathErrorsFor(Cls as never, { ...base, inlinePickup: { lines: many(50) } })).toEqual([]);
  });

  it.each([
    ['qty 0', { itemId: 'w1', qty: 0 }, 'inlinePickup.lines.0.qty:min'],
    ['qty âm', { itemId: 'w1', qty: -2 }, 'inlinePickup.lines.0.qty:min'],
    ['qty lẻ', { itemId: 'w1', qty: 1.5 }, 'inlinePickup.lines.0.qty:isInt'],
    ['qty chữ', { itemId: 'w1', qty: '3' }, 'inlinePickup.lines.0.qty:isInt'],
    ['qty quá lớn', { itemId: 'w1', qty: 100_001 }, 'inlinePickup.lines.0.qty:max'],
    ['thiếu itemId', { qty: 1 }, 'inlinePickup.lines.0.itemId:isString'],
    ['itemId rỗng', { itemId: '', qty: 1 }, 'inlinePickup.lines.0.itemId:isNotEmpty'],
    ['itemId quá dài', { itemId: 'x'.repeat(65), qty: 1 }, 'inlinePickup.lines.0.itemId:maxLength'],
  ])('inlinePickup: dòng %s → lỗi %s', async (_c, line, expected) => {
    expect(await pathErrorsFor(Cls as never, { ...base, inlinePickup: { lines: [line] } })).toContain(expected);
  });

  it.each([499, 0, -500, 10_001, 2_000.5, '2000'])('returnWeightGrams %j (ngoài 500..10000 hoặc không nguyên) → lỗi nêu khoảng cho phép', async (grams) => {
    const errs = await pathErrorsFor(Cls as never, { ...base, returnWeightGrams: grams });
    expect(errs.some((e) => e.startsWith('returnWeightGrams:'))).toBe(true);
    const nested = await pathErrorsFor(Cls as never, { ...base, inlinePickup: { lines, returnWeightGrams: grams } });
    expect(nested.some((e) => e.startsWith('inlinePickup.returnWeightGrams:'))).toBe(true);
  });

  it.each([500, 2_000, 10_000])('returnWeightGrams %i (trong 500..10000, nguyên) → hợp lệ', async (grams) => {
    expect(await pathErrorsFor(Cls as never, { ...base, returnWeightGrams: grams })).toEqual([]);
  });

  it('câu báo lỗi cân nặng tiếng Việt, nêu khoảng 500 tới 10000', async () => {
    const dto = plainToInstance(Cls as never, { ...base, returnWeightGrams: 100 }) as object;
    const errs = await validate(dto);
    const messages = errs.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages.every((m) => m.includes('500') && m.includes('10000'))).toBe(true);
  });

  it('excludeGiftRedemptionIds: mảng chuỗi ≤ 50 phần tử → hợp lệ; 51 phần tử, số, chuỗi quá dài → lỗi', async () => {
    expect(await pathErrorsFor(Cls as never, { ...base, excludeGiftRedemptionIds: ['g1', 'g2'] })).toEqual([]);
    expect(await pathErrorsFor(Cls as never, { ...base, excludeGiftRedemptionIds: [] })).toEqual([]);
    expect(await pathErrorsFor(Cls as never, { ...base, excludeGiftRedemptionIds: Array.from({ length: 50 }, (_, i) => `g${i}`) })).toEqual([]);
    expect(await pathErrorsFor(Cls as never, { ...base, excludeGiftRedemptionIds: Array.from({ length: 51 }, (_, i) => `g${i}`) })).toContain('excludeGiftRedemptionIds:arrayMaxSize');
    expect(await pathErrorsFor(Cls as never, { ...base, excludeGiftRedemptionIds: [1] })).toContain('excludeGiftRedemptionIds:isString');
    expect(await pathErrorsFor(Cls as never, { ...base, excludeGiftRedemptionIds: ['x'.repeat(65)] })).toContain('excludeGiftRedemptionIds:maxLength');
    expect(await pathErrorsFor(Cls as never, { ...base, excludeGiftRedemptionIds: 'g1' })).toContain('excludeGiftRedemptionIds:isArray');
  });

  it('wasteRequestId và inlinePickup cùng gửi: DTO vẫn hợp lệ (service trả 400 với câu nêu việc cần làm)', async () => {
    expect(await pathErrorsFor(Cls as never, { ...base, wasteRequestId: 'r1', inlinePickup: { lines } })).toEqual([]);
  });
});

describe('PickupOptionsQueryDto', () => {
  it('chỉ cần addressId', async () => {
    expect(await pathErrorsFor(PickupOptionsQueryDto, { addressId: 'a1' })).toEqual([]);
  });

  it('thiếu addressId → lỗi', async () => {
    expect(await pathErrorsFor(PickupOptionsQueryDto, {})).toContain('addressId:isString');
  });

  it('itemIds dạng "a,b,c" trong query string được tách thành mảng', () => {
    const dto = plainToInstance(PickupOptionsQueryDto, { addressId: 'a1', itemIds: 'i1,i2,i3' });
    expect(dto.itemIds).toEqual(['i1', 'i2', 'i3']);
  });

  it('itemIds rỗng hoặc thiếu → undefined hoặc rỗng, hợp lệ', async () => {
    expect(await pathErrorsFor(PickupOptionsQueryDto, { addressId: 'a1', itemIds: '' })).toEqual([]);
  });

  it('quá 200 itemIds → lỗi arrayMaxSize', async () => {
    const itemIds = Array.from({ length: 201 }, (_, i) => `i${i}`).join(',');
    expect(await pathErrorsFor(PickupOptionsQueryDto, { addressId: 'a1', itemIds })).toContain('itemIds:arrayMaxSize');
  });
});
