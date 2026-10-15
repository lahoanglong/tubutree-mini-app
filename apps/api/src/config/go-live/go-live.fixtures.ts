import type { BackupSnapshot } from './backup-checks';
import type { DbSnapshot } from './db-checks';
import type { RedisSnapshot } from './redis-checks';
import type { CheckResult, Env } from './types';

/** Mọi giá trị bí mật dưới đây là chuỗi giả; test dùng chúng để chắc chắn báo cáo không bao giờ in ra. */
export const SECRET_ENV_KEYS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'ZALO_APP_SECRET',
  'ZALO_OA_ACCESS_TOKEN',
  'ZALO_OA_REFRESH_TOKEN',
  'ZALO_OA_WEBHOOK_SECRET',
  'PANCAKE_API_KEY',
  'PANCAKE_WEBHOOK_SECRET',
  'GOMDON_PASSWORD',
  'GOMDON_WEBHOOK_SECRET',
  'ZALOPAY_KEY1',
  'ZALOPAY_KEY2',
  'ACCESSTRADE_TOKEN',
  'ACCESSTRADE_WEBHOOK_SECRET',
  'OPS_ALERT_WEBHOOK_URL',
  'SMTP_PASS',
] as const;

export const GOOD_ENV: Env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://tubu:db-pass-zz91@postgres:5432/tubutree?connection_limit=20&pool_timeout=30',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'k9Zq-access-Vb3nT7xW2mLpR8sYd4HfGc6JaQe1UoNi',
  JWT_REFRESH_SECRET: 'h5Ty-refresh-Pw0cZ8nKd3VbXr7MsLq2EgJf9AuOi4Nm',
  CORS_ORIGINS: 'https://app.tubutree.com,https://tubutree.com',
  AUTH_COOKIE_SAMESITE: 'lax',
  AUTH_COOKIE_DOMAIN: '.tubutree.com',
  THROTTLE_BYPASS_TOKEN: 'tb-Mn4Bv7Cx1Zl9Kj2Hg5Fd8Sa3Pq6Wr0Ey',
  ZALO_APP_ID: '2070857098114207963',
  ZALO_APP_SECRET: 'zalo-app-secret-Qm8Xv2Lp9Rt4Nb7',
  ZALO_OA_ID: '1234567890123456789',
  ZALO_OA_ACCESS_TOKEN: 'oa-access-Hd6Fk3Jw9Sz2Bn5Vc8Xm1Lq4',
  ZALO_OA_REFRESH_TOKEN: 'oa-refresh-Tg7Yu4Ie1Op8Ra5Dn2Cx9Mk6',
  ZALO_OA_WEBHOOK_SECRET: 'oa-hook-Ws3Ed6Rf9Tg2Yh5Uj8Ik1Ol4Pz7',
  PANCAKE_BASE_URL: 'https://pos.pages.fm/api/v1',
  PANCAKE_API_KEY: 'pancake-api-Zx9Cv6Bn3Mq0Wk7Je4Rt1Yu8',
  PANCAKE_SHOP_ID: '1234567',
  PANCAKE_WEBHOOK_SECRET: 'pancake-hook-Lk5Jh2Gf9Dd6Ss3Aa0Pq7We4',
  GOMDON_PHONE: '0901234567',
  GOMDON_PASSWORD: 'gomdon-pass-Nb4Vc7Xz1Lk8Jh5Gf2Dd9Ss6',
  GOMDON_WEBHOOK_SECRET: 'gomdon-hook-Qa8Ws5Ed2Rf9Tg6Yh3Uj0Ik7Ol4',
  ZALOPAY_APP_ID: '2554',
  ZALOPAY_KEY1: 'zalopay-key1-Mn6Bv3Cx0Zl7Kj4Hg1Fd8Sa5Pq2',
  ZALOPAY_KEY2: 'zalopay-key2-Wr9Et6Yu3Io0Pa7Sd4Fg1Hj8Kl5',
  ZALOPAY_ENDPOINT: 'https://openapi.zalopay.vn/v2',
  ACCESSTRADE_TOKEN: 'accesstrade-tok-Cv7Bn4Mx1Zl8Kj5Hg2Fd9Sa6',
  ACCESSTRADE_PUBLISHER_ID: '998877',
  ACCESSTRADE_WEBHOOK_SECRET: 'accesstrade-hook-Ty2Ui9Op6As3Df0Gh7Jk4Lz1',
  VITE_CLOUDINARY_CLOUD_NAME: 'tubutree',
  VITE_CLOUDINARY_UPLOAD_PRESET: 'tubutree_unsigned',
  OPS_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/xoxb-secret-path-Aq1Sw2De3Fr4',
  OPS_ALERT_EMAIL_TO: 'ops@tubutree.com; owner@tubutree.com',
  SMTP_HOST: 'smtp.example-mail.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'alerts@tubutree.com',
  SMTP_PASS: 'smtp-pass-Gt5Hy6Ju7Ki8Lo9Mp0Nq1',
  SMTP_FROM: 'Tubu Tree <alerts@tubutree.com>',
  OPS_ALERT_ENV_LABEL: 'production',
};

