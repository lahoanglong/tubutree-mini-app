import type { BackupSnapshot } from '../../../config/go-live/backup-checks';
import { LEGAL_DOCS, type DbSnapshot } from '../../../config/go-live/db-checks';
import type { RedisSnapshot } from '../../../config/go-live/redis-checks';
import { fail, pass, warn, type CheckResult } from '../../../config/go-live/types';
import { trimInvisible } from '../../../common/text-trim';
import type { CockpitCardKey, CockpitMetric } from './golive-cards';

/** Mục tiêu số cặp Refill đã ghép trước khi mở bán (PO, 21/11/2026). */
export const REFILL_PAIRS_TARGET = 16;
/** Mẫu ZNS phải có mã Zalo đã duyệt trước Giờ G: xác nhận đơn, đang giao, nhắc mua lại Refill. */
export const REQUIRED_ZNS_CODES = ['ORDER_CONFIRMED', 'ORDER_SHIPPING', 'REORDER_REMINDER_REFILL'] as const;
/** Lượt đồng bộ danh mục Pancake chạy hằng ngày; quá mốc này thì coi là đã lỡ một lượt. */
export const CATALOG_SYNC_STALE_HOURS = 26;

const G = 'Bảng kiểm Giờ G';
const HOUR_MS = 3_600_000;

/** Số đọc thêm cho các dòng riêng của bảng kiểm (ngoài `go-live:check`). Chỉ số đếm, mốc giờ và cờ có/không, không có giá trị cấu hình nào. */
export interface CockpitExtrasSnapshot {
  catalog: {
    /** Sản phẩm của Tubu (không phải đối tác) đang bật, cùng tập "Trên N sản phẩm đang bán" ở tab Kiểm tra catalog. */
    activeProducts: number;
    activeVariations: number;
    missingIngredients: number;
    customStory: number;
    /** Biến thể đang bán của sản phẩm Tubu đang bán mà chưa có mã Pancake: đơn có món này không lên kho. */
    unlinkedVariations: number;
  };
  /** null: không đọc được bảng cặp (lỗi đọc), dòng báo WARN thay vì làm hỏng cả bảng. */
  refill: { enabled: boolean; paired: number; near: number; size: number; ambiguous: number } | null;
  pancake: { configured: boolean; lastWebhookAt: Date | null; lastPushOkAt: Date | null; catalogLastOkAt: Date | null; catalogLastErrorAt: Date | null };
  company: { hasRegistrationNumber: boolean; hasBctNoticeUrl: boolean };
}

const vn = (n: number) => n.toLocaleString('vi-VN');

export function ageText(at: Date | null, now: Date): string {
  if (!at) return 'chưa có';
  const h = Math.max(0, (now.getTime() - at.getTime()) / HOUR_MS);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} phút trước`;
  if (h < 48) return `${Math.round(h)} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

function znsRequiredRow(db: DbSnapshot | null): CheckResult {
  const id = 'cockpit.zns.required';
  const title = 'Mẫu ZNS bắt buộc có mã Zalo (xác nhận đơn, đang giao, nhắc Refill)';
  if (!db) return warn(G, id, title, 'không đọc được danh sách mẫu (xem dòng Cơ sở dữ liệu)', 'Sửa lỗi đọc DB trước, rồi tải lại bảng kiểm.');
  const approved = new Set(
    db.znsTemplates.filter((t) => t.channel === 'ZNS' && t.zaloTemplateId && /^\d{1,20}$/.test(t.zaloTemplateId.trim())).map((t) => t.code),
  );
  const missing = REQUIRED_ZNS_CODES.filter((c) => !approved.has(c));
  if (missing.length === 0) return pass(G, id, title, `${REQUIRED_ZNS_CODES.length}/${REQUIRED_ZNS_CODES.length} mẫu đã có mã số Zalo`);
  return warn(
    G,
    id,
    title,
    `${REQUIRED_ZNS_CODES.length - missing.length}/${REQUIRED_ZNS_CODES.length} mẫu có mã; còn thiếu: ${missing.join(', ')}`,
    'Đăng ký mẫu trong Zalo OA, chờ Zalo duyệt, rồi nhập mã số vào Quản trị, Mẫu thông báo. Chưa có mã thì khách chỉ nhận tin trong app.',
  );
}

