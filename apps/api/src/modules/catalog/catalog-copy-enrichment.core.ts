import type { Prisma, PrismaClient } from '@prisma/client';
import { baseSlug, claimsIn, findProductCopyFallback, isBlankHtmlText, normalizeCopyText, type CopyIngredient } from '@tubutree/shared-types';
import { ingredientNames } from './ingredient-names';

/**
 * Điền chữ còn thiếu cho SKU nhà Tubu đang bán (W147A). Tệp này không import Nest để `catalog-copy-enrichment.cli.ts` dùng chung.
 *
 * Nguồn chữ DUY NHẤT là bảng chữ dự phòng của shared-types (`findProductCopyFallback`): chỉ điều đọc thẳng từ tên sản phẩm hoặc chữ in trên bao bì, đã qua
 * bộ chặn tuyên bố. Cố ý KHÔNG tự viết thêm: bảng `products` không có cột xuất xứ, cách dùng hay cách bảo quản, và catalog chưa có nguồn nào cho những câu đó
 * (chúng là tuyên bố cần giấy tờ của chủ nhãn, xem `copy-claims-guard.ts`). Chúng được liệt kê ở `NOT_WRITTEN` thay vì bịa.
 * `storyConfig` cũng không ghi: NULL nghĩa là app-core chọn kịch bản mẫu lúc dựng trang, ghi cứng vào DB sẽ đóng băng nó và thắng mọi cập nhật kịch bản sau này.
 *
 * Không đè chữ người đã sửa: trường có chữ được GIỮ, trừ khi bật `force`. Ghi bằng UPDATE có điều kiện `updatedAt` đã đọc, nên người sửa xen giữa thì dòng đó bị bỏ qua.
 */

export const MIN_DESCRIPTION_CHARS = 40;

export type CopyFamily = 'tra-thao-moc' | 'hat-dinh-duong' | 'mat-ong' | 'bot-rau-cu' | 'trai-cay-say' | 'gia-vi' | 'san-pham-xanh' | 'khac';

export const COPY_FAMILY_LABELS: Readonly<Record<CopyFamily, string>> = {
  'tra-thao-moc': 'Trà thảo mộc',
  'hat-dinh-duong': 'Hạt dinh dưỡng',
  'mat-ong': 'Mật ong',
  'bot-rau-cu': 'Bột rau củ',
  'trai-cay-say': 'Trái cây sấy',
  'gia-vi': 'Gia vị',
  'san-pham-xanh': 'Sản phẩm xanh',
  khac: 'Khác',
};

/** Những thứ brief W147A nhắc tới nhưng mã không ghi được: lý do đi kèm, để báo cáo nói thật thay vì im lặng. */
export const NOT_WRITTEN: Readonly<Record<'origin' | 'usageInstructions' | 'storageInstructions' | 'storyConfig', string>> = {
  origin: 'Bảng products không có cột xuất xứ; nhãn có xuất xứ ở BRAND_ORIGINS (app-core) và PDP đã hiện chip từ đó.',
  usageInstructions: 'Không có cột và không có nguồn: cần chữ in trên bao bì do chủ nhãn xác nhận.',
  storageInstructions: 'Không có cột và không có nguồn: cần chữ in trên bao bì do chủ nhãn xác nhận.',
  storyConfig: 'NULL là chủ ý: app-core chọn kịch bản mẫu lúc dựng trang; ghi cứng sẽ đóng băng và thắng kịch bản mẫu sau này.',
};

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Nhóm hàng theo tên đã bỏ dấu. Chỉ để báo cáo gom nhóm; không quyết định có ghi hay không. Thứ tự các luật là thứ tự ưu tiên. */
const FAMILY_RULES: readonly (readonly [CopyFamily, RegExp])[] = [
  ['mat-ong', /\bmat ong\b/],
  ['tra-thao-moc', /\btra\b/],
  ['bot-rau-cu', /\bbot\b.*\b(?:rau|cu|qua)\b/],
  ['trai-cay-say', /\bsay\b|\btrai cay\b/],
  ['hat-dinh-duong', /\bgranola\b|\bmixed nuts\b|\bhat\b/],
  ['gia-vi', /\bgia vi\b|\bnuoc tuong\b|\bnuoc mam\b|\btieu\b/],
  ['san-pham-xanh', /\bfuwa ?3e\b|\bpine ?boo\b/],
];

