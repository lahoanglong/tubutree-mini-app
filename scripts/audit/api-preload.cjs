/**
 * Preloaded (`node -r scripts/audit/api-preload.cjs .audit/api-dist/main.js`) into the AUDIT API
 * process only — never used by the owner's dev API.
 *
 * 1) ENV ISOLATION (critical). The generated Prisma client is built with
 *    schemaEnvPath = apps/api/.env and loads that file into process.env the moment
 *    `@prisma/client` is required (warnEnvConflicts -> tryLoadEnvs), i.e. BEFORE @nestjs/config
 *    runs. Any key missing from process.env would silently take the OWNER's value (their DB
 *    `tubutree`, Redis DB 0, port 3001, real AI/Zalo keys). Windows cannot pass an EMPTY env var
 *    to a child process, so this preload copies EVERY key of .audit/api.env (empty values
 *    included) into process.env first, then requires @prisma/client and re-checks the guards.
 *    Any mismatch -> exit(78) before the app starts.
 *
 * 2) AUDIT_DISABLE_THROTTLE=1 turns the global ThrottlerGuard into a no-op via its official
 *    extension point `shouldSkip()`. The API allows 60 req/min per endpoint per IP and only
 *    5 req/min on /auth/refresh|guest; a screenshot run loads dozens of pages per minute from
 *    one IP, and once /auth/refresh answers 429 the miniapp silently falls back to a GUEST login
 *    (screenshot shows the wrong persona). Start with -KeepThrottle to keep the real limits.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENV_FILE = process.env.AUDIT_ENV_FILE || path.resolve(__dirname, '..', '..', '.audit', 'api.env');
const EXPECT_DB = 'tubutree_audit';
const EXPECT_PORT = '3201';
const EXPECT_REDIS_DB = '5';

function fail(msg) {
  process.stderr.write(`[audit-preload] REFUSING TO START: ${msg}\n`);
  process.exit(78);
}

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

function check(stage) {
  let db;
  try {
    db = decodeURIComponent(new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, ''));
  } catch {
    fail(`${stage}: DATABASE_URL is not a valid URL`);
  }
  if (db !== EXPECT_DB) fail(`${stage}: DATABASE_URL database is "${db}", expected "${EXPECT_DB}"`);
  if (process.env.PORT !== EXPECT_PORT) fail(`${stage}: PORT is "${process.env.PORT}", expected ${EXPECT_PORT}`);
  let redisDb = '';
  try {
    redisDb = new URL(process.env.REDIS_URL || '').pathname.replace(/^\//, '');
  } catch {
    /* handled below */
  }
  if (redisDb !== EXPECT_REDIS_DB) fail(`${stage}: REDIS_URL must use DB index ${EXPECT_REDIS_DB}`);
}

if (!fs.existsSync(ENV_FILE)) fail(`${ENV_FILE} not found (run node scripts/audit/build-audit-env.mjs)`);
const auditEnv = parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
for (const [k, v] of Object.entries(auditEnv)) process.env[k] = v; // override, empty values included
check('after loading .audit/api.env');

// Trigger Prisma's own .env loading NOW (it only fills keys that are absent — all are present).
require('@prisma/client');
check('after @prisma/client env loading');
for (const [k, v] of Object.entries(auditEnv)) {
  if (process.env[k] !== v) fail(`key ${k} was changed while loading @prisma/client`);
}
process.stdout.write(
  `[audit-preload] env isolated: db=${EXPECT_DB} port=${EXPECT_PORT} redisDb=${EXPECT_REDIS_DB} ` +
    `blank=${Object.entries(auditEnv).filter(([, v]) => v === '').length} keys\n`,
);

if (process.env.AUDIT_DISABLE_THROTTLE === '1') {
  try {
    // Resolved through NODE_PATH=apps/api/node_modules -> same module instance the app uses.
    const throttler = require('@nestjs/throttler');
    throttler.ThrottlerGuard.prototype.shouldSkip = async function auditSkip() {
      return true;
    };
    process.stdout.write('[audit-preload] ThrottlerGuard disabled (AUDIT_DISABLE_THROTTLE=1)\n');
  } catch (err) {
    process.stderr.write(`[audit-preload] could not patch ThrottlerGuard: ${err && err.message}\n`);
  }
}
