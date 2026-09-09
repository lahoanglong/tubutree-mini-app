import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { InvoiceRequestDto, PlaceOrderDto } from './checkout.dto';
import { AddItemDto, UpdateItemDto } from '../../cart/dto/cart.dto';

async function errorsFor<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const dto = plainToInstance(cls, plain);
  const errs = await validate(dto);
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('InvoiceRequestDto', () => {
  const base = { taxCode: '123', companyName: 'Co', address: 'HN' };

  it('email không hợp lệ → lỗi isEmail', async () => {
    const keys = await errorsFor(InvoiceRequestDto, { ...base, email: 'not-an-email' });
    expect(keys).toContain('isEmail');
  });

  it('email hợp lệ → không lỗi', async () => {
    const keys = await errorsFor(InvoiceRequestDto, { ...base, email: 'ke.toan@cong-ty.vn' });
    expect(keys).toHaveLength(0);
  });
});

// P1-2 (docs/2026-09-08-review-progress.md): checkout.service chỉ có settlement path thật cho
// COD/BANK_TRANSFER/WALLET/XU/ZALOPAY — VNPAY được DTO chấp nhận nhưng KHÔNG có service/
// controller/webhook nào xử lý. Đơn VNPAY vẫn trừ kho + đứng PENDING_PAYMENT vĩnh viễn (không
// cron nào hết hạn PENDING_PAYMENT) → lặp POST place-order với paymentMethod:VNPAY là cách rẻ
// tiền để khóa chết tồn kho. DTO phải từ chối phương thức chưa có nơi xử lý.
describe('PlaceOrderDto.paymentMethod — chỉ chấp nhận phương thức có settlement path thật', () => {
  const base = { addressId: 'a1' };

  it('VNPAY chưa có service/webhook nào xử lý → DTO từ chối', async () => {
    const keys = await errorsFor(PlaceOrderDto, { ...base, paymentMethod: 'VNPAY' });
    expect(keys).toContain('isIn');
  });

  it.each(['COD', 'BANK_TRANSFER', 'WALLET', 'XU', 'ZALOPAY'])('%s (đã có xử lý thật) → hợp lệ', async (method) => {
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
