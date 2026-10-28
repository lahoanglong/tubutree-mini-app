import { parseConsignmentSettleFrom } from '../../modules/merchant/merchant-config';
import { WASTE_CONFIG_KEYS } from '../../modules/waste-exchange/waste-config.keys';
import { OPS_THRESHOLD_KEYS, type OpsThresholds } from '../../modules/ops/ops-alerts';
import { toShippingEta } from '../../modules/system-config/shipping-eta';
import { evaluateDemoData, type DemoDataSnapshot } from './demo-data-checks';
import { sameProvince } from '@tubutree/shared-types';
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
 * Ba migration của đợt, hai migration nhỏ thêm sau đó (hai cột NULL trên variations, một cột trên bảng trả hàng cũ) và migration
 * waste_exchange chỉ thêm bảng và cột mới mà image cũ không đọc. Image cũ vẫn chạy được trên schema có đủ sáu cái, nên quay lại
 * bằng image (runbook 7.2) hợp lệ khi danh sách chờ áp chỉ gồm sáu cái này.
 */
export const IMAGE_COMPATIBLE_MIGRATIONS: readonly string[] = [
  ...REQUIRED_MIGRATIONS,
  '20261015160000_r9_sync_stock_same_clock_markers',
  '20261015170000_r10_legacy_returns_received',
  '20261020000000_waste_exchange',
];

/**
 * Migration nặng đã biết trong danh sách chờ áp khi PROD còn ở bản cũ hơn (không chỉ các migration của đợt). `ordersLock`: viết
 * lại bảng orders hoặc dựng chỉ mục (không CONCURRENTLY) trên đó. Các cái còn lại giữ khoá trên users hoặc points_transactions
 * (UPDATE cả bảng, ràng buộc, chỉ mục duy nhất một phần). Chưa đo riêng từng cái: ước theo migration r6. Spec quét mọi migration sau
 * bản PROD (UPDATE, chỉ mục, ràng buộc, LOCK TABLE, SQL động) để danh sách này không thiếu cái mới và cái nào đụng orders thì có ordersLock.
 */
export const HEAVY_MIGRATIONS: ReadonlyArray<{ name: string; ordersLock: boolean }> = [
  { name: '20261010170000_orders_invoice_open_index', ordersLock: true },
  { name: '20261012100000_pd3_points_lot_schema', ordersLock: false },
  { name: '20261012110000_pd3_xu_to_points', ordersLock: false },
  { name: '20261012130000_pd3_freeze_coins', ordersLock: false },
  { name: '20261013172522_p2_pancake_inbound_attention', ordersLock: true },
  { name: '20261013173621_p3_gomdon_order_note_cleanup', ordersLock: true },
  { name: '20261014003644_p1_pancake_outbound_sync_state', ordersLock: true },
  { name: '20261014003831_p8_seller_merchant_fulfilment', ordersLock: true },
  { name: '20261014090000_p5_refunds_returns_queue', ordersLock: false },
  { name: '20261014150000_p4_admin_ops_search', ordersLock: true },
  { name: ORDERS_LOCK_MIGRATION, ordersLock: true },
  { name: '20261016210000_r11_delivered_effects_marker', ordersLock: true },
  { name: '20261018000100_n1_indexes', ordersLock: false },
  { name: '20261018140000_lr_reports_source_indexes', ordersLock: true },
  { name: '20261018170100_lr_orders_filter_indexes', ordersLock: true },
  { name: '20261018210000_points_1d', ordersLock: true },
  { name: '20261019100000_external_orders', ordersLock: false },
  { name: '20261019170000_chat_review1', ordersLock: false },
  { name: '20261020000000_waste_exchange', ordersLock: false },
  { name: '20261020100000_review_return_reversal', ordersLock: false },
  { name: '20261020120000_q19_reversal_effects_marker', ordersLock: true },
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
  /** `tableExists`: bảng waste_points (migration 20261020000000_waste_exchange) đã có chưa; chưa có thì hai số đếm là 0. */
  /** `activePointsWithoutHours`: điểm ACTIVE chưa có khung giờ mở cửa nào; vắng nghĩa là chưa đo. `activeWarehouseProvinceCodes`: mã tỉnh của các kho ACTIVE; vắng nghĩa là chưa đo. */
  waste: { tableExists: boolean; totalPoints: number; activeWarehouses: number; activeWarehousesWithPhone: number; activePointsWithoutHours?: number; activeWarehouseProvinceCodes?: string[] };
  /** Giá trị các khoá SystemConfig cần xem; khoá không có trong DB thì không xuất hiện. */
  configs: Record<string, unknown>;
  /** pointMultiplier của từng hạng trong membership_tiers; bảng chưa có hoặc trống thì []. */
  membershipTiers: number[];
  dealerTierCount: number;
  adminCount: number;
  pendingAdminGrants: number;
  znsTemplates: ZnsTemplateRow[];
  /** COD_MAX_PER_ORDER trong code (checkout-split.ts). */
  codMaxPerOrder: number;
  demoData?: DemoDataSnapshot;
  /** Phần collector không đọc được vì schema DB cũ hơn mã (P2021/P2022): mã lỗi theo từng phần. Vắng nghĩa là đọc đủ. */
  degraded?: Partial<Record<'configs' | 'waste' | 'membershipTiers' | 'dealerTiers' | 'admin' | 'zns' | 'demoData', string>>;
}

