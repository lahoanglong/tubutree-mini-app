import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AffiliateModule } from './affiliate.module';
import { AffiliateService } from './affiliate.service';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { ImageRegistryModule } from '../catalog/image-registry.module';
import { ImageRegistryStale } from '../catalog/image-registry-stale';

/**
 * AffiliateService nhận FlashSaleService qua @Optional (test dựng tay không truyền). Thiếu import FlashSaleModule thì Nest lặng
 * lẽ tiêm undefined và đơn CTV lên hộ quay lại tính giá niêm yết trong giờ vàng (R4-CHECKOUT-5) — khoá việc nối ở đây.
 */
describe('AffiliateModule nối FlashSaleService cho đơn CTV lên hộ', () => {
  it('AffiliateService khai báo FlashSaleService trong constructor', () => {
    expect(Reflect.getMetadata('design:paramtypes', AffiliateService)).toContain(FlashSaleService);
  });

  it('AffiliateModule import FlashSaleModule, và module đó export FlashSaleService', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AffiliateModule)).toContain(FlashSaleModule);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, FlashSaleModule)).toContain(FlashSaleService);
  });
});

/** ImageRegistryStale là @Optional: thiếu import ImageRegistryModule thì đăng ký CTV lặng lẽ không đánh dấu danh sách ảnh /img. */
describe('AffiliateModule nối ImageRegistryStale cho đăng ký CTV', () => {
  it('AffiliateService khai báo ImageRegistryStale trong constructor', () => {
    expect(Reflect.getMetadata('design:paramtypes', AffiliateService)).toContain(ImageRegistryStale);
  });

  it('AffiliateModule import ImageRegistryModule, và module đó export ImageRegistryStale', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AffiliateModule)).toContain(ImageRegistryModule);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, ImageRegistryModule)).toContain(ImageRegistryStale);
  });
});
