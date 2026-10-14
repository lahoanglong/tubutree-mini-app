import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AffiliateModule } from './affiliate.module';
import { AffiliateService } from './affiliate.service';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { FlashSaleService } from '../flash-sale/flash-sale.service';

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
