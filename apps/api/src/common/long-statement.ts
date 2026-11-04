import type { Prisma } from '@prisma/client';

/**
 * DB_SESSION_OPTIONS đặt statement_timeout 30s cho mọi kết nối của API (runbook §1.19). Việc chạy tay hoặc nền mà một câu lệnh hợp lý
 * có thể lâu hơn thế thì gọi hàm này ngay đầu transaction: giá trị chỉ sống tới hết transaction (set_config local = true).
 */
export const LONG_STATEMENT_TIMEOUT = '120s';

export async function allowLongStatements(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, timeout = LONG_STATEMENT_TIMEOUT): Promise<void> {
  await tx.$queryRaw`SELECT set_config('statement_timeout', ${timeout}, true)`;
}