function wasteMailinRow(db: DbSnapshot | null): CheckResult {
  const id = 'cockpit.waste.lane_mailin';
  const title = 'Cách "Gửi về kho" của Đổi rác (waste.lane_mailin_enabled)';
  if (!db) return warn(G, id, title, 'không đọc được cấu hình', 'Sửa lỗi đọc DB trước, rồi tải lại bảng kiểm.');
  if (!('waste.lane_mailin_enabled' in db.configs)) {
    return warn(G, id, title, 'chưa có dòng cấu hình, mã coi như đang bật', 'Tạo dòng waste.lane_mailin_enabled = false ở Quản trị, Cấu hình cho tới khi có bảng cước gửi về kho.');
  }
  const v = db.configs['waste.lane_mailin_enabled'];
  if (v === false) return pass(G, id, title, 'đang tắt: giữ tắt tới khi có bảng cước gửi về kho');
  return warn(G, id, title, v === true ? 'đang bật' : 'giá trị không phải true/false', 'Bảng kiểm chỉ đọc, không đổi cờ này. Chỉ bật khi bảng cước waste.mailin_fee_table đã có số thật và chủ dự án đồng ý.');
}

function catalogRows(x: CockpitExtrasSnapshot): CheckResult[] {
  const c = x.catalog;
  const out: CheckResult[] = [];
  out.push(
    c.activeProducts > 0
      ? pass(G, 'cockpit.catalog.active_skus', 'Sản phẩm đang bán', `${vn(c.activeProducts)} sản phẩm, ${vn(c.activeVariations)} biến thể`)
      : fail(G, 'cockpit.catalog.active_skus', 'Sản phẩm đang bán', 'không có sản phẩm nào đang bán', 'Chạy "Đồng bộ danh mục Pancake" ở tab Sức khoẻ hệ thống, rồi bật sản phẩm ở tab Sản phẩm.'),
  );

  const refillTitle = `Cặp Refill đã ghép (mục tiêu ${REFILL_PAIRS_TARGET})`;
  if (!x.refill) {
    out.push(warn(G, 'cockpit.catalog.refill_pairs', refillTitle, 'không đọc được bảng cặp', 'Mở tab Cặp Refill để xem lỗi.'));
  } else {
    const r = x.refill;
    const suggested = r.near + r.size;
    const parts = [`${vn(r.paired)} cặp đã ghép`, `${vn(r.near)} gợi ý gần đúng`, `${vn(r.size)} gợi ý theo dung tích`];
    if (r.ambiguous > 0) parts.push(`${vn(r.ambiguous)} chai có nhiều gói refill`);
    if (!r.enabled) parts.push('cờ Refill đang tắt');
    const detail = parts.join(', ');
    out.push(
      r.paired >= REFILL_PAIRS_TARGET && suggested === 0
        ? pass(G, 'cockpit.catalog.refill_pairs', refillTitle, detail)
        : warn(G, 'cockpit.catalog.refill_pairs', refillTitle, detail, 'Mở tab Cặp Refill, bấm "Duyệt nhanh tất cả gợi ý" hoặc ghép tay từng chai.'),
    );
  }

  out.push(
    c.missingIngredients === 0
      ? pass(G, 'cockpit.catalog.inci', 'Sản phẩm đang bán có thành phần (INCI)', `đủ ${vn(c.activeProducts)}/${vn(c.activeProducts)}`)
      : warn(
          G,
          'cockpit.catalog.inci',
          'Sản phẩm đang bán có thành phần (INCI)',
          `thiếu ${vn(c.missingIngredients)}/${vn(c.activeProducts)}`,
          'Mở tab Kiểm tra catalog, lọc "Thiếu thành phần", điền hoặc chụp nhãn để AI đọc.',
        ),
  );

  const storyDetail = `${vn(c.customStory)}/${vn(c.activeProducts)} sản phẩm có câu chuyện riêng, còn lại dùng kịch bản mẫu`;
  out.push(
    c.activeProducts === 0 || c.customStory > 0
      ? pass(G, 'cockpit.catalog.story', 'Câu chuyện sản phẩm (Story Studio)', storyDetail)
      : warn(G, 'cockpit.catalog.story', 'Câu chuyện sản phẩm (Story Studio)', storyDetail, 'Không chặn mở bán. Viết câu chuyện riêng cho món bán chạy ở tab Sản phẩm, Story Studio.'),
  );
  return out;
}

