import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ZaloService } from './zalo.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { StaffModule } from '../staff/staff.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ExternalPointsModule } from '../external-points/external-points.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), StaffModule, VouchersModule, ExternalPointsModule],
  controllers: [AuthController],
  providers: [AuthService, ZaloService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
