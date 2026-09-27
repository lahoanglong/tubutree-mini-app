#!/usr/bin/env node
/**
 * Build the env file for the ISOLATED audit API (.audit/api.env) from apps/api/.env.
 *
 *   node scripts/audit/build-audit-env.mjs            # write/refresh .audit/api.env
 *   node scripts/audit/build-audit-env.mjs --print-db # print ONLY the audit DATABASE_URL (for scripts)
 *
 * What it does (never prints secret values):
 *  - copies every key of apps/api/.env,
 *  - DATABASE_URL  -> same server/credentials, database name forced to `tubutree_audit`
 *  - REDIS_URL     -> redis://localhost:6381/5  (DB index 5, never the owner's DB 0)
 *  - PORT=3201, NODE_ENV=development, CORS_ORIGINS=http://localhost:3213,http://localhost:3212
 *  - JWT_ACCESS_SECRET / JWT_REFRESH_SECRET -> a DEDICATED random secret for the audit env
 *    (generated once, reused from the existing .audit/api.env) so audit tokens are never valid
 *    against the owner's dev API on :3001.
 *  - every third-party integration key (Pancake, Zalo/ZNS/OA, ZaloPay, AccessTrade, DeepSeek/
 *    Gemini/any AI, Gomdon, SMTP/email, SMS) is written as an EMPTY value.
 *
 * Important on Windows: an empty value cannot be passed through the process environment
 * (PowerShell `$env:X=''` deletes X), so the API must be started with its CWD = .audit/api-run
 * where this file is copied as `.env` — @nestjs/config then reads the explicit `KEY=` lines.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const SRC = path.join(repo, 'apps', 'api', '.env');
const OUT_DIR = path.join(repo, '.audit');
const OUT = path.join(OUT_DIR, 'api.env');
const RUN_DIR = path.join(OUT_DIR, 'api-run');

export const AUDIT_DB_NAME = 'tubutree_audit';
export const AUDIT_REDIS_URL = 'redis://localhost:6381/5';
export const AUDIT_API_PORT = 3201;
export const AUDIT_CORS = 'http://localhost:3213,http://localhost:3212';

/** Keys read by apps/api/src/config/env.validation.ts that talk to a third party. */
export const BLANKED_KEYS = [
  // Zalo Mini App / OA / ZNS
  'ZALO_APP_ID', 'ZALO_APP_SECRET', 'ZALO_OA_ACCESS_TOKEN', 'ZALO_OA_REFRESH_TOKEN', 'ZALO_OA_ID',
  'ZALO_OAUTH_BASE', 'ZALO_OA_WEBHOOK_SECRET', 'ZNS_BASE_URL',
  // Pancake POS
  'PANCAKE_BASE_URL', 'PANCAKE_API_KEY', 'PANCAKE_SHOP_ID', 'PANCAKE_WEBHOOK_SECRET',
  // Gomdon (BestExpress waybills)
  'GOMDON_BASE_URL', 'GOMDON_PHONE', 'GOMDON_PASSWORD', 'GOMDON_WEBHOOK_SECRET',
  // ZaloPay
  'ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2', 'ZALOPAY_ENDPOINT',
  // AccessTrade (cashback)
  'ACCESSTRADE_BASE_URL', 'ACCESSTRADE_TOKEN', 'ACCESSTRADE_PUBLISHER_ID', 'ACCESSTRADE_WEBHOOK_SECRET',
  // AI (DeepSeek primary + Gemini fallback, OpenAI-compatible)
  'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'GEMINI_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_MODEL',
];
/** Any extra key in apps/api/.env matching these is blanked too (SMTP/email/SMS/other AI vendors). */
const BLANK_PATTERN =
  /(PANCAKE|ZALO|ZNS|ZALOPAY|ACCESSTRADE|DEEPSEEK|GEMINI|OPENAI|ANTHROPIC|CLAUDE|GROQ|MISTRAL|COHERE|LLM|GOMDON|SMTP|MAIL|EMAIL|SENDGRID|MAILGUN|SES_|SMS|TWILIO|ESMS|SPEEDSMS|FIREBASE|FCM|SENTRY|S3_|AWS_|CLOUDINARY|VNPAY|MOMO)/i;

function parseEnv(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.push([key, value]);
  }
  return out;
}

export function auditDatabaseUrl(ownerUrl) {
  const u = new URL(ownerUrl);
  u.pathname = `/${AUDIT_DB_NAME}`;
  return u.toString();
}

export function readAuditEnv() {
  if (!existsSync(OUT)) throw new Error(`${OUT} missing — run: node scripts/audit/build-audit-env.mjs`);
  return Object.fromEntries(parseEnv(readFileSync(OUT, 'utf8')));
}

function build() {
  if (!existsSync(SRC)) throw new Error(`Missing ${SRC}`);
  const src = parseEnv(readFileSync(SRC, 'utf8'));
  const srcMap = Object.fromEntries(src);
  if (!srcMap.DATABASE_URL) throw new Error('apps/api/.env has no DATABASE_URL');

  const previous = existsSync(OUT) ? Object.fromEntries(parseEnv(readFileSync(OUT, 'utf8'))) : {};
  const secret = (k) => (previous[k] && previous[k].length >= 32 ? previous[k] : randomBytes(48).toString('hex'));

  const env = new Map(src);
  const blanked = new Set(BLANKED_KEYS);
  for (const [k] of src) if (BLANK_PATTERN.test(k)) blanked.add(k);
  for (const k of blanked) env.set(k, '');

  env.set('NODE_ENV', 'development');
  env.set('PORT', String(AUDIT_API_PORT));
  env.set('DATABASE_URL', auditDatabaseUrl(srcMap.DATABASE_URL));
  env.set('REDIS_URL', AUDIT_REDIS_URL);
  env.set('CORS_ORIGINS', AUDIT_CORS);
  env.set('JWT_ACCESS_SECRET', secret('JWT_ACCESS_SECRET'));
  env.set('JWT_REFRESH_SECRET', secret('JWT_REFRESH_SECRET'));
  if (!env.get('JWT_ACCESS_TTL')) env.set('JWT_ACCESS_TTL', '15m');
  if (!env.get('JWT_REFRESH_TTL_DAYS')) env.set('JWT_REFRESH_TTL_DAYS', '30');
  env.set('AUTH_COOKIE_SAMESITE', 'lax');
  env.delete('AUTH_COOKIE_DOMAIN'); // host-only cookie on localhost
  env.delete('SEED_ADMIN_PHONES');

  const lines = [
    '# GENERATED by scripts/audit/build-audit-env.mjs — audit env ONLY (db tubutree_audit, redis db 5, port 3201).',
    '# Third-party integrations are intentionally blank. Do not copy these values anywhere else.',
    ...[...env.entries()].map(([k, v]) => `${k}=${v}`),
    '',
  ];
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  // The API is started with CWD=.audit/api-run so @nestjs/config loads THIS file as `.env`.
  writeFileSync(path.join(RUN_DIR, '.env'), lines.join('\n'), 'utf8');
  return { keys: [...env.keys()], blanked: [...blanked].sort() };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--print-db')) {
    process.stdout.write(readAuditEnv().DATABASE_URL);
  } else {
    const r = build();
    console.log(JSON.stringify({ wrote: path.relative(repo, OUT), keys: r.keys, blankedKeys: r.blanked }, null, 2));
  }
}