export const CONFIG_KEYS_OF_INTEREST = [
  'shipping.free_threshold',
  'shipping.flat_fee_below_threshold',
  'shipping.eta_min_days',
  'shipping.eta_max_days',
  'shipping.gomdon.config',
  'shipping.gomdon.recycling_enabled',
  'waste.enabled',
  'waste.lane_mailin_enabled',
  'waste.lane_pickup_enabled',
  'waste.rules_text',
  'waste.mailin_fee_table',
  'waste.mailin_min_points',
  'waste.pickup_min_points',
  'waste.customer_monthly_cap_points',
  'merchant.commission_pct',
  'merchant.default_shipping_fee',
  'merchant.settlement_hold_days',
  'merchant.consignment_settle_from',
  'payment.bank_bin',
  'payment.bank_account_no',
  'payment.bank_account_name',
  'company.legal_name',
  'company.tax_code',
  'company.address',
  'legal.dieu-khoan',
  'legal.bao-mat',
  'legal.doi-tra',
  'legal.van-chuyen',
  'app.miniapp_base_url',
  ...Object.values(OPS_THRESHOLD_KEYS).map((t) => t.key),
] as const;

export const COD_CAP_VND = 5_000_000;
// Số mẫu cũ trong migration 20260625070000: chỉ số này mới bị coi là chưa xác nhận; tài khoản thật đã chốt thì PASS.
const PLACEHOLDER_BANK_ACCOUNT = '9984606774';

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
            `${pending.length} migration chờ áp, ${extra.length} cái nằm ngoài các migration của đợt${heavy.length > 0 ? `; nặng: ${listNames(heavy, HEAVY_MIGRATIONS.length)}` : ''}`,
            'Xin cửa sổ theo TOÀN BỘ danh sách chờ áp, không chỉ các migration của đợt (runbook mục 1.0 và 3). Quay lại chỉ bằng image cũ KHÔNG an toàn khi danh sách có migration ngoài sáu cái của đợt: chỉ còn khôi phục bản backup (runbook 7.3).',
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
    out.push(pass(G_DB, 'db.required_migrations', reqTitle, 'cả ba migration bắt buộc (r6 recipient_search, r8 bảng điểm nhận cũ, r8 multi_reviews) đều đã áp'));
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
  const expected = new Set(s.expectedMigrations);
  const heavy = HEAVY_MIGRATIONS.filter((h) => h.ordersLock && expected.has(h.name) && !applied.has(h.name)).map((h) => h.name);
  if (applied.has(ORDERS_LOCK_MIGRATION) && heavy.length === 0) {
    return pass(G_DB, 'db.orders_lock', title, `${s.orderCount.toLocaleString('vi-VN')} đơn; migration khoá bảng đã áp xong, không còn rủi ro này`);
  }
  const seconds = estimateOrdersLockSeconds(s.orderCount, heavy.length);
  const window = Math.ceil(recommendedWindowSeconds(s.orderCount, heavy.length) / 60);
  const named = heavy.length > 1 || (heavy.length === 1 && heavy[0] !== ORDERS_LOCK_MIGRATION);
  const many = named ? ` (${heavy.length} migration nặng trên orders chờ áp, mỗi cái tính ngang migration r6: ${listNames(heavy, HEAVY_MIGRATIONS.length)})` : '';
  const detail = `${s.orderCount.toLocaleString('vi-VN')} đơn, ước tính khoá orders ~${seconds} giây${many}, cửa sổ nên xin ≥ ${window} phút`;
  if (s.orderCount < ORDERS_LOCK_SMALL) return pass(G_DB, 'db.orders_lock', title, detail);
  return warn(G_DB, 'db.orders_lock', title, detail, 'Đặt hàng và webhook bị chặn suốt lúc khoá: chọn giờ vắng nhất, báo trước, xin cửa sổ theo số trên (runbook mục 3).');
}

