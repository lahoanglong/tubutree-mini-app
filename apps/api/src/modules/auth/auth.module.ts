import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ZaloService } from './zalo.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { StaffModule } from '../staff/staff.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ExternalPointsModule } from '../external-points/external-points.module';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';
import { WebLoginController } from './web-login/web-login.controller';
import { EmailOtpService } from './web-login/email-otp.service';
import { EmailOtpMailer } from './web-login/email-otp.mailer';
import { EMAIL_OTP_STORE, RedisEmailOtpStore } from './web-login/email-otp.store';
import { GoogleOAuthService } from './web-login/google-oauth.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), StaffModule, VouchersModule, ExternalPointsModule],
  controllers: [AuthController, WebLoginController],
  providers: [
    AuthService,
    ZaloService,
    JwtStrategy,
    EmailOtpService,
    EmailOtpMailer,
    GoogleOAuthService,
    // Mã email nằm trên kết nối Redis sẵn có của BullMQ. App dựng không có QueueModule (vài test) thì không có kho: đăng nhập email trả 503.
    {
      provide: EMAIL_OTP_STORE,
      inject: [{ token: getQueueToken(QUEUE_NOTIFICATIONS), optional: true }],
      useFactory: (q?: Queue) => (q ? new RedisEmailOtpStore(q) : undefined),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
