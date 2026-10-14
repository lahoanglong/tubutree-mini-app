import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation-pipe';
import { CreateMerchantProductDto, ShipMerchantOrderDto, UpdateMerchantProductDto } from './merchant.controller';
import { CreateMerchantPayoutDto, MerchantStoreTermsDto } from './merchant-admin.controller';

const pipe = createValidationPipe();
const run = <T>(metatype: new () => T, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype }) as Promise<T>;

async function message(metatype: new () => unknown, value: unknown): Promise<string> {
  try {
    await run(metatype, value);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return JSON.stringify((e as BadRequestException).getResponse());
  }
  throw new Error('không ném lỗi');
}

describe('DTO sản phẩm đối tác (R2-MERCHANT-10)', () => {
  const OK = { name: 'Xà phòng', description: 'Xà phòng thủ công', basePrice: 50_000 };

  it('tên/mô tả chỉ có khoảng trắng → 400 tiếng Việt', async () => {
    expect(await message(CreateMerchantProductDto, { ...OK, name: '   ' })).toContain('Tên sản phẩm không được để trống');
    expect(await message(CreateMerchantProductDto, { ...OK, description: ' \n ' })).toContain('Mô tả sản phẩm không được để trống');
    expect(await message(UpdateMerchantProductDto, { name: '  ' })).toContain('Tên sản phẩm không được để trống');
  });

  it('giá dưới 1.000đ (kể cả 0đ) → 400, ở cả tạo và sửa', async () => {
    expect(await message(CreateMerchantProductDto, { ...OK, basePrice: 0 })).toContain('Giá bán tối thiểu 1.000đ');
    expect(await message(CreateMerchantProductDto, { ...OK, salePrice: 500 })).toContain('Giá bán tối thiểu 1.000đ');
    expect(await message(UpdateMerchantProductDto, { basePrice: 999 })).toContain('Giá bán tối thiểu 1.000đ');
  });

  it('tên/mô tả được cắt khoảng trắng hai đầu', async () => {
    const dto = await run(CreateMerchantProductDto, { ...OK, name: '  Xà phòng  ', description: ' Mô tả ' });
    expect(dto.name).toBe('Xà phòng');
    expect(dto.description).toBe('Mô tả');
  });

  it('bỏ giá khuyến mãi (null) khi sửa vẫn được', async () => {
    await expect(run(UpdateMerchantProductDto, { salePrice: null })).resolves.toMatchObject({ salePrice: null });
  });
});

describe('Link tra cứu vận đơn (R2-MERCHANT-12)', () => {
  const BASE = { carrier: 'GHN', trackingCode: 'GHNABC1' };

  it('thiếu https:// → tự thêm, không báo lỗi', async () => {
    const dto = await run(ShipMerchantOrderDto, { ...BASE, trackingUrl: 'ghn.vn/tra-cuu/GHNABC1' });
    expect(dto.trackingUrl).toBe('https://ghn.vn/tra-cuu/GHNABC1');
  });

  it('ô để trống → coi như không nhập', async () => {
    const dto = await run(ShipMerchantOrderDto, { ...BASE, trackingUrl: '  ' });
    expect(dto.trackingUrl).toBeUndefined();
  });

  it('chuỗi không phải link → 400 tiếng Việt kèm ví dụ', async () => {
    expect(await message(ShipMerchantOrderDto, { ...BASE, trackingUrl: 'GHN ABC' })).toContain('Link tra cứu vận đơn không hợp lệ');
  });
});

describe('Phí sàn / phí Tubu giao hộ của gian hàng (admin, Q8)', () => {
  it('phân số 0–0,5; bỏ phí sàn riêng (null) được; phí cố định là số nguyên không âm', async () => {
    await expect(run(MerchantStoreTermsDto, { commissionPct: null, consignmentFeePct: 0.025, consignmentFeeFixed: 3_400 })).resolves.toMatchObject({
      commissionPct: null,
      consignmentFeePct: 0.025,
      consignmentFeeFixed: 3_400,
    });
    await expect(run(MerchantStoreTermsDto, { commissionPct: 0.6 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(MerchantStoreTermsDto, { consignmentFeePct: -0.01 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(MerchantStoreTermsDto, { consignmentFeeFixed: 1.5 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(MerchantStoreTermsDto, { consignmentFeeFixed: -1 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Lập phiếu kèm tổng bảng kê admin vừa xem (Q8)', () => {
  it('nhận tổng âm/dương là số nguyên; bỏ trống được; không nhận số lẻ hay chuỗi', async () => {
    await expect(run(CreateMerchantPayoutDto, { storefrontId: 'sf-a', expectedTotal: -12_000 })).resolves.toMatchObject({ expectedTotal: -12_000 });
    await expect(run(CreateMerchantPayoutDto, { storefrontId: 'sf-a' })).resolves.toMatchObject({ storefrontId: 'sf-a' });
    await expect(run(CreateMerchantPayoutDto, { storefrontId: 'sf-a', expectedTotal: 1.5 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(CreateMerchantPayoutDto, { storefrontId: 'sf-a', expectedTotal: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