export function classifyFamily(name: string): CopyFamily {
  const key = fold(name);
  return FAMILY_RULES.find(([, re]) => re.test(key))?.[0] ?? 'khac';
}

/** Chữ người đọc thấy: bỏ thẻ HTML, thực thể, khoảng trắng lạ (cùng bộ chuẩn hoá của bộ chặn tuyên bố). */
const plainText = (v: string | null | undefined): string => normalizeCopyText(v ?? '').replace(/\s+/g, ' ').trim();

/** Ảnh, video, nhúng: mô tả chỉ có những thứ này không có chữ nhưng không phải trống. */
const MEDIA_TAG = /<(?:img|picture|video|iframe|embed|object|svg)\b/i;

export type DescriptionState =
  /** Trống hoặc chỉ có thẻ/khoảng trắng (không kể ảnh/video): coi là chưa viết, được bù. */
  | 'EMPTY'
  /**
   * Ngắn hơn 40 ký tự và đúng bằng tên sản phẩm (sau khi bỏ dấu, hoa thường, dấu câu): kiểu Pancake chép tên vào mô tả. KHÔNG được bù: đồng bộ Pancake
   * (`pancake-sync.service.ts`) ghi đè mô tả không trống mỗi 15 phút, nên chữ bù sẽ bị trả về bản chép tên ngay lượt sau.
   */
  | 'PLACEHOLDER'
  /** Ngắn hơn 40 ký tự nhưng có nội dung ngoài tên (kể cả chữ không phải Latin, ký hiệu): người đã viết, giữ. */
  | 'SHORT_EDIT'
  | 'OK';

export function descriptionState(description: string | null | undefined, name: string): DescriptionState {
  if (isBlankHtmlText(description)) return MEDIA_TAG.test(description ?? '') ? 'SHORT_EDIT' : 'EMPTY';
  const text = plainText(description);
  if (text.length >= MIN_DESCRIPTION_CHARS) return 'OK';
  const d = fold(text);
  return d !== '' && d === fold(name) ? 'PLACEHOLDER' : 'SHORT_EDIT';
}

/** Cột `ingredients` (Json) có dòng thành phần thật. Dùng đúng `ingredientNames` của catalog (bỏ tên trống và "[object Object]" Pancake từng ghi) để khớp màn Kiểm tra catalog. */
export const hasIngredients = (raw: unknown): boolean => ingredientNames(raw).length > 0;

/** So theo (tên, ghi chú), không theo chuỗi JSON: Postgres jsonb sắp lại thứ tự khoá nên chuỗi đọc về khác chuỗi đã ghi. */
function sameIngredients(raw: unknown, list: readonly CopyIngredient[]): boolean {
  if (!Array.isArray(raw) || raw.length !== list.length) return false;
  return raw.every((item, i) => {
    const o = typeof item === 'object' && item !== null ? (item as { name?: unknown; benefit?: unknown }) : {};
    return o.name === list[i]!.name && (o.benefit ?? undefined) === (list[i]!.benefit ?? undefined);
  });
}

/** Chính tả cũ của Q13("hòa, hóa, khỏe, thủy, tùy"): chữ hiện ra với khách chỉ được dùng kiểu "hoà, hoá, khoẻ, thuỷ, tuỳ". Địa danh giữ chính tả hành chính. */
const OLD_STYLE_TONE = /(?:[òóỏõọ][ae]|[ùúủũụ]y)(?![\p{L}])/iu;
const PLACE_NAMES = /Thanh Hóa|Khánh Hòa/gi;

