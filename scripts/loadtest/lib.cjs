// Tiện ích dùng chung cho kịch bản đo tải: ký JWT, đọc .env, chọn user sinh sẵn.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
function env(key) {
  const t = fs.readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8');
  const m = t.match(new RegExp('^' + key + '=(.*)$', 'm'));
  return m ? m[1].replace(/^"|"$/g, '').trim() : undefined;
}
const b64 = (b) => Buffer.from(b).toString('base64url');
function signJwt(payload, secret, ttlSec = 6 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + sig;
}
function tokenFor(userId, role = 'CUSTOMER') {
  return signJwt({ sub: userId, role, affiliateEnabled: false, dealerEnabled: false }, env('JWT_ACCESS_SECRET'));
}
function pgConf() {
  const u = new URL(env('DATABASE_URL'));
  return { host: u.hostname, port: +u.port, user: u.username, password: decodeURIComponent(u.password), database: 'tubutree_perf' };
}
module.exports = { env, signJwt, tokenFor, pgConf, ROOT };
