import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { bootstrap } from './bootstrap';
import { captureServerError, initSentry } from './config/sentry';

// Trước khi Nest được dựng (AppModule đã import xong nhưng NestFactory.create chưa chạy): SDK vá http/pg lúc này.
initSentry();

// Lưới an toàn cuối cùng: 'cron'/@nestjs/schedule KHÔNG tự catch lỗi trong @Cron() handler.
// Node 20 mặc định unhandledRejection=throw → 1 lỗi Prisma/network thoáng qua trong BẤT KỲ
// cron nào sẽ sập TOÀN BỘ API process, ảnh hưởng mọi user đang dùng app. Đây KHÔNG thay thế
// try/catch riêng từng cron (đã bọc ở dealer/loyalty/groupbuy/cashback/flash-sale) — chỉ chặn
// rơi sót ở nơi khác. Lỗi khởi động không đi qua đây: bootstrap tự thoát mã 1.
process.on('unhandledRejection', (reason) => {
  captureServerError(reason);
  new Logger('UnhandledRejection').error(`Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : reason}`);
});

void bootstrap(AppModule, { port: Number(process.env.PORT ?? 3001) });
