import { apiFetch } from '@/lib/client-api';

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';
export type CockpitCardKey = 'infra' | 'zalo' | 'pancake' | 'waste' | 'catalog' | 'legal';

/** Một dòng của `go-live:check` hoặc dòng riêng của bảng kiểm (`CheckResult` ở `apps/api/src/config/go-live/types.ts`). */
export interface CockpitRow {
  id: string;
  group: string;
  title: string;
  status: CheckStatus;
  detail: string;
  hint: string;
}

export interface CockpitCard {
  key: CockpitCardKey;
  title: string;
  status: CheckStatus;
  counts: Record<CheckStatus, number>;
  metrics: { label: string; value: string }[];
  rows: CockpitRow[];
}

/** `GET /admin/golive/cockpit` (`GoLiveCockpit` ở `apps/api/src/modules/admin/golive/golive-cockpit.service.ts`). */
export interface GoLiveCockpit {
  generatedAt: string;
  phase: 'post-deploy';
  summary: { pass: number; warn: number; fail: number };
  cards: CockpitCard[];
}

export type PilotAction = 'CANCEL' | 'ARCHIVE' | 'MANUAL' | 'DONE';
export type PilotMatch = 'NOTE_MARKER' | 'TEST_PHONE';

export interface PilotOrderRow {
  code: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
  matchedBy: PilotMatch[];
  phone: string | null;
  action: PilotAction;
  reason: string;
  /** Đơn chỉ khớp SĐT người thử, bán lẻ, chưa trả tiền, chưa rời kho, không phải CTV đặt hộ: quản trị viên tick thì lượt dọn huỷ đơn này. */
  optInEligible: boolean;
}

export interface PilotOrdersView {
  marker: string;
  confirmText: string;
  windowDays: number;
  truncated: boolean;
  orders: PilotOrderRow[];
  counts: Record<PilotAction, number>;
}

export interface PilotCleanupResult {
  dryRun: boolean;
  orders: PilotOrderRow[];
  affected: { ordersCancelled: number; statusHistoryRows: number; ordersArchived: number; auditLogRows: number };
  cancelled: string[];
  archived: string[];
  skipped: { code: string; reason: string }[];
  failed: { code: string; message: string }[];
  auditLogId: string | null;
  auditError: string | null;
}

export function getCockpit(fresh = false): Promise<GoLiveCockpit> {
  return apiFetch<GoLiveCockpit>(fresh ? '/admin/golive/cockpit?fresh=1' : '/admin/golive/cockpit');
}

export function listPilotOrders(phones: readonly string[]): Promise<PilotOrdersView> {
  const q = phones.length > 0 ? `?phones=${encodeURIComponent(phones.join(','))}` : '';
  return apiFetch<PilotOrdersView>(`/admin/golive/pilot-orders${q}`);
}

export function cleanupPilotOrders(body: {
  dryRun: boolean;
  codes: string[];
  phones: string[];
  optInCodes?: string[];
  confirmText?: string;
}): Promise<PilotCleanupResult> {
  return apiFetch<PilotCleanupResult>('/admin/golive/pilot-orders/cleanup', { method: 'POST', body });
}

/** Ô SĐT người thử: tách theo dấu phẩy, chấm phẩy hoặc xuống dòng, bỏ khoảng trắng bên trong số; máy chủ kiểm dạng số. */
export function splitPhones(raw: string): string[] {
  return [...new Set(raw.split(/[,;\n]+/).map((s) => s.replace(/\s+/g, '')).filter(Boolean))];
}

export interface FixLink {
  href: string;
  label: string;
}

const CARD_FIX: Record<CockpitCardKey, FixLink> = {
  infra: { href: '/admin?tab=opsHealth', label: 'Sức khoẻ hệ thống' },
  zalo: { href: '/admin?tab=notificationTemplates', label: 'Mẫu thông báo' },
  pancake: { href: '/admin?tab=opsHealth', label: 'Sức khoẻ hệ thống' },
  waste: { href: '/admin?tab=waste', label: 'Đổi rác' },
  catalog: { href: '/admin?tab=catalogQuality', label: 'Kiểm tra catalog' },
  legal: { href: '/admin?tab=config', label: 'Cấu hình' },
};

