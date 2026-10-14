import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PlaceOrderDto } from '../modules/checkout/dto/checkout.dto';
import { WithdrawDto } from '../modules/wallet/wallet.controller';
import { CreatePostDto, EditPostDto } from '../modules/feed/community-feed.controller';

/**
 * MONEY-14: chuỗi/mảng không giới hạn cho phép một tài khoản (kể cả khách) ghi hàng trăm KB vào DB và làm
 * vỡ màn admin (danh sách rút tiền, feed). Body tối đa 10mb ở main.ts không phải giới hạn của từng trường.
 */
async function errorsFor<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true });
  const flat = (e: (typeof errs)[number]): string[] => [
    ...Object.keys(e.constraints ?? {}).map((k) => `${e.property}.${k}`),
    ...(e.children ?? []).flatMap(flat).map((k) => `${e.property}.${k}`),
  ];
  return errs.flatMap(flat);
}

describe('PlaceOrderDto.note', () => {
  const base = { addressId: 'a1', paymentMethod: 'COD' };
  it('ghi chú dài hơn 500 ký tự → lỗi', async () => {
    expect(await errorsFor(PlaceOrderDto, { ...base, note: 'x'.repeat(501) })).toContain('note.maxLength');
  });
  it('ghi chú bình thường → hợp lệ', async () => {
    expect(await errorsFor(PlaceOrderDto, { ...base, note: 'Giao giờ hành chính, gọi trước 15 phút' })).toEqual([]);
  });
});

describe('WithdrawDto.bankInfo', () => {
  const bank = { bankName: 'Techcombank', accountNumber: '19031234567', accountName: 'LA HOANG LONG' };
  it('thông tin ngân hàng hợp lệ (kể cả STK có dấu cách) → hợp lệ', async () => {
    expect(await errorsFor(WithdrawDto, { amount: 100000, bankInfo: bank })).toEqual([]);
    const dto = plainToInstance(WithdrawDto, { amount: 100000, bankInfo: { ...bank, accountNumber: ' 1903 1234 567 ' } });
    expect(await validate(dto)).toEqual([]);
    expect(dto.bankInfo.accountNumber).toBe('19031234567');
  });
  it.each([
    ['tên ngân hàng 100.000 ký tự', { bankName: 'x'.repeat(100_000) }, 'bankInfo.bankName.maxLength'],
    ['tên chủ TK quá dài', { accountName: 'x'.repeat(121) }, 'bankInfo.accountName.maxLength'],
    ['STK quá ngắn', { accountNumber: '12345' }, 'bankInfo.accountNumber.matches'],
    ['STK quá dài', { accountNumber: '1'.repeat(21) }, 'bankInfo.accountNumber.matches'],
    ['STK có chữ cái lạ', { accountNumber: '1903<script>' }, 'bankInfo.accountNumber.matches'],
  ])('%s → lỗi', async (_label, over, key) => {
    expect(await errorsFor(WithdrawDto, { amount: 100000, bankInfo: { ...bank, ...over } })).toContain(key);
  });
});

describe('CreatePostDto / EditPostDto.images', () => {
  const url = 'https://res.cloudinary.com/tubu/image/upload/v1/a.jpg';
  const dataUrl = `data:image/jpeg;base64,${'A'.repeat(300_000)}`;
  it('ảnh Cloudinary và ảnh nén base64 (đường dự phòng của MultiImageUpload) → hợp lệ', async () => {
    expect(await errorsFor(CreatePostDto, { body: 'Cây mới', images: [url, dataUrl] })).toEqual([]);
  });
  it('quá 6 ảnh → lỗi', async () => {
    expect(await errorsFor(CreatePostDto, { body: 'x', images: Array(7).fill(url) })).toContain('images.arrayMaxSize');
    expect(await errorsFor(EditPostDto, { images: Array(7).fill(url) })).toContain('images.arrayMaxSize');
  });
  it.each([
    ['chuỗi base64 nhiều MB', `data:image/jpeg;base64,${'A'.repeat(800_000)}`],
    ['không phải ảnh', 'javascript:alert(1)'],
    ['data URL không phải ảnh', 'data:text/html;base64,PGgxPg=='],
    ['URL quá dài', `https://x.vn/${'a'.repeat(2100)}`],
  ])('%s → lỗi', async (_label, img) => {
    expect((await errorsFor(CreatePostDto, { body: 'x', images: [img] })).some((k) => k.startsWith('images.'))).toBe(true);
    expect((await errorsFor(EditPostDto, { images: [img] })).some((k) => k.startsWith('images.'))).toBe(true);
  });
  it('quá nhiều slug sản phẩm/thẻ → lỗi', async () => {
    const keys = await errorsFor(CreatePostDto, { body: 'x', productSlugs: Array(21).fill('a'), tagSlugs: Array(21).fill('b') });
    expect(keys).toEqual(expect.arrayContaining(['productSlugs.arrayMaxSize', 'tagSlugs.arrayMaxSize']));
  });
});
