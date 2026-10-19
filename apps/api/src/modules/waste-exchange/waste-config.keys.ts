import { isDeepStrictEqual } from 'node:util';

export type WasteConfigType = 'boolean' | 'int' | 'json' | 'string';

export interface WasteConfigKeyDef {
  default: boolean | number | string | Record<string, unknown>;
  type: WasteConfigType;
  category: 'waste';
  description: string;
  min?: number;
  max?: number;
  maxLength?: number;
}

const RULES_TEXT_MAX_LENGTH = 8000;

export const WASTE_CONFIG_KEYS = {
  'waste.enabled': {
    default: false,
    type: 'boolean',
    category: 'waste',
    description: 'Cờ tổng của chương trình Đổi rác lấy quà, tắt thì khách không tạo được yêu cầu mới và bàn đại lý bị chặn, kho vẫn xử lý yêu cầu đã có.',
  },
  'waste.lane_dropoff_enabled': {
    default: true,
    type: 'boolean',
    category: 'waste',
    description: 'Bật cách giao Mang tới điểm nhận cho yêu cầu mới.',
  },
  'waste.lane_mailin_enabled': {
    default: true,
    type: 'boolean',
    category: 'waste',
    description: 'Bật cách giao Gửi về kho cho yêu cầu mới.',
  },
  'waste.lane_pickup_enabled': {
    default: false,
    type: 'boolean',
    category: 'waste',
    description: 'Bật cách giao Thu kèm đơn cho yêu cầu mới, còn cần cờ Gomdon hiện có.',
  },
  'waste.mailin_min_points': {
    default: 15_000,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 1_000_000,
    description: 'Số Điểm Xanh tối thiểu của một gói gửi kho, không được lớn hơn trần điểm tháng của khách.',
  },
  'waste.pickup_min_points': {
    default: 10_000,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 1_000_000,
    description: 'Số Điểm Xanh tối thiểu của một gói thu kèm đơn, không được lớn hơn trần điểm tháng của khách.',
  },
  'waste.customer_monthly_cap_points': {
    default: 60_000,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 2_000_000,
    description: 'Trần Điểm Xanh mỗi khách được cộng từ đổi rác trong một tháng.',
  },
  'waste.max_open_requests': {
    default: 3,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 20,
    description: 'Số yêu cầu đổi rác một khách được mở cùng lúc.',
  },
  'waste.request_hold_days': {
    default: 7,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 60,
    description: 'Số ngày giữ chỗ một yêu cầu và chờ khách nhập mã vận đơn.',
  },
  'waste.pickup_wait_days': {
    default: 14,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 90,
    description: 'Số ngày chờ hàng thu kèm về kho sau khi đơn mua đã giao.',
  },
  'waste.in_transit_review_days': {
    default: 30,
    type: 'int',
    category: 'waste',
    min: 7,
    max: 180,
    description: 'Yêu cầu gửi kho đang vận chuyển quá ngần này ngày thì vào danh sách admin xem lại.',
  },
  'waste.mailin_max_weight_kg': {
    default: 20,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 50,
    description: 'Khối lượng tối đa của mỗi kiện gửi kho, tính bằng kg, theo giới hạn của hãng chuyển phát.',
  },
  'waste.mailin_max_edge_cm': {
    default: 50,
    type: 'int',
    category: 'waste',
    min: 10,
    max: 200,
    description: 'Cạnh dài tối đa của mỗi kiện gửi kho, tính bằng cm.',
  },
  'waste.shortfall_lock_pct': {
    default: 50,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 100,
    description: 'Yêu cầu hoàn tất mà điểm cộng chưa tới (100 trừ ngần này) phần trăm điểm ước tính thì tính là một lần nhận thiếu.',
  },
  'waste.shortfall_lock_streak': {
    default: 3,
    type: 'int',
    category: 'waste',
    min: 2,
    max: 10,
    description: 'Số lần nhận thiếu liền nhau thì khoá đường gửi kho và thu kèm đơn của khách.',
  },
  'waste.staff_daily_cap_points': {
    default: 1_000_000,
    type: 'int',
    category: 'waste',
    min: 1,
    max: 20_000_000,
    description: 'Trần Điểm Xanh mỗi nhân viên kho hoặc điểm nhận được xác nhận trong một ngày.',
  },
  'waste.gift_claim_days': {
    default: 60,
    type: 'int',
    category: 'waste',
    min: 7,
    max: 365,
    description: 'Số ngày khách được nhận quà bằng mã, quá hạn thì lượt đổi vào danh sách admin xem lại.',
  },
  'waste.point_inactive_days': {
    default: 60,
    type: 'int',
    category: 'waste',
    min: 7,
    max: 365,
    description: 'Điểm nhận đối tác không có lượt xác nhận nào quá ngần này ngày kể từ lần xác nhận cuối hoặc lần kích hoạt thì bị ẩn khỏi danh sách khách.',
  },
  'waste.mailin_fee_table': {
    default: { zones: [], defaultZone: { name: 'Toàn quốc', low: 30_000, high: 85_000 } },
    type: 'json',
    category: 'waste',
    description: 'Bảng ước tính phí ship gửi kho theo vùng tỉnh, mỗi vùng có phí thấp và phí cao, cộng một vùng mặc định cho tỉnh chưa xếp.',
  },
  'waste.alert_thresholds': {
    default: {
      quotaPacePct: 60,
      quotaPaceDays: 10,
      fullMatchPct: 95,
      fullMatchMinSample: 10,
      repeatCustomerCount: 3,
      repeatCustomerDays: 7,
      avgUnitsFactor: 2,
      lookupMissCount: 10,
      lookupMissDays: 1,
      staffDirectCount: 5,
      staffDirectDays: 7,
    },
    type: 'json',
    category: 'waste',
    description: 'Ngưỡng cảnh báo bất thường về điểm nhận và người xác nhận, chỉ để admin xem, không tự khoá ai.',
  },
  'waste.rules_text': {
    default: '',
    type: 'string',
    category: 'waste',
    maxLength: RULES_TEXT_MAX_LENGTH,
    description: 'Thể lệ công khai của chương trình, tối đa 8000 ký tự, để trống thì mục Thể lệ hiện ghi chú sắp có.',
  },
} as const satisfies Record<string, WasteConfigKeyDef>;

