import { Module } from '@nestjs/common';
import { RbacService } from './rbac/rbac.service';
import { ShiftsService } from './shifts/shifts.service';
import { AttendanceService } from './attendance/attendance.service';
import { AttendanceJob } from './attendance/attendance.job';
import { PayrollService } from './payroll/payroll.service';
import { PayrollJob } from './payroll/payroll.job';
import { AdminStaffController } from './admin-staff.controller';
import { AdminShiftsController } from './admin-shifts.controller';
import { StaffController } from './staff.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { AdminAttendanceController } from './attendance/admin-attendance.controller';
import { PayrollController } from './payroll/payroll.controller';
import { AdminPayrollController } from './payroll/admin-payroll.controller';

// PrismaModule + SystemConfigModule + ConfigModule là @Global() → không cần import ở đây.
@Module({
  controllers: [
    AdminStaffController,
    AdminShiftsController,
    StaffController,
    AttendanceController,
    AdminAttendanceController,
    PayrollController,
    AdminPayrollController,
  ],
  providers: [RbacService, ShiftsService, AttendanceService, AttendanceJob, PayrollService, PayrollJob],
  exports: [RbacService, ShiftsService, AttendanceService, PayrollService],
})
export class StaffModule {}
