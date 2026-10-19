#!/usr/bin/env node
// Chạy một job/cron (hoặc method bất kỳ của provider Nest) NGAY, trên DB/Redis của lane, bằng chính mã apps/api/dist:
// NestFactory.createApplicationContext(AppModule) với env lane → app.get(Class).method(...args) → in kết quả → đóng context.
// Context không mở cổng HTTP và không giữ lease cron (CronLeaderService.start chỉ chạy trong bootstrap), nên @Cron của nó không tự chạy;
// worker BullMQ của context có thể nhận job của lane trong lúc chạy — vô hại (cùng mã, cùng DB).
// Dùng:
//   run-job.mjs --list                                  bảng job (bí danh → Class.method, lịch @Cron)
//   run-job.mjs <lane> <bí danh | Class.method> [--args '<JSON mảng>']   ({"$date":"ISO"} trong args thành Date)
// Ví dụ: run-job.mjs 1 points.expire ; run-job.mjs 1 LoyaltyService.recalcTier --args '["uat_returning"]'
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { API_DIR, jsonOut, lane, laneEnv } from './lib.mjs';

const SRC = path.join(API_DIR, 'src');
const DIST = path.join(API_DIR, 'dist');

/** Bí danh thân thiện → Class.method (bổ sung cho tên `name:` khai trong @Cron). */
const ALIASES = {
  'points.expire': 'LoyaltyExpiryService.expirePoints',
  'points.expiry-reminder': 'LoyaltyExpiryService.remindExpiringPoints',
  'tiers.recalc': 'LoyaltyCron.recalcTiers',
  'commissions.approve-due': 'AffiliateService.approveDueCommissions',
  'external-claims.release': 'ExternalClaimCron.everyThirtyMinutes',
  'external-claims.poll': 'ExternalClaimCron.pollFallback',
  'vouchers.welcome': 'VouchersService.welcomeVouchers',
  'vouchers.birthday': 'VouchersService.birthdayVouchers',
  'vouchers.winback': 'VouchersService.winbackVouchers',
  'vouchers.milestone': 'VouchersService.milestoneVouchers',
  'vouchers.second-order': 'VouchersService.secondOrderVouchers',
  'remarketing.voucher-expiry': 'RemarketingService.sendVoucherExpiryReminders',
  'remarketing.cart-abandon': 'RemarketingService.sendCartAbandonReminders',
  'pancake.push-reconcile': 'PancakePushReconcileService.reconcile',
  'pancake.catalog-sync': 'PancakeSyncService.scheduledSync',
  'flash-sale.notify-started': 'FlashSaleService.notifyStartedFlashSales',
  'dealer.payout-quarterly': 'DealerCron.payoutQuarterly',
  'dealer.backorder-reconcile': 'DealerBackorderService.reconcile',
  'cashback.settle': 'CashbackService.settleConfirmed',
  'subscriptions.process-due': 'SubscriptionsService.processDue',
  'review-invites': 'ReviewInviteService.sendReviewInvites',
  'reorder-reminders': 'LifecycleService.sendReorderReminders',
  'game.reminders': 'GameReminderService.sendDailyReminders',
  'storefront.reminders': 'StorefrontReminderService.remindTrendingProducts',
  'analytics.nightly': 'AnalyticsAggregationService.runNightly',
  'payroll.nightly': 'PayrollJob.nightly',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Quét src: class xuất ra → file dist; mọi @Cron → {class, method, lịch, tên}. */
function scan() {
  const classes = new Map();
  const crons = [];
  for (const f of walk(SRC)) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.split('\n');
    let current = null;
    lines.forEach((line, i) => {
      const c = line.match(/^export class (\w+)/);
      if (c) {
        current = c[1];
        if (!classes.has(current)) classes.set(current, f);
      }
      const cron = line.match(/^\s*@Cron\(\s*('[^']*'|"[^"]*"|[\w.]+)(?:\s*,\s*\{([^}]*)\})?/);
      if (cron && current) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const m = lines[j].match(/^\s*(?:async\s+)?(\w+)\s*\(/);
          if (m && !lines[j].trim().startsWith('@')) {
            const name = cron[2]?.match(/name:\s*'([^']+)'/)?.[1] ?? null;
            crons.push({ class: current, method: m[1], schedule: cron[1].trim(), name, file: path.relative(API_DIR, f) });
            break;
          }
        }
      }
    });
  }
  return { classes, crons };
}

