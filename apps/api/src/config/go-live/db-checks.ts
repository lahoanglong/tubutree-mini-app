import { parseConsignmentSettleFrom } from '../../modules/merchant/merchant-config';
import { OPS_THRESHOLD_KEYS, type OpsThresholds } from '../../modules/ops/ops-alerts';
import { evaluateDemoData, type DemoDataSnapshot } from './demo-data-checks';
import { envValue } from './secrets';
import { fail, pass, warn, type CheckResult, type Env, type GoLivePhase } from './types';

const G_DB = 'Cơ sở dữ liệu';

/** Ba migration của đợt này: khoá orders, bảng điểm nhận vỏ, đánh giá theo từng lần mua. */
export const REQUIRED_MIGRATIONS = [
  '20261014213300_r6_admin_orders_recipient_search',
  '20261015070000_r8_refill_locations_table',
  '20261015150000_r8_multi_reviews_unique_per_order',
] as const;
const ORDERS_LOCK_MIGRATION = REQUIRED_MIGRATIONS[0];

/**
 * Ba migration của đợt cộng hai migration nhỏ thêm sau đó (hai cột NULL trên variations, một cột trên bảng trả hàng cũ). Image cũ
 * vẫn chạy được trên schema có đủ năm cái, nên quay lại bằng image (runbook 7.2) hợp lệ khi danh sách chờ áp chỉ gồm năm cái này.
 */
export const IMAGE_COMPATIBLE_MIGRATIONS: readonly string[] = [
  ...REQUIRED_MIGRATIONS,
  '20261015160000_r9_sync_stock_same_clock_markers',
  '20261015170000_r10_legacy_returns_received',
];

/**
 * Migration nặng đã biết trong danh sách chờ áp khi PROD còn ở bản cũ hơn (không chỉ các migration của đợt). `ordersLock`: viết
 * lại bảng orders hoặc dựng chỉ mục trên đó. Chưa đo riêng từng cái: ước theo migration r6.
 */
export const HEAVY_MIGRATIONS: ReadonlyArray<{ name: string; ordersLock: boolean }> = [
  { name: '20261012110000_pd3_xu_to_points', ordersLock: false },
  { name: '20261012130000_pd3_freeze_coins', ordersLock: false },
  { name: '20261014003644_p1_pancake_outbound_sync_state', ordersLock: true },
  { name: '20261014003831_p8_seller_merchant_fulfilment', ordersLock: true },
  { name: '20261014150000_p4_admin_ops_search', ordersLock: true },
  { name: ORDERS_LOCK_MIGRATION, ordersLock: true },
];

export const ORDERS_LOCK_SECONDS_PER_300K = 14;
const ORDERS_LOCK_SMALL = 50_000;
const ORDERS_LOCK_MIN_SECONDS = 2;
const ORDERS_WINDOW_FACTOR = 5;
const ORDERS_WINDOW_MIN_SECONDS = 120;

/** ~2 giây dưới 50 nghìn đơn, ~14 giây cho mỗi 300 nghìn đơn (đo ở UAT, chỉ cho migration r6); nhân theo số migration nặng trên orders. */
export function estimateOrdersLockSeconds(orderCount: number, heavyCount = 1): number {
  const one = orderCount < ORDERS_LOCK_SMALL ? ORDERS_LOCK_MIN_SECONDS : Math.ceil((orderCount * ORDERS_LOCK_SECONDS_PER_300K) / 300_000);
  return one * Math.max(1, heavyCount);
}

/** Cửa sổ bảo trì nên xin: gấp 5 lần ước tính, tối thiểu 2 phút (còn phải dừng api, backup, khởi động lại). */
export function recommendedWindowSeconds(orderCount: number, heavyCount = 1): number {
  return Math.max(ORDERS_WINDOW_MIN_SECONDS, estimateOrdersLockSeconds(orderCount, heavyCount) * ORDERS_WINDOW_FACTOR);
}

