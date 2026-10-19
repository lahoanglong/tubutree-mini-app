// Dò khoá nào BẮT BUỘC ở production: bỏ từng khoá khỏi một env hợp lệ rồi gọi checkEnv của bản build.
// Dùng: node d10-required-probe.cjs <đường dẫn apps/api/dist/config/check-env.js> <file env giả>
const path = require('path'); const fs = require('fs');
const { checkEnv } = require(path.resolve(process.argv[2]));
const { envSchema } = require(path.resolve(path.dirname(process.argv[2]), 'env.validation.js'));
const base = {};
for (const l of fs.readFileSync(process.argv[3], 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m) base[m[1]] = m[2]; }
base.NODE_ENV = 'production';
base.DATABASE_URL = 'postgresql://tubu:pw@postgres:5432/tubutree';
base.REDIS_URL = 'redis://redis:6379';
const r0 = checkEnv(base);
console.log('baseline production:', r0.ok ? 'OK' : r0.message);
const keys = Object.keys((envSchema.shape || envSchema._def.schema.shape));
const rows = [];
for (const k of keys) {
  const e = { ...base }; delete e[k];
  const dev = { ...e, NODE_ENV: 'development' };
  const rp = checkEnv(e); const rd = checkEnv(dev);
  rows.push([k, rp.ok ? 'không' : 'CÓ', rd.ok ? 'không' : 'CÓ', k in base ? 'có trong env giả' : 'không có trong env giả (mặc định)']);
}
console.log('khoá\tthiếu ở prod thì lỗi\tthiếu ở dev thì lỗi\tghi chú');
for (const r of rows) console.log(r.join('\t'));
