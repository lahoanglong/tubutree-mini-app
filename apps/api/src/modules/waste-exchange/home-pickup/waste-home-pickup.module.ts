import { Module } from '@nestjs/common';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteFeeBankService } from './waste-fee-bank.service';
import { WasteFeeUnpaidCron } from './waste-fee-unpaid.cron';
import { WasteHomePickupService } from './waste-home-pickup.service';

/** Vòng đời phiếu shipper lấy tận nhà, không phụ thuộc GomdonModule: Gomdon (webhook, job) và luồng khách cùng import module này. */
@Module({
  imports: [WasteCoreModule],
  providers: [WasteHomePickupService, WasteFeeBankService, WasteFeeUnpaidCron],
  exports: [WasteHomePickupService, WasteFeeBankService],
})
export class WasteHomePickupModule {}