export interface ZnsTemplateRow {
  code: string;
  channel: string;
  zaloTemplateId: string | null;
}

/** Ảnh chụp chỉ-đọc của DB; collector điền, các hàm dưới đây chỉ phân tích. */
export interface DbSnapshot {
  /** Tên migration đã áp xong (finished_at có giá trị, chưa rolled_back). */
  appliedMigrations: string[];
  /** Migration bắt đầu mà chưa xong, chưa rolled_back: hỏng giữa chừng. */
  unfinishedMigrations: string[];
  /** Tên migration trong thư mục prisma/migrations của image đang chạy. */
  expectedMigrations: string[];
  orderCount: number;
  /** `tableExists`: bảng refill_pickup_locations (migration 20261015070000) đã có chưa; chưa có thì hai số đếm là 0 vì bảng vắng, không vì rỗng. */
  refill: { totalRows: number; activeRows: number; tableExists: boolean };
  /** Giá trị các khoá SystemConfig cần xem; khoá không có trong DB thì không xuất hiện. */
  configs: Record<string, unknown>;
  adminCount: number;
  pendingAdminGrants: number;
  znsTemplates: ZnsTemplateRow[];
  /** COD_MAX_PER_ORDER trong code (checkout-split.ts). */
  codMaxPerOrder: number;
  demoData?: DemoDataSnapshot;
}

export const CONFIG_KEYS_OF_INTEREST = [
  'refill.pickup_address',
  'shipping.free_threshold',
  'shipping.flat_fee_below_threshold',
  'shipping.gomdon.config',
  'shipping.gomdon.recycling_enabled',
  'merchant.commission_pct',
  'merchant.default_shipping_fee',
  'merchant.settlement_hold_days',
  'merchant.consignment_settle_from',
  'payment.bank_bin',
  'payment.bank_account_no',
  'payment.bank_account_name',
  ...Object.values(OPS_THRESHOLD_KEYS).map((t) => t.key),
] as const;

export const COD_CAP_VND = 5_000_000;
const SEED_BANK_ACCOUNT = '9984606774';