/**
 * Mọi lý do một đoạn chữ không được phép ghi vào DB: tuyên bố bị chặn (`claimsIn`) hoặc chính tả Q13 cũ. Rỗng nghĩa là ghi được.
 * Q13 chạy trên chữ đã chuẩn hoá NFC (dạng NFD của "thủy" qua mặt được regex) và không phân biệt hoa thường ("HŨ THỦY TINH").
 */
export function copyViolations(text: string): string[] {
  const bad = claimsIn(text, 'strict');
  if (OLD_STYLE_TONE.test(text.normalize('NFC').replace(PLACE_NAMES, ''))) bad.push('chính tả Q13 kiểu cũ');
  return bad;
}

/** Mọi chữ sẽ nằm trong cột `ingredients` (kể cả `percentage` và mọi chuỗi khác trong dòng), để bộ chặn thấy hết những gì được ghi. */
const ingredientTexts = (list: readonly CopyIngredient[]): string[] =>
  list.flatMap((i) => Object.values(i).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String)).filter(Boolean);

export interface EnrichProductInput {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  approvalStatus: string;
  storefrontId: string | null;
  description: string;
  ingredients: unknown;
  storyConfig: unknown;
  updatedAt: Date;
}

export type FieldMode = 'FILL' | 'FORCE';

export type PlanStatus =
  /** Có ít nhất một trường sẽ ghi. */
  | 'ENRICH'
  /** Đã đủ chữ (hoặc có chữ người sửa được giữ): không có gì để ghi. */
  | 'COMPLETE'
  /** Catalog chưa có chữ dự phòng có nguồn cho slug này: không bịa. */
  | 'NO_SOURCE'
  /** Chữ dự phòng vi phạm bộ chặn tuyên bố hoặc Q13: không ghi. */
  | 'BLOCKED_BY_GUARD'
  /** Không phải SKU nhà đang bán (đối tác, đang ẩn, chưa duyệt). */
  | 'EXCLUDED';

export interface ProductPlan {
  id: string;
  slug: string;
  name: string;
  family: CopyFamily;
  status: PlanStatus;
  reason: string;
  description?: { mode: FieldMode; before: DescriptionState; value: string };
  ingredients?: { mode: FieldMode; value: CopyIngredient[] };
  /** Trường đã có chữ người sửa nên được giữ nguyên. */
  kept: ('description' | 'ingredients')[];
  storyConfigNull: boolean;
}

export interface CopySource {
  description: string;
  ingredients: readonly CopyIngredient[];
}

export interface PlanOptions {
  force?: boolean;
  /** Nguồn chữ theo slug gốc. Mặc định là bảng chữ dự phòng của shared-types; spec thay bằng nguồn giả để thử đường bị chặn. */
  source?: (slug: string) => CopySource | undefined;
}