function wastePointCheck(s: DbSnapshot, env: Env): CheckResult {
  const id = 'db.waste_point';
  const title = 'Điểm đổi rác (kho và điểm nhận)';
  const enabled = s.configs['waste.enabled'] === true;
  if (enabled && s.waste.activeWarehouses === 0) {
    return fail(
      G_DB,
      id,
      title,
      'waste.enabled đang bật nhưng chưa có kho (WAREHOUSE) nào đang hoạt động',
      'Thêm một kho đang hoạt động ở Quản trị, Đổi rác và game, Đổi rác, Điểm nhận; nếu chưa kịp thì tắt waste.enabled ở Quản trị, Cấu hình, để khách không gửi được rác khi chưa có nơi nhận.',
    );
  }

  // Khoá vắng nghĩa là đường Gửi về kho đang bật (mặc định true, như waste-public-config.ts).
  const mailinOn = 'waste.lane_mailin_enabled' in s.configs ? s.configs['waste.lane_mailin_enabled'] === true : true;
  if (enabled && mailinOn && s.waste.activeWarehousesWithPhone === 0) {
    return fail(
      G_DB,
      id,
      title,
      'waste.enabled đang bật, đường Gửi về kho đang bật nhưng kho đang hoạt động chưa có số điện thoại (nhà vận chuyển cần số này để giao kiện)',
      'Vào Quản trị, Đổi rác và game, Đổi rác, Điểm nhận, mở kho và điền ô Số điện thoại bằng số thật của kho; hoặc tắt waste.lane_mailin_enabled ở Quản trị, Cấu hình.',
    );
  }

  const rules = s.configs['waste.rules_text'];
  if (enabled && (typeof rules !== 'string' || rules.trim() === '')) {
    return fail(
      G_DB,
      id,
      title,
      'waste.enabled đang bật nhưng thể lệ (waste.rules_text) còn trống: khách phải tick đồng ý với một thể lệ chưa có chữ',
      'Nhập thể lệ ở Quản trị, Cấu hình, nhóm waste; nếu chưa kịp thì tắt waste.enabled.',
    );
  }
  if (enabled && (s.waste.activePointsWithoutHours ?? 0) > 0) {
    return fail(
      G_DB,
      id,
      title,
      `waste.enabled đang bật nhưng ${s.waste.activePointsWithoutHours} điểm đang hoạt động chưa có giờ mở cửa: khách thấy "Chưa cập nhật giờ mở cửa"`,
      'Vào Quản trị, Đổi rác và game, Đổi rác, Điểm nhận, mở từng điểm và điền giờ mở cửa; hoặc tạm dừng điểm đó.',
    );
  }
  const feeZones = (s.configs['waste.mailin_fee_table'] as { zones?: unknown } | undefined)?.zones;
  if (enabled && mailinOn && !(Array.isArray(feeZones) && feeZones.length > 0)) {
    return fail(
      G_DB,
      id,
      title,
      'waste.enabled đang bật, đường Gửi về kho đang bật nhưng bảng vùng phí ship (waste.mailin_fee_table) chưa có vùng nào: mọi khách thấy khung "Toàn quốc"',
      'Điền vùng phí (ít nhất TP.HCM) ở Quản trị, Cấu hình, waste.mailin_fee_table; hoặc tắt waste.lane_mailin_enabled.',
    );
  }

  const whProvinces = s.waste.activeWarehouseProvinceCodes ?? [];
  if (enabled && mailinOn && whProvinces.length > 0 && Array.isArray(feeZones)) {
    const zoneCodes = (feeZones as { provinceCodes?: unknown }[]).flatMap((z) => (Array.isArray(z.provinceCodes) ? z.provinceCodes.filter((c): c is string => typeof c === 'string') : []));
    if (!whProvinces.some((w) => zoneCodes.some((c) => sameProvince(c, w)))) {
      return fail(
        G_DB,
        id,
        title,
        `waste.mailin_fee_table chưa có vùng nào chứa tỉnh của kho đang hoạt động (${whProvinces.join(', ')}): khách cùng tỉnh với kho vẫn thấy khung "Toàn quốc"`,
        'Thêm tỉnh của kho vào một vùng phí ở Quản trị, Cấu hình, waste.mailin_fee_table (mã "79" và "84_VN79" đều được hiểu là cùng một tỉnh).',
      );
    }
  }

  const warnings: string[] = [];
  const hints: string[] = [];
  const gomdonReady = s.configs['shipping.gomdon.recycling_enabled'] === true && Boolean(envValue(env, 'GOMDON_PHONE') && envValue(env, 'GOMDON_PASSWORD'));
  if (s.configs['waste.lane_pickup_enabled'] === true && !gomdonReady) {
    warnings.push('waste.lane_pickup_enabled bật nhưng Gomdon chưa sẵn sàng (công tắc shipping.gomdon.recycling_enabled hoặc GOMDON_PHONE/GOMDON_PASSWORD), nên đường Thu kèm đơn vẫn ẩn');
    hints.push('Chỉ bật waste.lane_pickup_enabled để chạy đơn thử trên bản chưa mở cho khách thật (cờ toàn cục, không có danh sách theo khách); để bật lâu dài khi Gomdon đã trả lời bằng văn bản và đơn thử chạy đạt (spec 12.4), nếu không thì tắt lại. Muốn đơn thử chạy được thì bật công tắc Gomdon và đặt tài khoản Gomdon.');
  }

  const numOr = (key: keyof typeof WASTE_CONFIG_KEYS): number => {
    const v = s.configs[key];
    return isNum(v) ? v : (WASTE_CONFIG_KEYS[key].default as number);
  };
  const cap = numOr('waste.customer_monthly_cap_points');
  const mailin = numOr('waste.mailin_min_points');
  const pickup = numOr('waste.pickup_min_points');
  let capWarned = false;
  if (mailin > cap) {
    warnings.push(`waste.mailin_min_points (${mailin}) lớn hơn waste.customer_monthly_cap_points (${cap}): đường Gửi về kho đóng với mọi khách`);
    capWarned = true;
  }
  if (pickup > cap) {
    warnings.push(`waste.pickup_min_points (${pickup}) lớn hơn waste.customer_monthly_cap_points (${cap}): đường Thu kèm đơn đóng với mọi khách`);
    capWarned = true;
  }
  if (capWarned) hints.push('Hạ ngưỡng tối thiểu hoặc nâng waste.customer_monthly_cap_points ở Quản trị, Cấu hình, nhóm waste.');

  if (warnings.length > 0) return warn(G_DB, id, title, warnings.join('; '), hints.join(' '));
  return pass(G_DB, id, title, enabled ? `${s.waste.activeWarehouses} kho đang hoạt động, ${s.waste.totalPoints} điểm trong bảng waste_points` : 'chương trình đang tắt (waste.enabled)');
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

function shippingEtaCheck(s: DbSnapshot): CheckResult {
  const title = 'Ngày giao dự kiến (Giao dự kiến ở màn thanh toán)';
  const [min, max] = [s.configs['shipping.eta_min_days'], s.configs['shipping.eta_max_days']];
  const eta = toShippingEta(min, max);
  if (eta) return pass(G_DB, 'db.shipping_eta', title, `${eta.minDays} đến ${eta.maxDays} ngày`);
  const unset = (v: unknown) => v === undefined || v === null;
  const detail =
    unset(min) && unset(max)
      ? 'shipping.eta_min_days và shipping.eta_max_days chưa đặt: khách không thấy dòng "Giao dự kiến"'
      : 'khoảng ngày thiếu hoặc không hợp lệ (cần hai số nguyên 0 đến 60, max không nhỏ hơn min): khách không thấy dòng "Giao dự kiến"';
  return warn(G_DB, 'db.shipping_eta', title, detail, 'Đặt shipping.eta_min_days và shipping.eta_max_days ở Quản trị, Cấu hình, nhóm shipping. Một khoảng chung cho cả nước, chưa theo tỉnh.');
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
  if ((no as string).trim() === PLACEHOLDER_BANK_ACCOUNT) {
    return warn(G_DB, 'db.bank_account', title, `số tài khoản (đuôi ${last4}) vẫn là số mẫu cũ`, 'Đổi sang tài khoản thật của Tubu Tree ở Quản trị, Cấu hình, nhóm payment, và liên kết tài khoản đó với Pancake POS để tự đối soát.');
  }
  return pass(G_DB, 'db.bank_account', title, `BIN ${(bin as string).trim()}, số tài khoản đuôi ${last4}`);
}

const LEGAL_DOCS = { 'legal.dieu-khoan': 'điều khoản', 'legal.bao-mat': 'bảo mật', 'legal.doi-tra': 'đổi trả', 'legal.van-chuyen': 'vận chuyển' } as const;

function legalPoliciesCheck(s: DbSnapshot, phase: GoLivePhase): CheckResult {
  const title = 'Chính sách hiển thị cho khách';
  const draft = (Object.keys(LEGAL_DOCS) as (keyof typeof LEGAL_DOCS)[]).filter((k) => typeof s.configs[k] !== 'string' || (s.configs[k] as string).trim() === '');
  if (draft.length > 0) {
    // Bản nháp mặc định của web hiện banner "chờ Tubu Tree duyệt"; trước deploy chưa có dòng nào là bình thường.
    const red = phase === 'pre-deploy' ? warn : fail;
    return red(G_DB, 'db.legal_policies', title, `còn bản nháp: ${draft.map((k) => LEGAL_DOCS[k]).join(', ')}`, 'Duyệt và lưu nội dung từng chính sách ở Quản trị, Cấu hình, nhóm legal; chưa lưu thì khách thấy dòng "BẢN NHÁP — chờ Tubu Tree duyệt".');
  }
  return pass(G_DB, 'db.legal_policies', title, 'cả 4 chính sách đã được lưu');
}

function companyIdentityCheck(s: DbSnapshot, phase: GoLivePhase): CheckResult {
  const title = 'Đơn vị vận hành hiển thị cho khách';
  const labels = { 'company.legal_name': 'tên công ty', 'company.tax_code': 'mã số thuế', 'company.address': 'địa chỉ trụ sở' } as const;
  const lack = (Object.keys(labels) as (keyof typeof labels)[]).filter((k) => typeof s.configs[k] !== 'string' || (s.configs[k] as string).trim() === '');
  if (lack.length > 0) {
    // Trước deploy, dòng company.* chưa có là bình thường: seed-reference chạy ở bước 7b.
    const red = phase === 'pre-deploy' ? warn : fail;
    return red(G_DB, 'db.company_identity', title, `chưa điền: ${lack.join(', ')}`, 'Điền ở Quản trị, Cấu hình, nhóm company; thiếu thì chân trang và trang chính sách không nói ai bán hàng (luật thương mại điện tử yêu cầu).');
  }
  return pass(G_DB, 'db.company_identity', title, `đã có ${Object.values(labels).join(', ')}`);
}

/** Host phải là zalo.me và đoạn ngay sau `/s/` phải đúng bằng ID (so chuỗi, không dựng regex từ env). */
function urlPointsToMiniApp(url: string, miniAppId: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== 'zalo.me') return false;
    const segs = u.pathname.split('/');
    const i = segs.indexOf('s');
    return i >= 0 && segs[i + 1] === miniAppId;
  } catch {
    return false;
  }
}