function resolveTarget(key, { classes, crons }) {
  const byName = crons.find((c) => c.name === key);
  const spec = ALIASES[key] ?? (byName ? `${byName.class}.${byName.method}` : key);
  const m = spec.match(/^(\w+)\.(\w+)$/);
  if (!m) throw new Error(`không hiểu job "${key}" — dùng bí danh trong --list hoặc Class.method`);
  const src = classes.get(m[1]);
  if (!src) throw new Error(`không thấy class ${m[1]} trong apps/api/src`);
  const dist = path.join(DIST, path.relative(SRC, src)).replace(/\.ts$/, '.js');
  if (!fs.existsSync(dist)) throw new Error(`thiếu ${dist} — build lại apps/api (dist cũ hơn src?)`);
  return { cls: m[1], method: m[2], dist };
}

const reviveDates = (v) =>
  Array.isArray(v) ? v.map(reviveDates) : v && typeof v === 'object' ? ('$date' in v ? new Date(v.$date) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reviveDates(x)]))) : v;

const argv = process.argv.slice(2);
const index = scan();
if (argv[0] === '--list' || argv.length === 0) {
  const rev = Object.fromEntries(Object.entries(ALIASES).map(([a, t]) => [t, a]));
  const rows = index.crons.map((c) => ({ alias: c.name ?? rev[`${c.class}.${c.method}`] ?? '', target: `${c.class}.${c.method}`, cron: c.schedule, file: c.file }));
  for (const [a, t] of Object.entries(ALIASES)) if (!rows.some((r) => r.target === t)) rows.push({ alias: a, target: t, cron: '(không @Cron)', file: '' });
  console.table(rows);
  process.exit(argv.length === 0 ? 2 : 0);
}
const L = lane(argv[0]);
const target = resolveTarget(argv[1], index);
const ai = argv.indexOf('--args');
const callArgs = ai >= 0 ? reviveDates(JSON.parse(argv[ai + 1])) : [];

Object.assign(process.env, laneEnv(L), { DATABASE_URL: L.databaseUrl, REDIS_URL: `redis://127.0.0.1:26379/${L.redisDb}` });
process.chdir(API_DIR);
const req = createRequire(path.join(API_DIR, 'package.json'));
const { NestFactory } = req('@nestjs/core');
const { AppModule } = req(path.join(DIST, 'app.module.js'));
const mod = req(target.dist);
const t0 = Date.now();
// stdout chỉ chứa JSON kết quả (script khác parse được): log Nest và console.log của mã app chuyển sang stderr.
console.log = (...a) => console.error(...a);
const toErr = (lvl) => (msg, ...rest) => console.error(`[nest ${lvl}]`, ...(rest.length ? [`[${rest[rest.length - 1]}]`] : []), msg);
const logger = { log: toErr('log'), error: toErr('error'), warn: toErr('warn'), debug: () => undefined, verbose: () => undefined, fatal: toErr('fatal') };
const app = await NestFactory.createApplicationContext(AppModule, { logger });
let code = 0;
try {
  const inst = app.get(mod[target.cls], { strict: false });
  console.error(`[run-job] lane ${L.n} (${L.db}): ${target.cls}.${target.method}(${callArgs.map((a) => JSON.stringify(a)).join(', ')})`);
  const result = await inst[target.method](...callArgs);
  jsonOut({ lane: L.n, job: `${target.cls}.${target.method}`, ms: Date.now() - t0, result: result ?? null });
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  code = 1;
} finally {
  await app.close();
}
process.exit(code);
