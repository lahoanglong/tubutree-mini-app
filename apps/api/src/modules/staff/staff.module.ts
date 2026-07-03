import { Module } from '@nestjs/common';
import { RbacService } from './rbac/rbac.service';
import { AdminStaffController } from './admin-staff.controller';

// PrismaModule là @Global() → không cần import ở đây.
@Module({
  controllers: [AdminStaffController],
  providers: [RbacService],
  exports: [RbacService],
})
export class StaffModule {}
