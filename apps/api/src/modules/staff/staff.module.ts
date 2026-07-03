import { Module } from '@nestjs/common';
import { RbacService } from './rbac/rbac.service';
import { ShiftsService } from './shifts/shifts.service';
import { AdminStaffController } from './admin-staff.controller';
import { AdminShiftsController } from './admin-shifts.controller';
import { StaffController } from './staff.controller';

// PrismaModule + SystemConfigModule là @Global() → không cần import ở đây.
@Module({
  controllers: [AdminStaffController, AdminShiftsController, StaffController],
  providers: [RbacService, ShiftsService],
  exports: [RbacService, ShiftsService],
})
export class StaffModule {}