export type WasteConfigKey = keyof typeof WASTE_CONFIG_KEYS;

type SeedRowShape = { key: string; value: unknown; category?: string; createOnly?: boolean; description?: string };

/** seed.ts keeps the 21 rows as literals (specs evaluate the array); this fails the seed run when a literal drifts from the record. */
export function assertWasteConfigSeedRows(rows: ReadonlyArray<SeedRowShape>): void {
  const defs: Record<string, WasteConfigKeyDef> = WASTE_CONFIG_KEYS;
  for (const row of rows) {
    if (row.key.startsWith('waste.') && !(row.key in defs)) {
      throw new Error(`seed.ts has a config row "${row.key}" that is not in WASTE_CONFIG_KEYS`);
    }
  }
  for (const [key, def] of Object.entries(defs)) {
    const row = rows.find((r) => r.key === key);
    if (!row) throw new Error(`seed.ts has no config row for "${key}"`);
    if (!isDeepStrictEqual(row.value, def.default)) throw new Error(`seed row "${key}" differs from its default in WASTE_CONFIG_KEYS`);
    if (row.category !== 'waste') throw new Error(`seed row "${key}" must have category "waste"`);
    if (row.createOnly !== true) throw new Error(`seed row "${key}" must be createOnly so a deploy never resets an admin edit`);
    if (row.description !== undefined && row.description !== def.description) {
      throw new Error(`seed row "${key}" has a description that differs from WASTE_CONFIG_KEYS`);
    }
  }
}

export const WASTE_RANGES: Record<string, { min: number; max: number; note: string; integer: true }> = Object.fromEntries(
  Object.entries<WasteConfigKeyDef>(WASTE_CONFIG_KEYS)
    .filter(([, def]) => def.type === 'int')
    .map(([key, def]) => [key, { min: def.min!, max: def.max!, note: def.description, integer: true as const }]),
);

