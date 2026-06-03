import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './jobs/queue.module';
import { SystemConfigModule } from './modules/system-config/system-config.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { OrdersModule } from './modules/orders/orders.module';
import { GameModule } from './modules/game/game.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { AffiliateModule } from './modules/affiliate/affiliate.module';
import { CashbackModule } from './modules/cashback/cashback.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { DealerModule } from './modules/dealer/dealer.module';
import { AdminModule } from './modules/admin/admin.module';
import { PancakeModule } from './modules/integrations/pancake/pancake.module';
import { PaymentModule } from './modules/integrations/payment/payment.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PrismaModule,
    QueueModule,
    // Global cross-cutting
    SystemConfigModule,
    PricingModule,
    LoyaltyModule,
    CouponsModule,
    NotificationsModule,
    // Features
    AuthModule,
    HealthModule,
    UsersModule,
    CatalogModule,
    CartModule,
    CheckoutModule,
    OrdersModule,
    GameModule,
    ReviewsModule,
    AffiliateModule,
    CashbackModule,
    WalletModule,
    DealerModule,
    AdminModule,
    PancakeModule,
    PaymentModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
