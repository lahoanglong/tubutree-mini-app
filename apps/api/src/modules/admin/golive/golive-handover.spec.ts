import { evaluateBackup, type BackupSnapshot } from '../../../config/go-live/backup-checks';
import { evaluateDb } from '../../../config/go-live/db-checks';
import { evaluateEnv } from '../../../config/go-live/env-checks';
import { GOOD_BACKUP, GOOD_ENV, SECRET_ENV_KEYS, dbWith, envWith } from '../../../config/go-live/go-live.fixtures';
import { warn, type CheckResult } from '../../../config/go-live/types';
import { HANDOVER_ITEMS, HANDOVER_TITLE, buildHandover } from './golive-handover';

/** 15 dòng WARN của go-live trên PROD sau w24-04 (dep3 05:30 ngày 24/11/2026). */
const PROD_WARN_15 = [
  'backup.cron',
  'backup.healthcheck',
  'backup.offsite',
  'backup.script',
  'db.demo_coupons',
  'db.zns_templates',
  'env.accesstrade.api',
  'env.cloudinary',
  'env.ops.label',
  'env.ops.webhook',
  'env.phone_hmac',
  'env.zalo.oa',
  'env.zalo.oa_webhook_secret',
  'env.zalo.open_api_key',
  'env.zalopay',
];

const PROD_ENV = envWith({
  PHONE_HMAC_SECRET: undefined,
  ZALO_OA_ID: undefined,
  ZALO_OA_ACCESS_TOKEN: undefined,
  ZALO_OA_REFRESH_TOKEN: undefined,
  ZALO_OA_WEBHOOK_SECRET: undefined,
  ZALO_OA_SECRET_KEY: undefined,
  ZALO_OPEN_API_KEY: undefined,
  ZALOPAY_APP_ID: undefined,
  ZALOPAY_KEY1: undefined,
  ZALOPAY_KEY2: undefined,
  ACCESSTRADE_TOKEN: undefined,
  ACCESSTRADE_PUBLISHER_ID: undefined,
  VITE_CLOUDINARY_CLOUD_NAME: undefined,
  VITE_CLOUDINARY_UPLOAD_PRESET: undefined,
  OPS_ALERT_WEBHOOK_URL: undefined,
  OPS_ALERT_ENV_LABEL: undefined,
});
/** API chạy trong container: không thấy tools/, không đọc được crontab, không có rclone. */
const CONTAINER_BACKUP: BackupSnapshot = {
  ...GOOD_BACKUP,
  script: 'unknown',
  cron: { visible: false, hasBackupLine: false, remoteName: null, hasHealthcheck: false },
  rclone: { available: false, remotes: [] },
};
const PROD_DB_ROWS: CheckResult[] = [
  warn('DB', 'db.zns_templates', 'Mẫu ZNS đã có mã Zalo duyệt', '2/2 mẫu chưa có mã Zalo, nên chỉ gửi trong app: ORDER_CONFIRMED, ORDER_SHIPPING', 'Nhập mã.'),
  warn('DB', 'db.demo_coupons', 'Mã giảm giá demo', 'còn dùng được: đã chấp nhận giữ: WELCOME30 (hạn 2026-12-31)', 'Chốt.'),
];
const prodResults = () => [...evaluateEnv(PROD_ENV), ...evaluateBackup(CONTAINER_BACKUP, PROD_ENV), ...PROD_DB_ROWS];

const GOOD_DB_ALL_ZNS = dbWith({
  znsTemplates: [
    { code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: '111' },
    { code: 'ORDER_SHIPPING', channel: 'ZNS', zaloTemplateId: '222' },
  ],
  demoData: { products: { found: 0, active: 0 }, activeVariations: 0, liveCoupons: [] },
});
const goodResults = () => [
  ...evaluateEnv(GOOD_ENV),
  ...evaluateDb(GOOD_DB_ALL_ZNS, { phase: 'post-deploy', env: GOOD_ENV }),
  ...evaluateBackup(GOOD_BACKUP, GOOD_ENV),
];