const PRODUCTS: FixLink = { href: '/admin?tab=productCategories', label: 'Sản phẩm' };
/** Bàn đối soát tồn Pancake (`/admin/doi-soat-kho`, đọc `flag`/`q` trên URL): việc tồn kho của thẻ "Pancake và kho". */
const STOCK_RECONCILE: FixLink = { href: '/admin/doi-soat-kho', label: 'Đối soát tồn kho' };

/** Link thứ hai của thẻ, ngoài trang chung: thẻ "Pancake và kho" có việc tồn kho ở trang riêng. */
const CARD_EXTRA: Partial<Record<CockpitCardKey, readonly FixLink[]>> = {
  pancake: [STOCK_RECONCILE],
};

/**
 * Dòng sửa ở trang khác trang chung của thẻ, xét theo thứ tự (prefix riêng trước `db.`). Mọi dòng `db.*` còn lại là khoá SystemConfig,
 * sửa ở tab Cấu hình như gợi ý của chính dòng đó.
 */
const ROW_FIX: ReadonlyArray<readonly [prefix: string, link: FixLink]> = [
  // Mở thẳng chip "Chưa gắn Pancake": từng biến thể đang bán chưa có mã Pancake, kèm nút Tải CSV để đi gắn mã.
  ['cockpit.pancake.unlinked_variants', { href: '/admin/doi-soat-kho?flag=UNLINKED', label: 'Đối soát tồn kho' }],
  ['cockpit.catalog.refill_pairs', { href: '/admin?tab=refillPairs', label: 'Cặp Refill' }],
  // Mở thẳng bộ lọc "Thiếu thành phần" (`catalog-quality-tab.tsx` đọc `filter` và tự chạy lần kiểm), kèm chip thương hiệu và tin nhắn nhờ thương hiệu gửi INCI.
  ['cockpit.catalog.inci', { href: '/admin?tab=catalogQuality&filter=missing_ingredients', label: 'Kiểm tra catalog' }],
  ['cockpit.catalog.active_skus', PRODUCTS],
  ['cockpit.catalog.story', PRODUCTS],
  ['db.demo_products', PRODUCTS],
  ['db.demo_coupons', { href: '/admin?tab=coupons', label: 'Mã giảm giá' }],
  ['db.admin_user', { href: '/admin?tab=users', label: 'Người dùng' }],
  ['db.dealer_tiers', { href: '/admin?tab=dealers', label: 'Đại lý' }],
  ['db.waste_point', CARD_FIX.waste],
  ['db.zns_', CARD_FIX.zalo],
  ['db.', CARD_FIX.legal],
];

/** Dòng chỉ sửa được trên máy chủ (biến .env, Redis, backup, migration): không trang quản trị nào sửa được nên không gắn link. */
const SERVER_ONLY = ['env.', 'redis.', 'backup.', 'db.migrations_', 'db.required_migrations', 'db.pending_scope', 'db.orders_lock'];

/** Trang sửa chung của thẻ trước, rồi link phụ (nếu có). */
export function cardFixLinks(key: CockpitCardKey): FixLink[] {
  return [CARD_FIX[key], ...(CARD_EXTRA[key] ?? [])];
}

/** Trang sửa của một dòng chưa đạt; null khi dòng đã đạt hoặc chỉ sửa được trên máy chủ. */
export function rowFixLink(row: Pick<CockpitRow, 'id' | 'status'>, card: CockpitCardKey): FixLink | null {
  if (row.status === 'PASS') return null;
  if (SERVER_ONLY.some((p) => row.id.startsWith(p))) return null;
  for (const [prefix, link] of ROW_FIX) if (row.id.startsWith(prefix)) return link;
  return CARD_FIX[card];
}