export interface DbContext {
  phase: GoLivePhase;
  env: Env;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

function listNames(names: string[], max = 4): string {
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} và ${names.length - max} cái nữa`;
}

function migrationChecks(s: DbSnapshot, phase: GoLivePhase): CheckResult[] {
  const out: CheckResult[] = [];
  const applied = new Set(s.appliedMigrations);
  const expected = new Set(s.expectedMigrations);

  out.push(
    s.unfinishedMigrations.length === 0
      ? pass(G_DB, 'db.migrations_failed', 'Migration chạy dở', 'không có')
      : fail(
          G_DB,
          'db.migrations_failed',
          'Migration chạy dở',
          `đang dở: ${listNames(s.unfinishedMigrations)}`,
          'Dừng, không deploy tiếp. Xem mục "Migration lỗi giữa chừng" trong docs/launch/deploy-rollback-runbook.md (prisma migrate resolve --rolled-back, hoặc restore bản backup).',
        ),
  );

  const pending = s.expectedMigrations.filter((m) => !applied.has(m));
  if (pending.length === 0) {
    out.push(pass(G_DB, 'db.migrations_pending', 'Migration đã áp đủ', `${expected.size} trên ${expected.size}`));
  } else if (phase === 'pre-deploy') {
    out.push(warn(G_DB, 'db.migrations_pending', 'Migration đã áp đủ', `${pending.length} cái sẽ được áp khi deploy: ${listNames(pending)}`, 'Bình thường trước khi deploy; chạy lại với --phase=post-deploy sau khi deploy xong.'));
  } else {
    out.push(
      fail(G_DB, 'db.migrations_pending', 'Migration đã áp đủ', `thiếu ${pending.length}: ${listNames(pending)}`, 'Chạy `pnpm exec prisma migrate deploy` bằng image mới (xem runbook), rồi chạy lại kiểm tra.'),
    );
  }

  if (phase === 'pre-deploy' && pending.length > 0) {
    const extra = pending.filter((m) => !IMAGE_COMPATIBLE_MIGRATIONS.includes(m));
    const heavy = HEAVY_MIGRATIONS.filter((h) => pending.includes(h.name)).map((h) => h.name);
    const scopeTitle = 'Phạm vi migration sẽ áp';
    out.push(
      extra.length === 0
        ? pass(G_DB, 'db.pending_scope', scopeTitle, `chỉ các migration của đợt (${pending.length}): quay lại bằng image cũ (runbook 7.2) hợp lệ`)
        : warn(
            G_DB,
            'db.pending_scope',
            scopeTitle,
            `${pending.length} migration chờ áp, ${extra.length} cái nằm ngoài các migration của đợt${heavy.length > 0 ? `; nặng: ${listNames(heavy, 6)}` : ''}`,
            'Xin cửa sổ theo TOÀN BỘ danh sách chờ áp, không chỉ các migration của đợt (runbook mục 1.0 và 3). Quay lại chỉ bằng image cũ KHÔNG an toàn khi danh sách có migration ngoài năm cái của đợt: chỉ còn khôi phục bản backup (runbook 7.3).',
          ),
    );
  }

  const ahead = s.appliedMigrations.filter((m) => !expected.has(m));
  out.push(
    ahead.length === 0
      ? pass(G_DB, 'db.migrations_ahead', 'DB không đi trước mã', 'mọi migration trong DB đều có trong image')
      : warn(
          G_DB,
          'db.migrations_ahead',
          'DB không đi trước mã',
          `DB có ${ahead.length} migration mà image này không có: ${listNames(ahead)}`,
          'Image đang chạy cũ hơn DB (vd quay lại image cũ sau khi migrate). Chỉ an toàn khi đã kiểm theo mục Rollback của runbook.',
        ),
  );

  const notInImage = REQUIRED_MIGRATIONS.filter((m) => !expected.has(m));
  const notApplied = REQUIRED_MIGRATIONS.filter((m) => !applied.has(m));
  const reqTitle = 'Ba migration của đợt này';
  if (notInImage.length > 0) {
    out.push(fail(G_DB, 'db.required_migrations', reqTitle, `image không chứa: ${listNames([...notInImage])}`, 'Image chưa build từ mã mới nhất; build lại từ nhánh đã chốt.'));
  } else if (notApplied.length === 0) {
    out.push(pass(G_DB, 'db.required_migrations', reqTitle, 'recipient_search, refill_locations, multi_reviews đều đã áp'));
  } else if (phase === 'pre-deploy') {
    out.push(warn(G_DB, 'db.required_migrations', reqTitle, `chưa áp: ${listNames([...notApplied])}`, 'Bình thường trước khi deploy.'));
  } else {
    out.push(fail(G_DB, 'db.required_migrations', reqTitle, `chưa áp: ${listNames([...notApplied])}`, 'Áp migration theo runbook rồi chạy lại.'));
  }
  return out;
}

function ordersLockCheck(s: DbSnapshot): CheckResult {
  const title = 'Số đơn và thời gian khoá bảng orders';
  const applied = new Set(s.appliedMigrations);
  if (applied.has(ORDERS_LOCK_MIGRATION)) {
    return pass(G_DB, 'db.orders_lock', title, `${s.orderCount.toLocaleString('vi-VN')} đơn; migration khoá bảng đã áp xong, không còn rủi ro này`);
  }
  const expected = new Set(s.expectedMigrations);
  const heavy = HEAVY_MIGRATIONS.filter((h) => h.ordersLock && expected.has(h.name) && !applied.has(h.name)).map((h) => h.name);
  const seconds = estimateOrdersLockSeconds(s.orderCount, heavy.length);
  const window = Math.ceil(recommendedWindowSeconds(s.orderCount, heavy.length) / 60);
  const many = heavy.length > 1 ? ` (${heavy.length} migration nặng trên orders chờ áp, mỗi cái tính ngang migration r6: ${listNames(heavy, 6)})` : '';
  const detail = `${s.orderCount.toLocaleString('vi-VN')} đơn, ước tính khoá orders ~${seconds} giây${many}, cửa sổ nên xin ≥ ${window} phút`;
  if (s.orderCount < ORDERS_LOCK_SMALL) return pass(G_DB, 'db.orders_lock', title, detail);
  return warn(G_DB, 'db.orders_lock', title, detail, 'Đặt hàng và webhook bị chặn suốt lúc khoá: chọn giờ vắng nhất, báo trước, xin cửa sổ theo số trên (runbook mục 3).');
}

function refillCheck(s: DbSnapshot, phase: GoLivePhase): CheckResult {
  const title = 'Điểm nhận vỏ chai (Refill)';
  const legacy = typeof s.configs['refill.pickup_address'] === 'string' ? (s.configs['refill.pickup_address'] as string).trim() : '';
  if (phase === 'pre-deploy' && !s.refill.tableExists) {
    return warn(
      G_DB,
      'db.refill_location',
      title,
      legacy ? 'bảng điểm nhận vỏ chưa có (migration 20261015070000 chưa áp); địa chỉ cũ refill.pickup_address sẽ thành điểm đầu tiên' : 'bảng điểm nhận vỏ chưa có (migration 20261015070000 chưa áp) và chưa có địa chỉ cũ refill.pickup_address',
      'Bình thường trước khi deploy. Sau deploy (--phase=post-deploy) phải có ít nhất một điểm đang bật ở Quản trị, Đổi vỏ chai, Điểm nhận vỏ.',
    );
  }
  if (s.refill.activeRows > 0) return pass(G_DB, 'db.refill_location', title, `${s.refill.activeRows} điểm đang bật trên ${s.refill.totalRows}`);
  if (s.refill.totalRows === 0 && legacy) {
    return warn(G_DB, 'db.refill_location', title, 'chỉ có địa chỉ cũ refill.pickup_address, chưa có điểm nào trong bảng', 'Thêm điểm ở Quản trị, Đổi vỏ chai, Điểm nhận vỏ; địa chỉ cũ chỉ là dự phòng.');
  }
  if (s.refill.totalRows > 0) {
    return fail(G_DB, 'db.refill_location', title, `có ${s.refill.totalRows} điểm nhưng không điểm nào đang bật, địa chỉ cũ bị bỏ qua`, 'Bật ít nhất một điểm ở Quản trị, Đổi vỏ chai, Điểm nhận vỏ; khách không có chỗ để mang vỏ tới.');
  }
  return fail(G_DB, 'db.refill_location', title, 'chưa có điểm nhận vỏ nào, cũng không có địa chỉ cũ', 'Thêm ít nhất một điểm đang bật ở Quản trị, Đổi vỏ chai, Điểm nhận vỏ.');
}

const SANE: Record<keyof OpsThresholds, [number, number]> = {
  unsyncedMinutes: [5, 240],
  stuckOrders: [1, 50],
  webhookFailed: [1, 50],
  queueFailed1h: [1, 100],
  repeatHours: [1, 48],
  gomdonBacklogMinutes: [5, 240],
};

function opsThresholdCheck(s: DbSnapshot): CheckResult {
  const title = 'Ngưỡng báo động ops.*';
  const problems: string[] = [];
  for (const k of Object.keys(OPS_THRESHOLD_KEYS) as (keyof OpsThresholds)[]) {
    const { key, fallback } = OPS_THRESHOLD_KEYS[k];
    const [lo, hi] = SANE[k];
    if (!(key in s.configs)) {
      problems.push(`${key} chưa có (dùng mặc định ${fallback})`);
      continue;
    }
    const v = s.configs[key];
    if (!isNum(v) || v <= 0) {
      problems.push(`${key} không phải số dương (sẽ dùng mặc định ${fallback})`);
    } else if (v < lo || v > hi) {
      problems.push(`${key}=${v} ngoài khoảng gợi ý ${lo} đến ${hi}`);
    }
  }
  return problems.length === 0
    ? pass(G_DB, 'db.ops_thresholds', title, 'cả 6 ngưỡng là số dương trong khoảng gợi ý')
    : warn(G_DB, 'db.ops_thresholds', title, problems.join('; '), 'Chỉnh ở Quản trị, Cấu hình, nhóm ops. Báo động vẫn chạy với mặc định, nhưng ngưỡng quá lỏng thì đơn kẹt lâu mới được báo.');
}

function shippingRateCheck(s: DbSnapshot): CheckResult {
  const title = 'Phí vận chuyển Tubu giao';
  const keys = ['shipping.free_threshold', 'shipping.flat_fee_below_threshold'] as const;
  const bad = keys.filter((k) => k in s.configs && (!isNum(s.configs[k]) || (s.configs[k] as number) < 0));
  if (bad.length > 0) return fail(G_DB, 'db.shipping_rates', title, `${bad.join(', ')} không phải số không âm`, 'Sửa ở Quản trị, Cấu hình, nhóm shipping; sai là khách bị tính phí sai.');
  const missing = keys.filter((k) => !(k in s.configs));
  if (missing.length > 0) return warn(G_DB, 'db.shipping_rates', title, `chưa có ${missing.join(', ')} (mã dùng mặc định)`, 'Ghi rõ ở Quản trị, Cấu hình, nhóm shipping để con số hiển thị cho khách là con số bạn quyết định.');
  return pass(G_DB, 'db.shipping_rates', title, `freeship từ ${vnd(s.configs[keys[0]] as number)}, phí ${vnd(s.configs[keys[1]] as number)} khi dưới ngưỡng`);
}

function commissionCheck(s: DbSnapshot): CheckResult {
  const title = 'Phí sàn và phí ship đối tác';
  const pct = s.configs['merchant.commission_pct'];
  const fee = s.configs['merchant.default_shipping_fee'];
  if ('merchant.commission_pct' in s.configs && (!isNum(pct) || pct < 0 || pct >= 1)) {
    return fail(G_DB, 'db.merchant_terms', title, 'merchant.commission_pct phải là phân số từ 0 đến dưới 1 (ví dụ 0.15), không phải 15', 'Sửa ở Quản trị, Cấu hình, nhóm merchant; sai là đối soát đối tác sai tiền.');
  }
  if ('merchant.default_shipping_fee' in s.configs && (!isNum(fee) || fee < 0)) {
    return fail(G_DB, 'db.merchant_terms', title, 'merchant.default_shipping_fee không phải số không âm', 'Sửa ở Quản trị, Cấu hình, nhóm merchant.');
  }
  if (!('merchant.commission_pct' in s.configs)) {
    return warn(G_DB, 'db.merchant_terms', title, 'chưa có merchant.commission_pct (mã dùng mặc định 15%)', 'Ghi rõ mức phí sàn bạn đã thoả thuận với đối tác ở Quản trị, Cấu hình.');
  }
  if (pct === 0) {
    return warn(G_DB, 'db.merchant_terms', title, 'phí sàn 0%: Tubu không thu phí trên đơn đối tác tự giao', 'Đúng ý thì bỏ qua; nếu không, đặt lại merchant.commission_pct.');
  }
  return pass(G_DB, 'db.merchant_terms', title, `phí sàn ${((pct as number) * 100).toFixed(2).replace(/\.?0+$/, '')}%, phí ship đối tác ${isNum(fee) ? vnd(fee) : 'mặc định'}`);
}

function holdCheck(s: DbSnapshot): CheckResult {
  const title = 'Số ngày giữ tiền trước khi đối soát';
  const key = 'merchant.settlement_hold_days';
  if (!(key in s.configs)) return pass(G_DB, 'db.settlement_hold', title, 'chưa ghi, mã dùng mặc định 7 ngày');
  const v = s.configs[key];
  if (!isNum(v) || v < 0 || !Number.isInteger(v)) return fail(G_DB, 'db.settlement_hold', title, `${key} không phải số ngày nguyên không âm`, 'Sửa ở Quản trị, Cấu hình, nhóm merchant.');
  if (v !== 7) return warn(G_DB, 'db.settlement_hold', title, `đang là ${v} ngày, quyết định của chủ shop là 7 ngày`, 'Đúng ý thì bỏ qua; nếu không, đặt lại 7 (trùng hạn đổi/trả).');
  return pass(G_DB, 'db.settlement_hold', title, '7 ngày');
}

function consignmentFromCheck(s: DbSnapshot): CheckResult {
  const title = 'Mốc bắt đầu đối soát hàng "Tubu giao hộ"';
  const key = 'merchant.consignment_settle_from';
  const hint = 'Đặt mốc ISO 8601 (ví dụ 2026-10-20T00:00:00Z) ở Quản trị, Cấu hình; thiếu mốc thì đơn đặt trước go-live cũng tự vào bảng kê dù đã thanh toán theo thoả thuận cũ.';
  if (!(key in s.configs)) return warn(G_DB, 'db.consignment_from', title, 'chưa có mốc: mọi đơn giao hộ (kể cả cũ) vào bảng kê', hint);
  const at = parseConsignmentSettleFrom(s.configs[key]);
  if (!at) return warn(G_DB, 'db.consignment_from', title, 'giá trị không phải thời điểm ISO 8601 có thật: bị bỏ qua, không giới hạn theo mốc', hint);
  return pass(G_DB, 'db.consignment_from', title, `từ ${at.toISOString()}`);
}

function bankCheck(s: DbSnapshot): CheckResult {
  const title = 'Tài khoản nhận chuyển khoản (VietQR)';
  const bin = s.configs['payment.bank_bin'];
  const no = s.configs['payment.bank_account_no'];
  const name = s.configs['payment.bank_account_name'];
  const binOk = typeof bin === 'string' && /^\d{6}$/.test(bin.trim());
  const noOk = typeof no === 'string' && /^\d{6,20}$/.test(no.trim());
  const nameOk = typeof name === 'string' && name.trim().length > 0;
  if (!binOk || !noOk || !nameOk) {
    const lack = [!binOk && 'payment.bank_bin (6 chữ số)', !noOk && 'payment.bank_account_no (số)', !nameOk && 'payment.bank_account_name'].filter(Boolean);
    return fail(G_DB, 'db.bank_account', title, `thiếu hoặc sai: ${lack.join(', ')}`, 'Điền ở Quản trị, Cấu hình, nhóm payment; thiếu thì trang chuyển khoản báo lỗi và khách không trả được.');
  }
  const last4 = (no as string).trim().slice(-4);
  if ((no as string).trim() === SEED_BANK_ACCOUNT) {
    return warn(G_DB, 'db.bank_account', title, `số tài khoản (đuôi ${last4}) vẫn là giá trị mặc định trong seed`, 'Xác nhận đó đúng là tài khoản thật của Tubu Tree, và Pancake POS đã liên kết tài khoản này để tự đối soát.');
  }
  return pass(G_DB, 'db.bank_account', title, `BIN ${(bin as string).trim()}, số tài khoản đuôi ${last4}`);
}

function codCapCheck(s: DbSnapshot): CheckResult {
  const title = 'Trần COD mỗi đơn con';
  if (s.codMaxPerOrder !== COD_CAP_VND) {
    return fail(G_DB, 'db.cod_cap', title, `mã đang là ${vnd(s.codMaxPerOrder)}, quyết định là ${vnd(COD_CAP_VND)}`, 'Sửa COD_MAX_PER_ORDER trong checkout-split.ts rồi build lại; không chỉnh được qua cấu hình.');
  }
  return pass(G_DB, 'db.cod_cap', title, `cố định ${vnd(COD_CAP_VND)} mỗi đơn con (hằng số trong mã, không chỉnh qua cấu hình)`);
}

function gomdonToggleChecks(s: DbSnapshot, env: Env): CheckResult[] {
  const out: CheckResult[] = [];
  const toggle = s.configs['shipping.gomdon.recycling_enabled'];
  const hasCreds = Boolean(envValue(env, 'GOMDON_PHONE') && envValue(env, 'GOMDON_PASSWORD'));
  const title = 'Công tắc thu gom tái chế (Gomdon)';
  const on = toggle === true;
  if (typeof toggle === 'string' || typeof toggle === 'number') {
    out.push(warn(G_DB, 'db.gomdon_toggle', title, 'giá trị không phải true/false thật, nên tính năng đang TẮT', 'Đặt lại đúng kiểu boolean (true) ở Quản trị, Cấu hình, shipping.gomdon.recycling_enabled.'));
  } else if (on && hasCreds) {
    out.push(pass(G_DB, 'db.gomdon_toggle', title, 'bật, đã có tài khoản Gomdon'));
  } else if (on && !hasCreds) {
    out.push(warn(G_DB, 'db.gomdon_toggle', title, 'công tắc bật nhưng chưa có tài khoản Gomdon, nên checkout vẫn ẩn lựa chọn thu gom', 'Đặt GOMDON_PHONE, GOMDON_PASSWORD, GOMDON_WEBHOOK_SECRET trong .env rồi khởi động lại api.'));
  } else if (!on && hasCreds) {
    out.push(warn(G_DB, 'db.gomdon_toggle', title, 'đã có tài khoản Gomdon nhưng công tắc đang tắt: khách không thấy lựa chọn thu gom', 'Bật shipping.gomdon.recycling_enabled ở Quản trị, Cấu hình khi sẵn sàng chạy đơn thu gom thử.'));
  } else {
    out.push(pass(G_DB, 'db.gomdon_toggle', title, 'tắt và chưa có tài khoản: nhất quán khi chưa mở thu gom'));
  }

  if (on || hasCreds) {
    const cfg = s.configs['shipping.gomdon.config'];
    const wh = (cfg && typeof cfg === 'object' ? (cfg as { defaultWarehouse?: Record<string, unknown> }).defaultWarehouse : undefined) ?? {};
    const lack = ['name', 'phone', 'address', 'ward', 'district', 'province'].filter((k) => !(typeof wh[k] === 'string' && (wh[k] as string).trim()));
    const whTitle = 'Kho lấy hàng gửi Gomdon';
    if (cfg === undefined) {
      out.push(warn(G_DB, 'db.gomdon_warehouse', whTitle, 'chưa có shipping.gomdon.config, mã dùng kho mặc định "Fuwa3e Tubu HCM"', 'Xác nhận đúng kho thật và ghi rõ ở Quản trị, Cấu hình, shipping.gomdon.config.'));
    } else if (lack.length > 0) {
      out.push(fail(G_DB, 'db.gomdon_warehouse', whTitle, `thiếu ${lack.join(', ')} trong defaultWarehouse`, 'Điền đủ tên, SĐT, địa chỉ, phường, quận, tỉnh; thiếu là Gomdon từ chối tạo vận đơn.'));
    } else if (wh.ward === 'Phường Long Bình' && wh.district === 'Thành phố Thủ Đức') {
      out.push(warn(G_DB, 'db.gomdon_warehouse', whTitle, 'kho vẫn là giá trị mặc định trong seed, địa giới phường/quận theo cách gọi cũ (UAT GOMDON-7)', 'Hỏi Gomdon xem địa chỉ này có được nhận không; sửa ở Quản trị, Cấu hình, shipping.gomdon.config nếu cần.'));
    } else {
      out.push(pass(G_DB, 'db.gomdon_warehouse', whTitle, 'defaultWarehouse đủ 6 trường'));
    }
  }
  return out;
}

function adminCheck(s: DbSnapshot): CheckResult {
  const title = 'Có tài khoản quản trị';
  if (s.adminCount > 0) return pass(G_DB, 'db.admin_user', title, `${s.adminCount} tài khoản ADMIN`);
  if (s.pendingAdminGrants > 0) {
    return warn(G_DB, 'db.admin_user', title, `chưa có ADMIN nào, nhưng có ${s.pendingAdminGrants} quyền cấp theo SĐT chờ người đó đăng nhập`, 'Người được cấp phải đăng nhập một lần để quyền có hiệu lực; kiểm lại ngay sau đó.');
  }
  return fail(G_DB, 'db.admin_user', title, 'không có tài khoản ADMIN nào', 'Cấp admin đầu tiên: `docker compose -f docker-compose.vietnix.yml run --rm --no-deps -e ADMIN_PHONE=<SĐT> api node scripts/grant-admin.js` (hoặc ops.yml, hành động grant-admin).');
}

function znsCheck(s: DbSnapshot): CheckResult {
  const title = 'Mẫu ZNS đã có mã Zalo duyệt';
  const zns = s.znsTemplates.filter((t) => t.channel === 'ZNS');
  if (zns.length === 0) return warn(G_DB, 'db.zns_templates', title, 'không có mẫu thông báo nào ở kênh ZNS', 'Mẫu thông báo do seed tạo; kiểm Quản trị, Mẫu thông báo có dữ liệu chưa.');
  const missing = zns.filter((t) => !t.zaloTemplateId || !t.zaloTemplateId.trim()).map((t) => t.code);
  const invalid = zns.filter((t) => t.zaloTemplateId && t.zaloTemplateId.trim() && !/^\d{1,20}$/.test(t.zaloTemplateId.trim())).map((t) => t.code);
  if (invalid.length > 0) {
    return fail(G_DB, 'db.zns_templates', title, `mã mẫu sai dạng (phải là số): ${listNames(invalid)}`, 'Nhập lại mã số Zalo cấp ở Quản trị, Mẫu thông báo.');
  }
  if (missing.length > 0) {
    return warn(
      G_DB,
      'db.zns_templates',
      title,
      `${missing.length}/${zns.length} mẫu chưa có mã Zalo, nên chỉ gửi trong app: ${listNames(missing)}`,
      'Đăng ký mẫu trong Zalo OA (ZNS, Tạo mẫu thông báo), chờ Zalo duyệt, rồi nhập mã số vào Quản trị, Mẫu thông báo. Chưa được duyệt thì khách không nhận tin Zalo.',
    );
  }
  return pass(G_DB, 'db.zns_templates', title, `${zns.length} mẫu ZNS đều có mã số`);
}

/** Phân tích ảnh chụp DB thành các dòng kiểm tra. Hàm thuần: không chạm DB. */
export function evaluateDb(s: DbSnapshot, ctx: DbContext): CheckResult[] {
  return [
    ...migrationChecks(s, ctx.phase),
    ordersLockCheck(s),
    refillCheck(s, ctx.phase),
    opsThresholdCheck(s),
    shippingRateCheck(s),
    commissionCheck(s),
    holdCheck(s),
    consignmentFromCheck(s),
    bankCheck(s),
    codCapCheck(s),
    ...gomdonToggleChecks(s, ctx.env),
    adminCheck(s),
    znsCheck(s),
    ...evaluateDemoData(s.demoData, ctx.env),
  ];
}