function pancakeRows(x: CockpitExtrasSnapshot, now: Date): CheckResult[] {
  const p = x.pancake;
  const out: CheckResult[] = [];
  const unlinked = x.catalog.unlinkedVariations;
  out.push(
    unlinked === 0
      ? pass(G, 'cockpit.pancake.unlinked_variants', 'Biến thể đang bán đã liên kết Pancake', 'đủ')
      : warn(
          G,
          'cockpit.pancake.unlinked_variants',
          'Biến thể đang bán đã liên kết Pancake',
          `${vn(unlinked)} biến thể chưa có mã Pancake: đơn có món này không lên kho`,
          'Chạy "Đồng bộ danh mục Pancake" ở tab Sức khoẻ hệ thống; còn sót thì tắt biến thể đó hoặc tạo trên Pancake POS.',
        ),
  );

  const title = 'Đồng bộ Pancake gần nhất';
  const detail = `danh mục ${ageText(p.catalogLastOkAt, now)}, webhook ${ageText(p.lastWebhookAt, now)}, đẩy đơn ${ageText(p.lastPushOkAt, now)}`;
  const hint = 'Mở tab Sức khoẻ hệ thống, thẻ Pancake: xem lỗi gần nhất và bấm "Đồng bộ danh mục Pancake".';
  if (!p.configured) out.push(warn(G, 'cockpit.pancake.recent_sync', title, `chưa cấu hình khoá Pancake; ${detail}`, hint));
  else if (!p.catalogLastOkAt) out.push(warn(G, 'cockpit.pancake.recent_sync', title, `danh mục chưa đồng bộ thành công lần nào; ${detail}`, hint));
  else if (p.catalogLastErrorAt && p.catalogLastErrorAt > p.catalogLastOkAt) out.push(warn(G, 'cockpit.pancake.recent_sync', title, `lượt đồng bộ danh mục gần nhất bị lỗi; ${detail}`, hint));
  else if (now.getTime() - p.catalogLastOkAt.getTime() > CATALOG_SYNC_STALE_HOURS * HOUR_MS) out.push(warn(G, 'cockpit.pancake.recent_sync', title, `quá ${CATALOG_SYNC_STALE_HOURS} giờ chưa đồng bộ danh mục; ${detail}`, hint));
  else out.push(pass(G, 'cockpit.pancake.recent_sync', title, detail));
  return out;
}

function legalRows(x: CockpitExtrasSnapshot): CheckResult[] {
  return [
    x.company.hasRegistrationNumber
      ? pass(G, 'cockpit.legal.business_registration', 'Số giấy chứng nhận đăng ký doanh nghiệp', 'đã điền')
      : warn(
          G,
          'cockpit.legal.business_registration',
          'Số giấy chứng nhận đăng ký doanh nghiệp',
          'chưa điền (company.business_registration_number)',
          'Điền ở Quản trị, Cấu hình, Thông tin cửa hàng; hồ sơ Bộ Công Thương và chân trang cần số này.',
        ),
    x.company.hasBctNoticeUrl
      ? pass(G, 'cockpit.legal.bct_notice', 'Link thông báo Bộ Công Thương', 'đã có link online.gov.vn')
      : warn(
          G,
          'cockpit.legal.bct_notice',
          'Link thông báo Bộ Công Thương',
          'chưa có (company.bct_notice_url)',
          'Chỉ dán khi Bộ Công Thương đã duyệt hồ sơ: link https do online.gov.vn cấp, ở Quản trị, Cấu hình, Thông tin cửa hàng.',
        ),
  ];
}