export function planProduct(p: EnrichProductInput, opts: PlanOptions = {}): ProductPlan {
  const base = { id: p.id, slug: p.slug, name: p.name, family: classifyFamily(p.name), kept: [] as ('description' | 'ingredients')[], storyConfigNull: p.storyConfig === null || p.storyConfig === undefined };
  if (p.storefrontId !== null) return { ...base, status: 'EXCLUDED', reason: 'Sản phẩm của đối tác' };
  if (!p.isActive) return { ...base, status: 'EXCLUDED', reason: 'Đang ẩn' };
  if (p.approvalStatus !== 'APPROVED') return { ...base, status: 'EXCLUDED', reason: `Chưa duyệt (${p.approvalStatus})` };

  const fallback = (opts.source ?? findProductCopyFallback)(baseSlug(p.slug));
  if (!fallback) return { ...base, status: 'NO_SOURCE', reason: 'Chưa có chữ dự phòng có nguồn cho slug này' };

  const force = opts.force === true;
  const plan: ProductPlan = { ...base, status: 'COMPLETE', reason: 'Đã đủ chữ' };

  // Mô tả: chỉ bù khi trống. PLACEHOLDER (bản chép tên của Pancake) giữ nguyên vì đồng bộ Pancake sẽ đè lại; --force vẫn đè được nhưng cũng bị đồng bộ trả lại nếu Pancake có mô tả.
  const before = descriptionState(p.description, p.name);
  if (plainText(p.description) === plainText(fallback.description)) {
    // đã đúng chữ dự phòng, không có gì để ghi hay giữ
  } else if (before === 'EMPTY') plan.description = { mode: 'FILL', before, value: fallback.description };
  else if (force) plan.description = { mode: 'FORCE', before, value: fallback.description };
  else plan.kept.push('description');

  if (fallback.ingredients.length > 0) {
    if (!hasIngredients(p.ingredients)) plan.ingredients = { mode: 'FILL', value: [...fallback.ingredients] };
    else if (sameIngredients(p.ingredients, fallback.ingredients)) {
      // đã đúng thành phần dự phòng
    } else if (force) plan.ingredients = { mode: 'FORCE', value: [...fallback.ingredients] };
    else plan.kept.push('ingredients');
  }

  // Bộ chặn chỉ xét chữ SẮP ghi: SKU đã đủ chữ không bị đánh dấu BLOCKED chỉ vì bảng dự phòng của nó có lỗi.
  const toWrite = [plan.description?.value, ...ingredientTexts(plan.ingredients?.value ?? [])].filter((t): t is string => !!t);
  const violations = [...copyViolations(toWrite.join('\n')), ...(plan.ingredients?.value.some((i) => i.percentage !== undefined) ? ['thành phần kèm phần trăm'] : [])];
  if (violations.length > 0) {
    return { ...base, status: 'BLOCKED_BY_GUARD', reason: `Chữ dự phòng vi phạm: ${violations.join(', ')}` };
  }

  if (plan.description || plan.ingredients) {
    plan.status = 'ENRICH';
    plan.reason = [plan.description && `mô tả ${plan.description.mode}`, plan.ingredients && `thành phần ${plan.ingredients.mode}`].filter(Boolean).join(', ');
  } else if (plan.kept.length > 0) {
    plan.reason = `Giữ chữ đã có (${plan.kept.join(', ')})`;
  }
  return plan;
}

export const planEnrichment = (rows: readonly EnrichProductInput[], opts: PlanOptions = {}): ProductPlan[] => rows.map((r) => planProduct(r, opts));

export interface EnrichSummary {
  total: number;
  byStatus: Record<PlanStatus, number>;
  byFamily: Partial<Record<CopyFamily, number>>;
  /** SKU đang bán có `storyConfig` NULL (thông tin, không ghi). */
  storyConfigNull: number;
  descriptionWrites: number;
  ingredientWrites: number;
  forced: number;
}

export function summarize(plans: readonly ProductPlan[]): EnrichSummary {
  const out: EnrichSummary = {
    total: plans.length,
    byStatus: { ENRICH: 0, COMPLETE: 0, NO_SOURCE: 0, BLOCKED_BY_GUARD: 0, EXCLUDED: 0 },
    byFamily: {},
    storyConfigNull: 0,
    descriptionWrites: 0,
    ingredientWrites: 0,
    forced: 0,
  };
  for (const p of plans) {
    out.byStatus[p.status] += 1;
    if (p.status === 'EXCLUDED') continue;
    out.byFamily[p.family] = (out.byFamily[p.family] ?? 0) + 1;
    if (p.storyConfigNull) out.storyConfigNull += 1;
    if (p.description) out.descriptionWrites += 1;
    if (p.ingredients) out.ingredientWrites += 1;
    if (p.description?.mode === 'FORCE' || p.ingredients?.mode === 'FORCE') out.forced += 1;
  }
  return out;
}