export const WASTE_BOOLEAN_KEYS: readonly WasteConfigKey[] = (Object.keys(WASTE_CONFIG_KEYS) as WasteConfigKey[]).filter(
  (key) => WASTE_CONFIG_KEYS[key].type === 'boolean',
);

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIntBetween = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

const FEE_ZONES_MAX = 20;
const FEE_NAME_MAX = 60;
const FEE_MAX = 500_000;

function feeRangeProblem(label: string, zone: Record<string, unknown>): string | null {
  if (typeof zone.name !== 'string' || zone.name.length === 0 || zone.name.length > FEE_NAME_MAX) {
    return `${label}.name phải là chuỗi từ 1 đến ${FEE_NAME_MAX} ký tự`;
  }
  if (!isIntBetween(zone.low, 0, FEE_MAX)) return `${label}.low phải là số nguyên từ 0 đến ${FEE_MAX}`;
  if (!isIntBetween(zone.high, zone.low, FEE_MAX)) return `${label}.high phải là số nguyên từ ${zone.low} đến ${FEE_MAX}`;
  return null;
}

function mailinFeeTableProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'phải là object { zones, defaultZone }';
  const { zones, defaultZone } = value;
  if (!Array.isArray(zones) || zones.length > FEE_ZONES_MAX) return `zones phải là mảng tối đa ${FEE_ZONES_MAX} vùng`;
  const seen = new Set<string>();
  for (const [i, zone] of zones.entries()) {
    const label = `zones[${i}]`;
    if (!isPlainObject(zone)) return `${label} phải là object { name, provinceCodes, low, high }`;
    const problem = feeRangeProblem(label, zone);
    if (problem) return problem;
    const codes = zone.provinceCodes;
    if (!Array.isArray(codes) || codes.some((c) => typeof c !== 'string' || c.length === 0)) {
      return `${label}.provinceCodes phải là mảng chuỗi không rỗng`;
    }
    const own = new Set<string>(codes as string[]);
    for (const code of own) {
      if (seen.has(code)) return `mã tỉnh "${code}" xuất hiện ở hai vùng`;
    }
    for (const code of own) seen.add(code);
  }
  if (!isPlainObject(defaultZone)) return 'defaultZone phải là object { name, low, high }';
  return feeRangeProblem('defaultZone', defaultZone);
}

const THRESHOLD_INT_BOUNDS: Record<string, [number, number]> = {
  quotaPacePct: [1, 100],
  fullMatchPct: [1, 100],
  quotaPaceDays: [1, 31],
  repeatCustomerDays: [1, 31],
  lookupMissDays: [1, 31],
  staffDirectDays: [1, 31],
  fullMatchMinSample: [1, 1000],
  repeatCustomerCount: [1, 1000],
  lookupMissCount: [1, 1000],
  staffDirectCount: [1, 1000],
};
const THRESHOLD_KEYS = [...Object.keys(THRESHOLD_INT_BOUNDS), 'avgUnitsFactor'];

function alertThresholdsProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'phải là object có đúng 11 ngưỡng';
  const extra = Object.keys(value).filter((k) => !THRESHOLD_KEYS.includes(k));
  if (extra.length > 0) return `có ngưỡng lạ: ${extra.join(', ')}`;
  for (const [key, [min, max]] of Object.entries(THRESHOLD_INT_BOUNDS)) {
    if (!(key in value)) return `thiếu ngưỡng ${key}`;
    if (!isIntBetween(value[key], min, max)) return `${key} phải là số nguyên từ ${min} đến ${max}`;
  }
  const factor = value.avgUnitsFactor;
  if (factor === undefined) return 'thiếu ngưỡng avgUnitsFactor';
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 1 || factor > 20) return 'avgUnitsFactor phải là số từ 1 đến 20';
  return null;
}

function rulesTextProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'phải là chuỗi';
  return value.length <= RULES_TEXT_MAX_LENGTH ? null : `tối đa ${RULES_TEXT_MAX_LENGTH} ký tự`;
}

export const WASTE_JSON_RULES: Record<string, (value: unknown) => string | null> = {
  'waste.mailin_fee_table': mailinFeeTableProblem,
  'waste.alert_thresholds': alertThresholdsProblem,
  'waste.rules_text': rulesTextProblem,
};