/** Dòng riêng của bảng kiểm. Dòng ZNS và Gửi về kho đọc từ ảnh chụp DB của `go-live:check` (không đọc lại DB). */
export function evaluateCockpitExtras(x: CockpitExtrasSnapshot, db: DbSnapshot | null, now: Date): CheckResult[] {
  return [znsRequiredRow(db), ...pancakeRows(x, now), wasteMailinRow(db), ...catalogRows(x), ...legalRows(x)];
}

/** Con số đầu thẻ (để đọc lướt); trạng thái xanh/vàng/đỏ vẫn chỉ do các dòng quyết định. */
export function cockpitMetrics(
  x: CockpitExtrasSnapshot,
  snaps: { db: DbSnapshot | null; redis: RedisSnapshot | null; backup: BackupSnapshot | null },
  now: Date,
): Partial<Record<CockpitCardKey, CockpitMetric[]>> {
  const { db, redis, backup } = snaps;
  const zns = db?.znsTemplates.filter((t) => t.channel === 'ZNS') ?? [];
  const legalSaved = db ? Object.keys(LEGAL_DOCS).filter((k) => typeof db.configs[k] === 'string' && trimInvisible(db.configs[k] as string) !== '').length : null;
  const newest = backup?.dir.newest;
  const mailin = db?.configs['waste.lane_mailin_enabled'];
  return {
    infra: [
      { label: 'Migration đã áp', value: db ? `${vn(db.appliedMigrations.length)}/${vn(db.expectedMigrations.length)}` : 'không đọc được' },
      { label: 'Redis', value: redis ? (redis.reachable ? 'kết nối được' : 'không kết nối được') : 'không đọc được' },
      { label: 'Bản backup mới nhất', value: newest ? ageText(new Date(now.getTime() - newest.ageHours * HOUR_MS), now) : 'không thấy từ API' },
    ],
    zalo: [{ label: 'Mẫu ZNS có mã Zalo', value: db ? `${vn(zns.filter((t) => t.zaloTemplateId?.trim()).length)}/${vn(zns.length)}` : 'không đọc được' }],
    pancake: [
      { label: 'Biến thể chưa liên kết', value: vn(x.catalog.unlinkedVariations) },
      { label: 'Đồng bộ danh mục', value: ageText(x.pancake.catalogLastOkAt, now) },
    ],
    waste: [{ label: 'Gửi về kho', value: mailin === false ? 'Tắt' : mailin === true ? 'Bật' : 'Chưa đặt' }],
    catalog: [
      { label: 'Sản phẩm đang bán', value: vn(x.catalog.activeProducts) },
      { label: 'Cặp Refill', value: x.refill ? `${vn(x.refill.paired)}/${REFILL_PAIRS_TARGET}` : 'không đọc được' },
      { label: 'Thiếu INCI', value: vn(x.catalog.missingIngredients) },
      { label: 'Câu chuyện riêng', value: `${vn(x.catalog.customStory)}/${vn(x.catalog.activeProducts)}` },
    ],
    legal: [
      { label: 'Chính sách đã lưu', value: legalSaved === null ? 'không đọc được' : `${legalSaved}/${Object.keys(LEGAL_DOCS).length}` },
      { label: 'Số ĐKKD', value: x.company.hasRegistrationNumber ? 'Đã điền' : 'Chưa điền' },
    ],
  };
}