const cell = (s: string, width: number): string => (s.length > width ? `${s.slice(0, width - 1)}…` : s.padEnd(width));

/** Bảng chữ cho CLI: mỗi sản phẩm một dòng, không in nội dung mô tả. */
export function renderTable(plans: readonly ProductPlan[]): string {
  const rows = plans.filter((p) => p.status !== 'EXCLUDED');
  const head = `${cell('SLUG', 56)} ${cell('NHÓM', 15)} ${cell('TRẠNG THÁI', 16)} LÝ DO`;
  return [head, ...rows.map((p) => `${cell(p.slug, 56)} ${cell(COPY_FAMILY_LABELS[p.family], 15)} ${cell(p.status, 16)} ${p.reason}`)].join('\n');
}

export type EnrichStore = Pick<PrismaClient, 'product'>;

export async function loadHouseProducts(store: EnrichStore): Promise<EnrichProductInput[]> {
  return store.product.findMany({
    where: { storefrontId: null },
    orderBy: [{ slug: 'asc' }],
    select: { id: true, slug: true, name: true, isActive: true, approvalStatus: true, storefrontId: true, description: true, ingredients: true, storyConfig: true, updatedAt: true },
  });
}

export type ApplyStatus = 'APPLIED' | 'SKIPPED_CHANGED' | 'DRY_RUN';
export interface ApplyRow {
  slug: string;
  status: ApplyStatus;
}

/**
 * Ghi các dòng `ENRICH`. Không `apply` thì không đụng DB, chỉ trả `DRY_RUN`. UPDATE có điều kiện `updatedAt` đã đọc và `storefrontId: null`: ai sửa sản phẩm
 * giữa lúc đọc và lúc ghi (admin, Pancake) thì dòng đó bị bỏ qua (`SKIPPED_CHANGED`), chạy lại sẽ lập kế hoạch từ dữ liệu mới. Chạy lại sau khi đã ghi: mọi dòng là `COMPLETE`.
 */
export async function applyPlans(store: EnrichStore, rows: readonly EnrichProductInput[], plans: readonly ProductPlan[], opts: { apply: boolean }): Promise<ApplyRow[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ApplyRow[] = [];
  for (const plan of plans) {
    if (plan.status !== 'ENRICH') continue;
    if (!opts.apply) {
      out.push({ slug: plan.slug, status: 'DRY_RUN' });
      continue;
    }
    const row = byId.get(plan.id);
    if (!row) continue;
    const data: Prisma.ProductUpdateManyMutationInput = {};
    if (plan.description) data.description = plan.description.value;
    if (plan.ingredients) data.ingredients = plan.ingredients.value as unknown as Prisma.InputJsonValue;
    const written = await store.product.updateMany({ where: { id: plan.id, updatedAt: row.updatedAt, storefrontId: null }, data });
    out.push({ slug: plan.slug, status: written.count === 0 ? 'SKIPPED_CHANGED' : 'APPLIED' });
  }
  return out;
}

export interface CliArgs {
  apply: boolean;
  force: boolean;
}

/** `--dry-run` là mặc định. `--apply` mới ghi. `--force` cho phép đè chữ đã có (chỉ bằng chữ dự phòng có nguồn). Cờ lạ hoặc `--apply` cùng `--dry-run` là lỗi. */
export function parseCliArgs(argv: readonly string[]): { ok: true; value: CliArgs } | { ok: false; error: string } {
  const known = new Set(['--dry-run', '--apply', '--force']);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) return { ok: false, error: `Cờ không biết: ${unknown.join(' ')}. Chỉ nhận --dry-run, --apply, --force.` };
  if (argv.includes('--apply') && argv.includes('--dry-run')) return { ok: false, error: '--apply và --dry-run loại trừ nhau.' };
  return { ok: true, value: { apply: argv.includes('--apply'), force: argv.includes('--force') } };
}