function miniappBaseUrlCheck(s: DbSnapshot, env: Env): CheckResult {
  const title = 'Link Mini App trong cấu hình khớp ZALO_MINIAPP_ID';
  const url = typeof s.configs['app.miniapp_base_url'] === 'string' ? (s.configs['app.miniapp_base_url'] as string).trim() : '';
  const miniAppId = envValue(env, 'ZALO_MINIAPP_ID');
  if (!url || !miniAppId) return pass(G_DB, 'db.miniapp_base_url', title, 'chưa có link hoặc chưa có ZALO_MINIAPP_ID nên không so');
  if (!/^[0-9]+$/.test(miniAppId)) {
    return pass(G_DB, 'db.miniapp_base_url', title, 'không so được: ZALO_MINIAPP_ID sai dạng, xem env.zalo.ids');
  }
  if (!urlPointsToMiniApp(url, miniAppId)) {
    return warn(
      G_DB,
      'db.miniapp_base_url',
      title,
      `app.miniapp_base_url (${url}) không chứa /s/${miniAppId} của ZALO_MINIAPP_ID`,
      'QR thẻ hộp hàng và link chia sẻ của CTV dựng từ app.miniapp_base_url; sai ID thì mở ra Mini App khác hoặc trang lỗi. Sửa ở Quản trị, Cấu hình, nhóm app (hoặc đổi ZALO_MINIAPP_ID nếu cấu hình mới đúng).',
    );
  }
  return pass(G_DB, 'db.miniapp_base_url', title, `link chứa /s/${miniAppId}`);
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
  const title = 'Công tắc Gomdon (Thu kèm đơn)';
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
  return fail(G_DB, 'db.admin_user', title, 'không có tài khoản ADMIN nào', 'Cấp admin đầu tiên: `docker compose -f docker-compose.vietnix.yml run --rm --no-deps -e ADMIN_PHONE=<SĐT> api node scripts/grant-admin.js` (SĐT 10 số dạng 0912345678 hoặc +84912345678, script tự chuẩn hoá; hoặc ops.yml, hành động grant-admin).');
}

