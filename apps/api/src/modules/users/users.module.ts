import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AccountDeletionService } from './account-deletion.service';
import { AdminAccountDeletionController } from './admin-account-deletion.controller';

@Module({
  controllers: [UsersController, AdminAccountDeletionController],
  providers: [UsersService, AccountDeletionService],
  exports: [UsersService],
})
export class UsersModule {}
