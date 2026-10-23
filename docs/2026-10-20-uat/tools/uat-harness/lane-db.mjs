#!/usr/bin/env node
// Việc DB/Redis của lane (lane-up/lane-down/build-template gọi; agent ít khi gọi tay):
//   lane-db.mjs create <N> [--fresh]   tạo tubutree_uat_l<N> = CREATE DATABASE ... TEMPLATE tubutree_uat_tpl (đã có thì giữ, --fresh thì tạo lại)
//   lane-db.mjs drop <N>               xoá DB lane (WITH FORCE)
//   lane-db.mjs flush-redis <N>        FLUSHDB Redis db N (hàng đợi BullMQ, đếm throttle của lane)
//   lane-db.mjs redis-clients <N>      số kết nối Redis khác đang dùng db của lane (lane-up đòi bằng 0)
//   lane-db.mjs tpl-connections        liệt kê kết nối đang mở vào DB mẫu
//   lane-db.mjs exists <db>            in 1/0
import { lane, PG_PORT, redisFor, requireFromApi, ensureLaneEnv } from './lib.mjs';

const TPL = 'tubutree_uat_tpl';
const { PrismaClient } = requireFromApi('@prisma/client');
const admin = new PrismaClient({ datasources: { db: { url: `postgresql://tubu@127.0.0.1:${PG_PORT}/postgres` } } });

async function exists(db) {
  const r = await admin.$queryRawUnsafe('SELECT 1 FROM pg_database WHERE datname = $1', db);
  return r.length > 0;
}

async function tplConnections() {
  return admin.$queryRawUnsafe(
    'SELECT pid, usename, application_name, client_addr::text, state, backend_start::text FROM pg_stat_activity WHERE datname = $1',
    TPL,
  );
}

const [cmd, arg, ...flags] = process.argv.slice(2);
try {
  if (cmd === 'exists') {
    console.log((await exists(arg)) ? 1 : 0);
  } else if (cmd === 'tpl-connections') {
    console.log(JSON.stringify(await tplConnections(), null, 2));
  } else if (cmd === 'create') {
    const L = lane(arg);
    if (L.n === 9) throw new Error('lane 9 là DB mẫu, dựng bằng build-template.sh');
    ensureLaneEnv(L);
    if (!(await exists(TPL))) throw new Error(`Chưa có DB mẫu ${TPL} — chạy build-template.sh trước`);
    const fresh = flags.includes('--fresh');
    if (fresh && (await exists(L.db))) {
      await admin.$executeRawUnsafe(`DROP DATABASE "${L.db}" WITH (FORCE)`);
      console.log(`đã xoá ${L.db}`);
    }
    if (await exists(L.db)) {
      console.log(`giữ ${L.db} (đã có; --fresh để tạo lại từ mẫu)`);
      console.log('CREATED=0');
    } else {
      const conns = await tplConnections();
      if (conns.length) throw new Error(`DB mẫu đang có ${conns.length} kết nối mở, không copy được: ${JSON.stringify(conns)}`);
      await admin.$executeRawUnsafe(`CREATE DATABASE "${L.db}" TEMPLATE "${TPL}"`);
      console.log(`đã tạo ${L.db} từ ${TPL}`);
      console.log('CREATED=1');
    }
  } else if (cmd === 'drop') {
    const L = lane(arg);
    if (L.n === 9) throw new Error('không xoá DB mẫu bằng lệnh này');
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${L.db}" WITH (FORCE)`);
    console.log(`đã xoá ${L.db}`);
  } else if (cmd === 'redis-clients') {
    // Số kết nối khác (không tính kết nối kiểm tra này) đang chọn db của lane — CLIENT LIST ghi db=<n> cho từng kết nối.
    const L = lane(arg);
    const r = redisFor(L);
    const list = String(await r.client('LIST')).trim().split('\n');
    const id = await r.client('ID');
    const others = list.filter((l) => new RegExp(`\\bdb=${L.redisDb}\\b`).test(l) && !new RegExp(`\\bid=${id}\\b`).test(l));
    console.log(others.length);
    r.disconnect();
  } else if (cmd === 'flush-redis') {
    const L = lane(arg);
    const r = redisFor(L);
    await r.flushdb();
    console.log(`đã FLUSHDB Redis db ${L.redisDb}`);
    r.disconnect();
  } else {
    console.error('dùng: lane-db.mjs create <N> [--fresh] | drop <N> | flush-redis <N> | tpl-connections | exists <db>');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await admin.$disconnect();
}
