import { Module } from '@nestjs/common';
import { EcoFactsReader } from './eco-facts.reader';
import { EcoPassportService } from './eco-passport.service';
import { EcoPassportController } from './eco-passport.controller';
import { EcoFactsAdminService } from './eco-facts-admin.service';
import { EcoFactsAdminController } from './eco-facts-admin.controller';

/** Sự thật xanh có nguồn (nhãn thẻ, khối trang sản phẩm, bảng so sánh) và Hộ chiếu Xanh. Chỉ đọc bảng của mô-đun khác, không gọi service của chúng. */
@Module({
  controllers: [EcoPassportController, EcoFactsAdminController],
  providers: [EcoFactsReader, EcoPassportService, EcoFactsAdminService],
  exports: [EcoFactsReader],
})
export class EcoImpactModule {}
