import { Module } from '@nestjs/common';
import { RbacService } from './rbac/rbac.service';
import { ShiftsService } from './shifts/shifts.service';
import { AttendanceService } from './attendance/attendance.service';
import { AttendanceJob } from './attendance/attendance.job';
import { AdminStaffController } from './admin-staff.controller';
import { AdminShiftsController } from './admin-shifts.controller';
import { StaffController } from './staff.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { AdminAttendanceController } from './attendance/admin-attendance.controller';

// PrismaModule + SystemConfigModule + ConfigModule là @Global() → không cần import ở đây.
@Module({
  controllers: [
    AdminStaffController,
    AdminShiftsController,
    StaffController,
    AttendanceController,
    AdminAttendanceController,
  ],
  providers: [RbacService, ShiftsService, AttendanceService, AttendanceJob],
  exports: [RbacService, ShiftsService, AttendanceService],
})
export class StaffModule {}
