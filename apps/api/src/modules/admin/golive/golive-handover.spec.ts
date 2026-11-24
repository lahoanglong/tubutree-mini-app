import { evaluateBackup, type BackupSnapshot } from '../../../config/go-live/backup-checks';
import { evaluateDb } from '../../../config/go-live/db-checks';
import { evaluateEnv } from '../../../config/go-live/env-checks';
import { GOOD_BACKUP, GOOD_ENV, SECRET_ENV_KEYS, dbWith, envWith } from '../../../config/go-live/go-live.fixtures';
import { fail, warn, type CheckResult } from '../../../config/go-live/types';
import { HANDOVER_ITEMS, HANDOVER_LATER_TITLE, HANDOVER_TITLE, buildHandover } from './golive-handover';

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

const REQUIRED = ['zalo_oa', 'zalo_oa_webhook', 'zalo_open_api', 'phone_hmac', 'ops_alerts', 'demo_coupons'];
const stateOf = (items: { key: string; state: string }[]) => Object.fromEntries(items.map((i) => [i.key, i.state]));

describe('golive-handover: thẻ "Cấu hình bên thứ 3 chờ bàn giao Go-Live"', () => {
  it('gom đúng 15 dòng WARN của PROD, mỗi dòng vào đúng một việc', () => {
    const ids = HANDOVER_ITEMS.flatMap((d) => [...d.checkIds, ...(d.infoCheckIds ?? [])]);
    expect([...ids].sort()).toEqual(PROD_WARN_15);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mọi mã dòng là mã thật của go-live:check: bộ kiểm đủ khoá ra 6/6 việc bắt buộc, mọi việc kể cả kiểm tay, tuỳ chọn và mở sau đều Đã cấu hình', () => {
    const results = goodResults();
    for (const id of HANDOVER_ITEMS.flatMap((d) => [...d.checkIds, ...(d.infoCheckIds ?? [])])) expect([id, results.some((r) => r.id === id)]).toEqual([id, true]);
    const board = buildHandover(results, GOOD_ENV);
    expect(board.title).toBe(HANDOVER_TITLE);
    expect([board.configured, board.total]).toEqual([6, 6]);
    expect(board.items.filter((i) => i.required).map((i) => i.key)).toEqual(REQUIRED);
    expect(board.items.filter((i) => !(i.state === 'configured' && i.configured && i.status === 'PASS' && i.vars.every((v) => v.configured))).map((i) => i.key)).toEqual([]);
  });

  it('PROD hôm nay: 1/6 (mã demo đã chốt giữ), Cloudinary và backup Kiểm tay, mẫu ZNS Tuỳ chọn, ZaloPay và Accesstrade Mở sau, còn lại Chờ điền; đúng 15 dòng WARN', () => {
    const board = buildHandover(prodResults(), PROD_ENV);
    expect([board.configured, board.total]).toEqual([1, 6]);
    expect(stateOf(board.items)).toEqual({
      zalo_oa: 'pending',
      zalo_oa_webhook: 'pending',
      zalo_open_api: 'pending',
      zalopay: 'later',
      accesstrade: 'later',
      phone_hmac: 'pending',
      ops_alerts: 'pending',
      cloudinary: 'host',
      backup_offsite: 'host',
      demo_coupons: 'configured',
      zns_templates: 'optional',
    });
    expect(board.items.flatMap((i) => i.checks.map((c) => `${c.id}:${c.status}`)).sort()).toEqual(PROD_WARN_15.map((id) => `${id}:WARN`));
    expect(board.items.flatMap((i) => i.vars).filter((v) => v.configured)).toEqual([]);
    const zalopay = board.items.find((i) => i.key === 'zalopay')!;
    expect(zalopay.vars).toEqual([
      { name: 'ZALOPAY_APP_ID', configured: false, optional: false },
      { name: 'ZALOPAY_KEY1', configured: false, optional: false },
      { name: 'ZALOPAY_KEY2', configured: false, optional: false },
    ]);
    expect(zalopay.owner).toBe('Chủ shop (hợp đồng ZaloPay)');
  });

  it('đặt dở dang (chỉ ZALOPAY_APP_ID): Chờ điền, tô đỏ, vẫn ở nhóm Mở sau và ngoài bộ đếm, biến nói đúng cái nào đã điền', () => {
    const env = envWith({ ZALOPAY_KEY1: undefined, ZALOPAY_KEY2: undefined });
    const board = buildHandover(evaluateEnv(env), env);
    const item = board.items.find((i) => i.key === 'zalopay')!;
    expect([item.state, item.configured, item.status, item.required, item.group]).toEqual(['pending', false, 'FAIL', false, 'later']);
    expect(board.total).toBe(6);
    expect(item.vars.map((v) => [v.name, v.configured])).toEqual([
      ['ZALOPAY_APP_ID', true],
      ['ZALOPAY_KEY1', false],
      ['ZALOPAY_KEY2', false],
    ]);
  });

  it('việc kiểm tay mà dòng kiểm ra đỏ (Cloudinary chỉ đặt một biến) thì về Chờ điền, không nấp sau Kiểm tay', () => {
    const env = envWith({ VITE_CLOUDINARY_UPLOAD_PRESET: undefined });
    const item = buildHandover(evaluateEnv(env), env).items.find((i) => i.key === 'cloudinary')!;
    expect([item.state, item.status, item.required]).toEqual(['pending', 'FAIL', false]);
  });

  it('biến chỉ có khoảng trắng tính là chưa điền', () => {
    const env = envWith({ PHONE_HMAC_SECRET: '   ' });
    const item = buildHandover(evaluateEnv(env), env).items.find((i) => i.key === 'phone_hmac')!;
    expect(item.vars).toEqual([{ name: 'PHONE_HMAC_SECRET', configured: false, optional: false }]);
    expect(item.configured).toBe(false);
  });

  it('bộ kiểm không ra dòng nào cho backup (đọc backup lỗi): Kiểm tay, vàng, không có dòng kiểm, không bao giờ Đã cấu hình', () => {
    const results = goodResults().filter((r) => !r.id.startsWith('backup.'));
    const item = buildHandover(results, GOOD_ENV).items.find((i) => i.key === 'backup_offsite')!;
    expect(item).toMatchObject({ state: 'host', configured: false, status: 'WARN', checks: [] });
  });

  it('việc bắt buộc không ra dòng nào: Chờ điền', () => {
    const results = goodResults().filter((r) => r.id !== 'env.zalo.oa');
    const item = buildHandover(results, GOOD_ENV).items.find((i) => i.key === 'zalo_oa')!;
    expect(item).toMatchObject({ state: 'pending', configured: false, checks: [] });
  });

  it('webhook có, thiếu nhãn môi trường: Đã cấu hình (nhãn tuỳ chọn, PROD để trống), dòng nhãn vẫn hiện để xem', () => {
    const env = envWith({ OPS_ALERT_ENV_LABEL: undefined });
    const item = buildHandover(evaluateEnv(env), env).items.find((i) => i.key === 'ops_alerts')!;
    expect(item.checks.map((c) => `${c.id}:${c.status}`)).toEqual(['env.ops.webhook:PASS', 'env.ops.label:WARN']);
    expect([item.state, item.status]).toEqual(['configured', 'PASS']);
    expect(item.vars).toEqual([
      { name: 'OPS_ALERT_WEBHOOK_URL', configured: true, optional: false },
      { name: 'OPS_ALERT_ENV_LABEL', configured: false, optional: true },
    ]);
  });

  it('mã demo: chủ dự án duyệt giữ (vàng) là đã chốt; còn mã chưa duyệt (đỏ) là Chờ điền', () => {
    const others = goodResults().filter((r) => r.id !== 'db.demo_coupons');
    const kept = buildHandover([...others, warn('DB', 'db.demo_coupons', 'Mã giảm giá demo', 'còn dùng được: đã chấp nhận giữ: WELCOME30', 'Xác nhận.')], GOOD_ENV);
    expect(kept.items.find((i) => i.key === 'demo_coupons')!.state).toBe('configured');
    expect([kept.configured, kept.total]).toEqual([6, 6]);
    const open = buildHandover([...others, fail('DB', 'db.demo_coupons', 'Mã giảm giá demo', 'còn dùng được, chủ dự án chưa duyệt: WELCOME30', 'Dọn.')], GOOD_ENV);
    expect(open.items.find((i) => i.key === 'demo_coupons')).toMatchObject({ state: 'pending', status: 'FAIL' });
    expect([open.configured, open.total]).toEqual([5, 6]);
  });

  it('mẫu ZNS chưa có mã: Tuỳ chọn, không vào bộ đếm; mã sai dạng (đỏ) thì Chờ điền', () => {
    const others = goodResults().filter((r) => r.id !== 'db.zns_templates');
    const unset = buildHandover([...others, warn('DB', 'db.zns_templates', 'Mẫu ZNS', '2/2 mẫu chưa có mã Zalo', 'Nhập mã.')], GOOD_ENV);
    expect(unset.items.find((i) => i.key === 'zns_templates')).toMatchObject({ state: 'optional', required: false });
    expect([unset.configured, unset.total]).toEqual([6, 6]);
    const bad = buildHandover([...others, fail('DB', 'db.zns_templates', 'Mẫu ZNS', 'mã mẫu sai dạng', 'Nhập lại.')], GOOD_ENV);
    expect(bad.items.find((i) => i.key === 'zns_templates')!.state).toBe('pending');
  });

  it('ZaloPay và Accesstrade (PO A2.2): nhóm "Tuỳ chọn (Mở sau)" cuối danh sách, không vào bộ đếm; điền đủ thì Đã cấu hình mà vẫn ở nhóm Mở sau', () => {
    const prod = buildHandover(prodResults(), PROD_ENV);
    expect(prod.laterTitle).toBe(HANDOVER_LATER_TITLE);
    expect(HANDOVER_LATER_TITLE).toBe('Tuỳ chọn (Mở sau)');
    expect(prod.items.filter((i) => i.group === 'later').map((i) => [i.key, i.state, i.required])).toEqual([
      ['zalopay', 'later', false],
      ['accesstrade', 'later', false],
    ]);
    expect(prod.items.slice(-2).map((i) => i.key)).toEqual(['zalopay', 'accesstrade']);
    expect(prod.items.filter((i) => i.group === 'launch').every((i) => i.state !== 'later')).toBe(true);
    const done = buildHandover(goodResults(), GOOD_ENV);
    expect(done.items.filter((i) => i.group === 'later').map((i) => [i.key, i.state])).toEqual([
      ['zalopay', 'configured'],
      ['accesstrade', 'configured'],
    ]);
    const onlyLaterMissing = envWith({ ZALOPAY_APP_ID: undefined, ZALOPAY_KEY1: undefined, ZALOPAY_KEY2: undefined, ACCESSTRADE_TOKEN: undefined, ACCESSTRADE_PUBLISHER_ID: undefined });
    const results = [...evaluateEnv(onlyLaterMissing), ...goodResults().filter((r) => !r.id.startsWith('env.'))];
    const board = buildHandover(results, onlyLaterMissing);
    expect([board.configured, board.total]).toEqual([6, 6]);
    expect(stateOf(board.items.filter((i) => i.group === 'later'))).toEqual({ zalopay: 'later', accesstrade: 'later' });
  });

  it('không trả giá trị bí mật nào: chỉ tên biến và true/false', () => {
    const json = JSON.stringify(buildHandover(goodResults(), GOOD_ENV));
    const values = SECRET_ENV_KEYS.map((k) => GOOD_ENV[k]).filter((v): v is string => typeof v === 'string');
    expect(values.length).toBeGreaterThanOrEqual(15);
    for (const v of values) expect([v, json.includes(v)]).toEqual([v, false]);
    for (const name of ['ZALOPAY_KEY1', 'ZALO_OA_ACCESS_TOKEN', 'PHONE_HMAC_SECRET']) expect(json).toContain(`"name":"${name}","configured":true`);
  });
});
