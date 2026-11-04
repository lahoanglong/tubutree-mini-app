import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { buildDatasourceUrl } from './db-session-options';

/**
 * maxWait là hạn chờ lấy kết nối từ pool cho `$transaction`; mặc định của Prisma (2 giây) quá ngắn khi nhiều tab admin hay
 * cron cùng chiếm pool nên checkout dính P2028. timeout giữ mặc định 5 giây của Prisma; chỗ nào cần dài hơn tự truyền.
 */
export const PRISMA_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 5_000 } as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = buildDatasourceUrl(process.env.DATABASE_URL, process.env.DB_SESSION_OPTIONS);
    super({ transactionOptions: { ...PRISMA_TRANSACTION_OPTIONS }, ...(url ? { datasources: { db: { url } } } : {}) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