export const REQUIRED = [
  '20261014213300_r6_admin_orders_recipient_search',
  '20261015070000_r8_refill_locations_table',
  '20261015150000_r8_multi_reviews_unique_per_order',
] as const;

const MIGRATIONS = ['20260101000000_init', '20260901000000_something_older', ...REQUIRED];

export const GOOD_DB: DbSnapshot = {
  appliedMigrations: [...MIGRATIONS],
  unfinishedMigrations: [],
  expectedMigrations: [...MIGRATIONS],
  orderCount: 1200,
  refill: { totalRows: 2, activeRows: 2 },
  configs: {
    'ops.alert_unsynced_minutes': 30,
    'ops.alert_stuck_orders': 1,
    'ops.alert_webhook_failed': 1,
    'ops.alert_queue_failed_1h': 5,
    'ops.alert_repeat_hours': 6,
    'ops.alert_gomdon_backlog_minutes': 15,
    'shipping.free_threshold': 200000,
    'shipping.flat_fee_below_threshold': 19000,
    'shipping.gomdon.recycling_enabled': true,
    'shipping.gomdon.config': {
      defaultWarehouse: { name: 'Kho Tubu', phone: '0965573541', address: '1 Đường A', ward: 'Phường B', district: 'Quận C', province: 'Thành phố D' },
      defaultWeightFallback: 500,
    },
    'merchant.commission_pct': 0.15,
    'merchant.default_shipping_fee': 30000,
    'merchant.settlement_hold_days': 7,
    'merchant.consignment_settle_from': '2026-10-20T00:00:00Z',
    'payment.bank_bin': '970407',
    'payment.bank_account_no': '0123456789012',
    'payment.bank_account_name': 'CONG TY TUBU TREE',
  },
  adminCount: 1,
  pendingAdminGrants: 0,
  znsTemplates: [
    { code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: '123456' },
    { code: 'ORDER_SHIPPING', channel: 'ZNS', zaloTemplateId: '234567' },
    { code: 'WELCOME', channel: 'INAPP', zaloTemplateId: null },
  ],
  codMaxPerOrder: 5_000_000,
};

export const GOOD_REDIS: RedisSnapshot = {
  reachable: true,
  dbIndex: 0,
  maxmemoryPolicy: 'noeviction',
  maxmemoryBytes: 150 * 1024 * 1024,
  appendonly: 'yes',
  queues: ['pancake-push', 'pancake-events', 'gomdon-push', 'gomdon-events', 'notifications', 'zalo-oa-events'].map((name) => ({
    name,
    ok: true,
    counts: { waiting: 0, active: 0, delayed: 0, failed: 0 },
  })),
};

export const GOOD_BACKUP: BackupSnapshot = {
  script: 'found',
  cron: { visible: true, hasBackupLine: true, remoteName: 'r2', hasHealthcheck: true },
  rclone: { available: true, remotes: ['r2'] },
  dir: { path: '/var/backups/tubutree', visible: true, fileCount: 12, newest: { ageHours: 7, sizeBytes: 5 * 1024 * 1024 } },
};

export function byId(results: readonly CheckResult[], id: string): CheckResult {
  const found = results.find((r) => r.id === id);
  if (!found) throw new Error(`không có dòng ${id}; có: ${results.map((r) => r.id).join(', ')}`);
  return found;
}

/** GOOD_ENV với một số khoá bị đổi; giá trị undefined nghĩa là bỏ khoá. */
export function envWith(patch: Record<string, string | undefined>): Env {
  const env: Record<string, string | undefined> = { ...GOOD_ENV, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete env[k];
  return env;
}

export function dbWith(patch: Partial<Omit<DbSnapshot, 'configs'>> & { configs?: Record<string, unknown>; dropConfigs?: string[] }): DbSnapshot {
  const configs: Record<string, unknown> = { ...GOOD_DB.configs, ...(patch.configs ?? {}) };
  for (const k of patch.dropConfigs ?? []) delete configs[k];
  const { configs: _c, dropConfigs: _d, ...rest } = patch;
  return { ...GOOD_DB, ...rest, configs };
}
