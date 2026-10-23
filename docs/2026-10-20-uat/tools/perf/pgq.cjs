// Chạy một câu SQL qua Prisma của apps/api, in JSON (BigInt -> số).
// Dùng: DATABASE_URL=... node pgq.cjs "SELECT 1"   (chạy từ thư mục bất kỳ; tự trỏ @prisma/client của apps/api)
const path = require('path');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../../../apps/api')] }));
(async () => {
  const p = new PrismaClient();
  try {
    const rows = await p.$queryRawUnsafe(process.argv[2]);
    console.log(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  } finally { await p.$disconnect(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