describe('golive-handover: thẻ "Cấu hình bên thứ 3 chờ bàn giao Go-Live"', () => {
  it('gom đúng 15 dòng WARN của PROD, mỗi dòng vào đúng một việc', () => {
    const ids = HANDOVER_ITEMS.flatMap((d) => d.checkIds);
    expect([...ids].sort()).toEqual(PROD_WARN_15);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mọi mã dòng là mã thật của go-live:check: bộ kiểm đủ khoá ra đủ 11/11 "Đã cấu hình"', () => {
    const results = goodResults();
    for (const id of HANDOVER_ITEMS.flatMap((d) => d.checkIds)) expect([id, results.some((r) => r.id === id)]).toEqual([id, true]);
    const board = buildHandover(results, GOOD_ENV);
    expect(board.title).toBe(HANDOVER_TITLE);
    expect([board.configured, board.total]).toEqual([11, 11]);
    expect(board.items.filter((i) => !(i.configured && i.status === 'PASS' && i.vars.every((v) => v.configured))).map((i) => i.key)).toEqual([]);
  });

  it('PROD hôm nay: 0/11, mọi biến bắt buộc báo chưa điền, các dòng kiểm đúng 15 dòng WARN', () => {
    const board = buildHandover(prodResults(), PROD_ENV);
    expect([board.configured, board.total]).toEqual([0, 11]);
    expect(board.items.flatMap((i) => i.checks.map((c) => `${c.id}:${c.status}`)).sort()).toEqual(PROD_WARN_15.map((id) => `${id}:WARN`));
    expect(board.items.flatMap((i) => i.vars).filter((v) => v.configured)).toEqual([]);
    const zalopay = board.items.find((i) => i.key === 'zalopay')!;
    expect(zalopay.vars.map((v) => v.name)).toEqual(['ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2']);
    expect(zalopay.owner).toBe('Chủ shop (hợp đồng ZaloPay)');
  });

  it('đặt dở dang (chỉ ZALOPAY_APP_ID): Chờ điền, tô đỏ, biến nói đúng cái nào đã điền', () => {
    const env = envWith({ ZALOPAY_KEY1: undefined, ZALOPAY_KEY2: undefined });
    const item = buildHandover(evaluateEnv(env), env).items.find((i) => i.key === 'zalopay')!;
    expect([item.configured, item.status]).toEqual([false, 'FAIL']);
    expect(item.vars).toEqual([
      { name: 'ZALOPAY_APP_ID', configured: true },
      { name: 'ZALOPAY_KEY1', configured: false },
      { name: 'ZALOPAY_KEY2', configured: false },
    ]);
  });

  it('biến chỉ có khoảng trắng tính là chưa điền', () => {
    const env = envWith({ PHONE_HMAC_SECRET: '   ' });
    const item = buildHandover(evaluateEnv(env), env).items.find((i) => i.key === 'phone_hmac')!;
    expect(item.vars).toEqual([{ name: 'PHONE_HMAC_SECRET', configured: false }]);
    expect(item.configured).toBe(false);
  });

  it('bộ kiểm không ra dòng nào cho một việc (vd đọc backup lỗi): Chờ điền, vàng, không có dòng kiểm', () => {
    const results = goodResults().filter((r) => !r.id.startsWith('backup.'));
    const item = buildHandover(results, GOOD_ENV).items.find((i) => i.key === 'backup_offsite')!;
    expect(item).toMatchObject({ configured: false, status: 'WARN', checks: [] });
  });

  it('một dòng đạt, một dòng chưa (webhook có, thiếu nhãn môi trường): việc vẫn Chờ điền', () => {
    const env = envWith({ OPS_ALERT_ENV_LABEL: undefined });
    const item = buildHandover(evaluateEnv(env), env).items.find((i) => i.key === 'ops_alerts')!;
    expect(item.checks.map((c) => `${c.id}:${c.status}`)).toEqual(['env.ops.webhook:PASS', 'env.ops.label:WARN']);
    expect(item.configured).toBe(false);
    expect(item.vars).toEqual([
      { name: 'OPS_ALERT_WEBHOOK_URL', configured: true },
      { name: 'OPS_ALERT_ENV_LABEL', configured: false },
    ]);
  });

  it('không trả giá trị bí mật nào: chỉ tên biến và true/false', () => {
    const json = JSON.stringify(buildHandover(goodResults(), GOOD_ENV));
    const values = SECRET_ENV_KEYS.map((k) => GOOD_ENV[k]).filter((v): v is string => typeof v === 'string');
    expect(values.length).toBeGreaterThanOrEqual(15);
    for (const v of values) expect([v, json.includes(v)]).toEqual([v, false]);
    for (const name of ['ZALOPAY_KEY1', 'ZALO_OA_ACCESS_TOKEN', 'PHONE_HMAC_SECRET']) expect(json).toContain(`"name":"${name}","configured":true`);
  });
});