/** Hệ số điểm đã chốt cho Mầm Xanh, Lộc Biếc, Đại Thụ, Cổ Thụ (A8). */
const REQUIRED_TIER_MULTIPLIERS = [1, 1.2, 1.5, 2] as const;
const viNum = (n: number) => String(n).replace('.', ',');

const SEED_FLAG_HINT = 'Chạy `pnpm run prisma:seed:reference --with-business-defaults` trong container api (chỉ tạo dòng thiếu, chạy lại an toàn; runbook bước 7b).';

function membershipTierCheck(s: DbSnapshot, phase: GoLivePhase): CheckResult {
  const title = 'Hạng thành viên và hệ số điểm';
  const have = new Set(s.membershipTiers.map((m) => Math.round(m * 100) / 100));
  const missing = REQUIRED_TIER_MULTIPLIERS.filter((m) => !have.has(m));
  if (s.membershipTiers.length === 0) {
    // Trước deploy, DB mới chưa có hạng là bình thường: seed-reference chạy ở bước deploy.
    const red = phase === 'pre-deploy' ? warn : fail;
    const detail = phase === 'pre-deploy' ? 'chưa có hạng nào (sẽ nạp ở bước 7b khi deploy)' : 'chưa có hạng nào: mọi khách hệ số x1, không có freeship theo hạng';
    return red(G_DB, 'db.membership_tiers', title, detail, SEED_FLAG_HINT);
  }
  if (missing.length > 0) {
    return fail(G_DB, 'db.membership_tiers', title, `thiếu hạng có hệ số ${missing.map(viNum).join(', ')} (đã chốt x1, x1,2, x1,5, x2); đang có ${s.membershipTiers.map(viNum).join(', ')}`, `Sửa ở Quản trị, Hạng thành viên, hoặc ${SEED_FLAG_HINT}`);
  }
  return pass(G_DB, 'db.membership_tiers', title, `${s.membershipTiers.length} hạng, hệ số ${[...s.membershipTiers].sort((a, b) => a - b).map(viNum).join(', ')}`);
}

