import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation-pipe';
import { CreateMerchantProductDto, MerchantOrderReasonDto, ShipMerchantOrderDto, UpdateMerchantProductDto, UpdateMerchantStoreDto } from './merchant.controller';
import { CancelMerchantPayoutDto, CreateMerchantPayoutDto, MerchantStoreTermsDto } from './merchant-admin.controller';

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

  it('R4-PARTNER-6: mã Pancake khi sửa — chuỗi được cắt khoảng trắng, null là bỏ mã, không nhận số/đối tượng', async () => {
    await expect(run(UpdateMerchantProductDto, { pancakeCode: '  PK-9 ' })).resolves.toMatchObject({ pancakeCode: 'PK-9' });
    await expect(run(UpdateMerchantProductDto, { pancakeCode: null })).resolves.toMatchObject({ pancakeCode: null });
    await expect(run(UpdateMerchantProductDto, { pancakeCode: 12 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(UpdateMerchantProductDto, { pancakeCode: 'x'.repeat(65) })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bỏ giá khuyến mãi (null) khi sửa vẫn được', async () => {
    await expect(run(UpdateMerchantProductDto, { salePrice: null })).resolves.toMatchObject({ salePrice: null });
  });

  describe('AUTHZ-3: thành phần đúng hình dạng mà miniapp và tab duyệt đọc được', () => {
    it('mảng {name, percentage?, benefit?}: cắt khoảng trắng, số tỉ lệ đổi sang chuỗi; bỏ trống, null, mảng rỗng đều được', async () => {
      const dto = await run(CreateMerchantProductDto, {
        ...OK,
        ingredients: [{ name: '  Tinh dầu sả ', percentage: 60, benefit: ' Đuổi muỗi ' }, { name: 'Dầu dừa', percentage: '40%' }, { name: 'Hương liệu' }],
      });
      expect(JSON.parse(JSON.stringify(dto.ingredients))).toEqual([
        { name: 'Tinh dầu sả', percentage: '60', benefit: 'Đuổi muỗi' },
        { name: 'Dầu dừa', percentage: '40%' },
        { name: 'Hương liệu' },
      ]);
      await expect(run(CreateMerchantProductDto, OK)).resolves.toBeDefined();
      await expect(run(CreateMerchantProductDto, { ...OK, ingredients: null })).resolves.toBeDefined();
      await expect(run(CreateMerchantProductDto, { ...OK, ingredients: [] })).resolves.toBeDefined();
    });

    it('chuỗi, object, mảng chuỗi hoặc mục không phải object → 400 tiếng Việt (không lọt xuống cột Json làm vỡ trang)', async () => {
      for (const bad of ['Sả, chanh', { name: 'Sả' }, ['Sả', 'Chanh'], [1, 2], [null], [['Sả']]]) {
        expect(await message(CreateMerchantProductDto, { ...OK, ingredients: bad })).toContain('Thành phần phải là danh sách');
      }
    });

    it('thiếu tên, tên/tỉ lệ/lợi ích quá dài, trường lạ, tỉ lệ không phải chuỗi/số, quá 30 mục → 400', async () => {
      const bads: unknown[] = [
        [{ percentage: '10%' }],
        [{ name: '   ' }],
        [{ name: 'x'.repeat(121) }],
        [{ name: 'Sả', percentage: 'y'.repeat(21) }],
        [{ name: 'Sả', benefit: 'z'.repeat(301) }],
        [{ name: 'Sả', extra: 'x' }],
        [{ name: 'Sả', percentage: { v: 1 } }],
        [{ name: 'Sả', benefit: ['a'] }],
        Array.from({ length: 31 }, (_, i) => ({ name: `Thành phần ${i}` })),
      ];
      for (const bad of bads) await expect(run(CreateMerchantProductDto, { ...OK, ingredients: bad })).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(CreateMerchantProductDto, { ...OK, ingredients: Array.from({ length: 30 }, (_, i) => ({ name: `Thành phần ${i}` })) })).resolves.toBeDefined();
    });

    it('sửa sản phẩm không có đường nào ghi thành phần (trường lạ bị chặn)', async () => {
      expect(await message(UpdateMerchantProductDto, { ingredients: [{ name: 'Sả' }] })).toContain('Không nhận trường «ingredients»');
    });
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

describe('DTO gian hàng đối tác (R3-MERCHANT-5)', () => {
  it('tên gian hàng rỗng hoặc chỉ khoảng trắng → 400 tiếng Việt, không để lọt xuống DB', async () => {
    expect(await message(UpdateMerchantStoreDto, { title: '' })).toContain('Tên gian hàng không được để trống');
    expect(await message(UpdateMerchantStoreDto, { title: '   ' })).toContain('Tên gian hàng không được để trống');
  });

  it('tên gian hàng được cắt khoảng trắng hai đầu', async () => {
    const dto = await run(UpdateMerchantStoreDto, { title: '  Shop Lan  ' });
    expect(dto.title).toBe('Shop Lan');
  });

  it('không gửi tên (chỉ đổi trường khác) vẫn hợp lệ', async () => {
    await expect(run(UpdateMerchantStoreDto, { headerNote: 'Xin chào' })).resolves.toMatchObject({ headerNote: 'Xin chào' });
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

describe('Lý do huỷ / giao không thành công (R4-PARTNER-1)', () => {
  it('chỉ có khoảng trắng hoặc rỗng → 400 tiếng Việt, không lọt xuống thông báo cho khách', async () => {
    expect(await message(MerchantOrderReasonDto, { reason: '   ' })).toContain('Cần nhập lý do để báo khách.');
    expect(await message(MerchantOrderReasonDto, { reason: ' \n\t ' })).toContain('Cần nhập lý do để báo khách.');
    expect(await message(MerchantOrderReasonDto, { reason: '' })).toContain('Cần nhập lý do để báo khách.');
    await expect(run(MerchantOrderReasonDto, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lý do được cắt khoảng trắng hai đầu', async () => {
    const dto = await run(MerchantOrderReasonDto, { reason: '  Khách không nghe máy  ' });
    expect(dto.reason).toBe('Khách không nghe máy');
  });
});

describe('Huỷ phiếu đối soát cần lý do (R4-PARTNER-4)', () => {
  it('thiếu, rỗng hoặc chỉ khoảng trắng → 400 tiếng Việt; có lý do thì được cắt khoảng trắng', async () => {
    expect(await message(CancelMerchantPayoutDto, {})).toContain('Cần nhập lý do huỷ phiếu để báo gian hàng.');
    expect(await message(CancelMerchantPayoutDto, { reason: '   ' })).toContain('Cần nhập lý do huỷ phiếu để báo gian hàng.');
    await expect(run(CancelMerchantPayoutDto, { reason: '  Lập nhầm kỳ  ' })).resolves.toMatchObject({ reason: 'Lập nhầm kỳ' });
  });
});

describe('DTO gian hàng đối tác: ảnh đại diện và ảnh bìa', () => {
  it.each(['avatarUrl', 'coverUrl'])('%s chỉ nhận https, ảnh raster base64 hoặc chuỗi rỗng', async (field) => {
    for (const ok of ['https://res.cloudinary.com/x/a.jpg', `data:image/jpeg;base64,${'A'.repeat(64)}`, '']) {
      await expect(run(UpdateMerchantStoreDto, { [field]: ok })).resolves.toBeDefined();
    }
    for (const bad of ['http://api:3001/a.png', 'http://169.254.169.254/x', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=']) {
      expect(await message(UpdateMerchantStoreDto, { [field]: bad })).toContain(field);
    }
  });
});
