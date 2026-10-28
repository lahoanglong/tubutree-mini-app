// Preload cho API phụ đo SQL (node -r): bọc PrismaClient để phát sự kiện query, ghi mỗi câu SQL một dòng "Q <sql>" vào $PERF_SQL_LOG.
// Không sửa mã sản phẩm (Prisma 5.22 không in query nếu mã khởi tạo không bật log; DEBUG=prisma:query không đủ).
const fs = require('node:fs');
const path = require('node:path');
const apiDir = process.env.PERF_API_DIR;
const m = require(require.resolve('@prisma/client', { paths: [apiDir] }));
const Orig = m.PrismaClient;
const file = process.env.PERF_SQL_LOG;
class Logged extends Orig {
  constructor(opts) {
    super({ ...(opts || {}), log: [...((opts && opts.log) || []), { emit: 'event', level: 'query' }] });
    this.$on('query', (e) => fs.appendFileSync(file, 'Q ' + String(e.query).replace(/\s+/g, ' ').slice(0, 400) + '\n'));
  }
}
Object.defineProperty(m, 'PrismaClient', { value: Logged, configurable: true, writable: true });