function dealerTierCheck(s: DbSnapshot): CheckResult {
  const title = 'Bậc đại lý';
  if (s.dealerTierCount === 0) {
    return warn(G_DB, 'db.dealer_tiers', title, 'chưa có bậc đại lý nào: admin không duyệt được hồ sơ đại lý hay cấp vai trò DEALER', SEED_FLAG_HINT);
  }
  return pass(G_DB, 'db.dealer_tiers', title, `${s.dealerTierCount} bậc`);
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

/**
 * Dòng của phần DB không đọc được vì schema cũ: trước deploy VÀ còn migration chờ áp thì chỉ WARN (sẽ kiểm lại ở bước 10 sau migrate).
 * Sau deploy, hoặc hết migration chờ mà vẫn thiếu cột/bảng, là FAIL: schema phải đã khớp mã, nên đó là lệch schema hay lỗi mã.
 */
function degradeResults(results: CheckResult[], code: string, phase: GoLivePhase, pendingCount: number): CheckResult[] {
  if (phase === 'pre-deploy' && pendingCount > 0) {
    return results.map((r) =>
      warn(G_DB, r.id, r.title, `chưa kiểm được trước khi migrate (schema cũ: ${code}), sẽ kiểm lại ở bước 10 sau migrate`, 'Bình thường khi DB còn ở bản cũ; chạy lại với giai đoạn post-deploy sau khi migrate.'),
    );
  }
  return results.map((r) => fail(G_DB, r.id, r.title, `không đọc được (${code}): schema DB chưa khớp mã`, 'Áp migration theo runbook (prisma migrate deploy bằng image mới) rồi chạy lại kiểm tra.'));
}

function pendingMigrationCount(s: DbSnapshot): number {
  const applied = new Set(s.appliedMigrations);
  return s.expectedMigrations.filter((m) => !applied.has(m)).length;
}

/** Phân tích ảnh chụp DB thành các dòng kiểm tra. Hàm thuần: không chạm DB. */
export function evaluateDb(s: DbSnapshot, ctx: DbContext): CheckResult[] {
  const d = s.degraded ?? {};
  const pendingCount = pendingMigrationCount(s);
  const part = (key: keyof NonNullable<DbSnapshot['degraded']>, results: CheckResult[], extraKey?: keyof NonNullable<DbSnapshot['degraded']>): CheckResult[] => {
    const code = d[key] ?? (extraKey ? d[extraKey] : undefined);
    return code ? degradeResults(results, code, ctx.phase, pendingCount) : results;
  };
  const configPart = (results: CheckResult[]) => part('configs', results);
  const demo = evaluateDemoData(d.demoData ? EMPTY_DEMO : s.demoData, ctx.env, ctx.phase);

  return [
    ...migrationChecks(s, ctx.phase),
    ordersLockCheck(s),
    ...part('waste', [wastePointCheck(s, ctx.env)], 'configs'),
    ...configPart([
      opsThresholdCheck(s),
      shippingRateCheck(s),
      shippingEtaCheck(s),
      commissionCheck(s),
      holdCheck(s),
      consignmentFromCheck(s),
      bankCheck(s),
      companyIdentityCheck(s, ctx.phase),
      legalPoliciesCheck(s, ctx.phase),
      miniappBaseUrlCheck(s, ctx.env),
    ]),
    codCapCheck(s),
    ...configPart(gomdonToggleChecks(s, ctx.env)),
    ...part('membershipTiers', [membershipTierCheck(s, ctx.phase)]),
    ...part('dealerTiers', [dealerTierCheck(s)]),
    ...part('admin', [adminCheck(s)]),
    ...part('zns', [znsCheck(s)]),
    ...(d.demoData ? degradeResults(demo, d.demoData, ctx.phase, pendingCount) : demo),
  ];
}

const EMPTY_DEMO: DemoDataSnapshot = { products: { found: 0, active: 0 }, activeVariations: 0, liveCoupons: [] };
