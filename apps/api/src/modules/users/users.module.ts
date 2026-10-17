import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AccountDeletionService, PARTNER_STORE_BLOCKERS } from './account-deletion.service';
import { AdminAccountDeletionController } from './admin-account-deletion.controller';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { MerchantModule } from '../merchant/merchant.module';
import { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';

@Module({
  imports: [PancakeModule, MerchantModule],
  controllers: [UsersController, AdminAccountDeletionController],
  providers: [UsersService, AccountDeletionService, { provide: PARTNER_STORE_BLOCKERS, useExisting: MerchantFulfilmentService }],
  exports: [UsersService],
})
export class UsersModule {}
