// Khởi động Postgres NHÚNG (không cần Docker) cho test local trên máy bất kỳ.
// - Tạo cluster trong tools/local-test/.pgdata (gitignored), cổng PG_PORT (mặc định 5544).
// - Đảm bảo database `tubutree` mã hoá UTF8 (cluster mặc định WIN1252 → mojibake tiếng Việt).
// - Giữ tiến trình sống; Ctrl+C để dừng.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PG_PORT ?? 5544);
const DATA_DIR = join(__dirname, '.pgdata');
const Ctor = EmbeddedPostgres.default ?? EmbeddedPostgres;

const pgsql = new Ctor({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
});

async function ensureUtf8Db() {
  const client = new pg.Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await client.connect();
  const exists = await client.query("SELECT pg_encoding_to_char(encoding) enc FROM pg_database WHERE datname='tubutree'");
  if (exists.rowCount === 0) {
    await client.query("CREATE DATABASE tubutree WITH ENCODING 'UTF8' TEMPLATE template0");
    console.log('created tubutree (UTF8)');
  } else if (exists.rows[0].enc !== 'UTF8') {
    // Chỉ xảy ra ở lần đầu nếu createDatabase tạo theo cluster (WIN1252) khi DB còn rỗng.
    await client.query('DROP DATABASE tubutree');
    await client.query("CREATE DATABASE tubutree WITH ENCODING 'UTF8' TEMPLATE template0");
    console.log('recreated tubutree as UTF8');
  } else {
    console.log('tubutree already UTF8');
  }
  await client.end();
}

async function main() {
  if (!fs.existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log('initialise cluster...');
    await pgsql.initialise();
  }
  await pgsql.start();
  await ensureUtf8Db();
  const url = `postgresql://postgres:postgres@localhost:${PORT}/tubutree`;
  console.log('READY  DATABASE_URL=' + url);
  console.log('→ Bước tiếp: trong apps/api đặt DATABASE_URL trên rồi chạy prisma migrate deploy + prisma:seed.');
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
process.on('SIGINT', async () => { try { await pgsql.stop(); } catch {} process.exit(0); });
