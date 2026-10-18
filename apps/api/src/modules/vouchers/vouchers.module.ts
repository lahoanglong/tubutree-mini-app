import { Module } from '@nestjs/common';
import { VouchersService } from './vouchers.service';

@Module({
  providers: [VouchersService],
  // AuthService cấp voucher chào mừng ngay khi tài khoản thật được tạo (D2-07a).
  exports: [VouchersService],
})
export class VouchersModule {}
