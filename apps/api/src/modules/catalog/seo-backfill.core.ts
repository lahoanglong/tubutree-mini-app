import type { PrismaClient } from '@prisma/client';
import { normalizeCopyText } from '@tubutree/shared-types';
import { checkIngredientsForSave } from '../ai-advisor/copy-draft';
import { ingredientNames } from './ingredient-names';
import { foldVietnamese } from './search-text';
import { SEO_DESC_MAX, SEO_TITLE_MAX, draftSeo, isBlank, seoTextProblems, type SeoProductInput } from './seo-enrich.core';

/**
 * Lõi script backfill W160: điền `metaTitle`/`metaDesc` còn trống cho SP nhà đang bán, và thành phần THẬT cho SP chưa có.
 * Thành phần CHỈ ghi từ danh sách người đã đọc từ bao bì (`--verified-file`). Nhãn "Thành phần:" trong mô tả chỉ là gợi ý đưa vào báo cáo, không bao giờ ghi:
 * mô tả có thể do AI soạn, và đọc nhầm một đoạn văn thành danh sách thì trang bán hàng khai sai thành phần (kể cả chất gây dị ứng).
 * Không có nguồn thì để trống và báo cáo, không bao giờ đoán.
 */

export interface BackfillProductInput extends SeoProductInput {
  id: string;
  slug: string;
  isActive: boolean;
  storefrontId: string | null;
  ingredients: unknown;
  thumbnail: string | null;
  updatedAt: Date;
}

export type IngredientSource = 'VERIFIED_FILE';
export type IngredientState = 'HAS' | 'FILL' | 'UNRESOLVED' | 'N/A';
export type BackfillStatus = 'ENRICH' | 'COMPLETE' | 'BLOCKED' | 'EXCLUDED';

export interface BackfillPlan {
  id: string;
  slug: string;
  name: string;
  thumbnail: string | null;
  status: BackfillStatus;
  seo: { metaTitle?: string; metaDesc?: string } | null;
  /** Còn trống `metaTitle` hoặc `metaDesc` sau khi áp kế hoạch này (dòng bị chặn). */
  seoEmptyAfter: boolean;
  ingredients: { names: string[]; source: IngredientSource } | null;
  ingredientState: IngredientState;
  ingredientReason: string;
  /** Danh sách đọc được từ nhãn trong mô tả, CHƯA ghi; để người đối chiếu bao bì. */
  ingredientSuggestion: string[] | null;
  /** Chữ gốc của mô tả mà gợi ý lấy ra, để người duyệt đối chiếu. */
  ingredientEvidence: string;
  problems: string[];
}

const LABEL = /(?<![\p{L}\p{N}])(?:thành phần|nguyên liệu|ingredients?)[ \t]*[:：][ \t]*/iu;
const NO_LABEL = 'Mô tả không có nhãn "Thành phần:" hay "Nguyên liệu:".';
/** Chữ đứng ngay trước nhãn khiến danh sách sau nhãn KHÔNG phải thành phần đầy đủ: "không chứa …", "free of …", "key/main …". */
const NOT_THE_FULL_LIST = /(?:^|[^a-z])(?:khong (?:chua|co|dung|su dung|bao gom)|free of|free|without|no|key|main|active|top|chinh|noi bat)\s*$/;
const PLACEHOLDER = /^(?:xem |dang cap nhat|chua co|updating|n a$)|bao bi/;
const BULLET = /^[-–—•*·]|\s[-–—•]\s/;
const NAME_WORDS_MAX = 5;

/** Tách ở dấu phẩy/chấm phẩy ngoài ngoặc; ngoặc không khớp thì `null` (danh sách đã bị cắt hoặc hỏng). */
function splitTopLevel(line: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of line) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth < 0) return null;
    if ((ch === ',' || ch === ';') && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (depth !== 0) return null;
  parts.push(cur);
  return parts;
}

function suspiciousName(name: string): string | null {
  if (name.includes(':')) return `"${name}" có dấu ":" (dính chữ khác sau danh sách).`;
  if (BULLET.test(name)) return `"${name}" có gạch đầu dòng dính liền.`;
  if (PLACEHOLDER.test(foldVietnamese(name).replace(/[^a-z0-9]+/g, ' ').trim())) return `"${name}" là chữ giữ chỗ, không phải tên thành phần.`;
  if (name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length > NAME_WORDS_MAX) return `"${name}" dài như một câu văn, không phải tên thành phần.`;
  return null;
}

export type IngredientExtract = { ok: true; names: string[] } | { ok: false; reason: string };

/**
 * Danh sách sau nhãn "Thành phần:", "Nguyên liệu:" hay "Ingredients:" trên CÙNG dòng đến hết câu. Từ chối cả danh sách khi: nhãn đứng riêng một dòng, danh sách chưa hết ("…"),
 * đứng sau "không chứa/free of/key", ngoặc lệch, tên giống câu văn/chữ giữ chỗ/gạch đầu dòng, hoặc vi phạm bộ chặn (công dụng, chứng nhận, phần trăm, quá 8 tên).
 */
export function extractIngredientsFromText(text: string | null | undefined): IngredientExtract {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: 'Mô tả trống.' };
  const plain = normalizeCopyText(text);
  const found = LABEL.exec(plain);
  if (!found) return { ok: false, reason: NO_LABEL };

  const before = foldVietnamese(plain.slice(Math.max(0, found.index - 30), found.index)).toLowerCase();
  if (NOT_THE_FULL_LIST.test(before)) return { ok: false, reason: 'Nhãn nằm sau "không chứa/free of/key…", không phải danh sách thành phần đầy đủ.' };

  const rest = plain.slice(found.index + found[0].length);
  if (rest === '' || rest.startsWith('\n')) return { ok: false, reason: 'Nhãn đứng riêng một dòng, danh sách nằm ở dòng dưới nên không đọc chắc được.' };
  const line = rest.split('\n')[0] ?? '';
  if (/\.{2,}|…/.test(line)) return { ok: false, reason: 'Danh sách chưa hết ("…").' };

  const parts = splitTopLevel(line.split(/\.(?=\s|$)/)[0] ?? '');
  if (parts === null) return { ok: false, reason: 'Ngoặc không khớp, danh sách có thể bị cắt.' };
  const names = parts.map((s) => s.trim().replace(/\.$/, '').trim()).filter((s) => s !== '');
  for (const name of names) {
    const why = suspiciousName(name);
    if (why) return { ok: false, reason: why };
  }
  const check = checkIngredientsForSave(names);
  return check.ok ? { ok: true, names: check.value } : { ok: false, reason: check.reasons.join(' ') };
}

export type VerifiedIngredients = Readonly<Record<string, readonly string[]>>;

export function parseVerifiedIngredients(text: string): { ok: true; value: Record<string, string[]> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'File thành phần đã xác minh không phải JSON hợp lệ.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, error: 'File thành phần đã xác minh phải là đối tượng {"<slug>": ["tên", ...]}.' };
  const value: Record<string, string[]> = {};
  for (const [slug, names] of Object.entries(parsed)) {
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) return { ok: false, error: `"${slug}": giá trị phải là mảng chuỗi.` };
    value[slug] = names as string[];
  }
  return { ok: true, value };
}

export interface BackfillArgs {
  apply: boolean;
  verifiedFile: string | null;
}

export function parseBackfillArgs(argv: readonly string[]): { ok: true; value: BackfillArgs } | { ok: false; error: string } {
  let apply = false;
  let dry = false;
  let verifiedFile: string | null = null;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') dry = true;
    else if (arg.startsWith('--verified-file=')) {
      verifiedFile = arg.slice('--verified-file='.length);
      if (verifiedFile === '') return { ok: false, error: '--verified-file cần đường dẫn (dùng "-" để đọc từ stdin).' };
    } else return { ok: false, error: `Cờ không hỗ trợ: ${arg}. Dùng --dry-run (mặc định), --apply, --verified-file=<đường dẫn|->.` };
  }
  if (apply && dry) return { ok: false, error: '--dry-run và --apply mâu thuẫn nhau.' };
  return { ok: true, value: { apply, verifiedFile } };
}

export interface PlanOptions {
  verified?: VerifiedIngredients;
}

type IngredientPlan = Pick<BackfillPlan, 'ingredients' | 'ingredientState' | 'ingredientReason' | 'ingredientSuggestion' | 'ingredientEvidence'>;
const NO_SUGGESTION = { ingredientSuggestion: null, ingredientEvidence: '' } as const;
const EVIDENCE_MAX = 300;

function planIngredients(p: BackfillProductInput, opts: PlanOptions): IngredientPlan {
  if (ingredientNames(p.ingredients).length > 0) return { ingredients: null, ingredientState: 'HAS', ingredientReason: '', ...NO_SUGGESTION };
  const fromFile = opts.verified?.[p.slug];
  if (fromFile) {
    const check = checkIngredientsForSave(fromFile);
    if (check.ok) return { ingredients: { names: check.value, source: 'VERIFIED_FILE' }, ingredientState: 'FILL', ingredientReason: '', ...NO_SUGGESTION };
    return { ingredients: null, ingredientState: 'UNRESOLVED', ingredientReason: `Danh sách đã xác minh bị chặn: ${check.reasons.join(' ')}`, ...NO_SUGGESTION };
  }
  const fromText = extractIngredientsFromText(p.description);
  if (fromText.ok) {
    const evidence = normalizeCopyText(p.description ?? '').replace(/\s+/g, ' ').slice(0, EVIDENCE_MAX);
    return { ingredients: null, ingredientState: 'UNRESOLVED', ingredientReason: 'Chỉ có gợi ý từ mô tả, chưa đối chiếu bao bì nên KHÔNG ghi.', ingredientSuggestion: fromText.names, ingredientEvidence: evidence };
  }
  return { ingredients: null, ingredientState: 'UNRESOLVED', ingredientReason: fromText.reason, ...NO_SUGGESTION };
}

export function planProduct(p: BackfillProductInput, opts: PlanOptions = {}): BackfillPlan {
  const base = { id: p.id, slug: p.slug, name: p.name, thumbnail: p.thumbnail };
  if (!p.isActive || p.storefrontId !== null) {
    return { ...base, status: 'EXCLUDED', seo: null, seoEmptyAfter: false, ingredients: null, ingredientState: 'N/A', ingredientReason: '', ...NO_SUGGESTION, problems: [] };
  }

  const missingTitle = isBlank(p.metaTitle);
  const missingDesc = isBlank(p.metaDesc);
  let seo: BackfillPlan['seo'] = null;
  const problems: string[] = [];
  if (missingTitle || missingDesc) {
    const draft = draftSeo(p, { onlyMissing: true });
    const found = [
      ...(missingTitle ? seoTextProblems('Tiêu đề SEO', draft.metaTitle, SEO_TITLE_MAX) : []),
      ...(missingDesc ? seoTextProblems('Mô tả SEO', draft.metaDesc, SEO_DESC_MAX) : []),
    ];
    if (found.length > 0) problems.push(...found);
    else seo = { ...(missingTitle ? { metaTitle: draft.metaTitle } : {}), ...(missingDesc ? { metaDesc: draft.metaDesc } : {}) };
  }

  const ing = planIngredients(p, opts);
  const writes = seo !== null || ing.ingredients !== null;
  const status: BackfillStatus = writes ? 'ENRICH' : problems.length > 0 ? 'BLOCKED' : 'COMPLETE';
  return { ...base, status, seo, seoEmptyAfter: (missingTitle || missingDesc) && seo === null, problems, ...ing };
}

export const planBackfill = (rows: readonly BackfillProductInput[], opts: PlanOptions = {}): BackfillPlan[] => rows.map((r) => planProduct(r, opts));

export interface BackfillSummary {
  activeTotal: number;
  seoWrites: number;
  ingredientWrites: number;
  emptySeoAfter: number;
  unresolved: { slug: string; name: string; thumbnail: string | null; reason: string; suggestion: string[] | null; evidence: string }[];
  blocked: { slug: string; problems: string[] }[];
}

export function summarizeBackfill(plans: readonly BackfillPlan[]): BackfillSummary {
  const active = plans.filter((p) => p.status !== 'EXCLUDED');
  return {
    activeTotal: active.length,
    seoWrites: active.filter((p) => p.seo !== null).length,
    ingredientWrites: active.filter((p) => p.ingredients !== null).length,
    emptySeoAfter: active.filter((p) => p.seoEmptyAfter).length,
    unresolved: active.filter((p) => p.ingredientState === 'UNRESOLVED').map((p) => ({ slug: p.slug, name: p.name, thumbnail: p.thumbnail, reason: p.ingredientReason, suggestion: p.ingredientSuggestion, evidence: p.ingredientEvidence })),
    blocked: plans.filter((p) => p.problems.length > 0).map((p) => ({ slug: p.slug, problems: p.problems })),
  };
}

export function renderReport(plans: readonly BackfillPlan[], s: BackfillSummary): string {
  const lines: string[] = [];
  lines.push(`Sản phẩm đang bán (nhà): ${s.activeTotal}`);
  lines.push(`Sẽ ghi SEO: ${s.seoWrites} SP. Sẽ ghi thành phần: ${s.ingredientWrites} SP. Còn trống SEO sau khi ghi: ${s.emptySeoAfter} SP.`);
  const fills = plans.filter((p) => p.ingredients !== null);
  if (fills.length > 0) {
    lines.push('\nThành phần SẼ ghi (từ file đã xác minh):');
    for (const p of fills) lines.push(`  - ${p.slug} [${p.ingredients!.source}]: ${p.ingredients!.names.join(', ')}`);
  }
  if (s.unresolved.length > 0) {
    lines.push(`\n${s.unresolved.length} SP chưa có nguồn thành phần thật, GIỮ TRỐNG (hỏi nhãn hàng hoặc đọc bao bì):`);
    for (const u of s.unresolved) {
      lines.push(`  - ${u.slug} | ${u.name} | ảnh: ${u.thumbnail ?? '(chưa có ảnh)'} | ${u.reason}`);
      if (u.suggestion) lines.push(`      gợi ý từ mô tả (CHƯA ghi): ${u.suggestion.join(', ')}\n      chữ gốc: "${u.evidence}"`);
    }
  }
  if (s.blocked.length > 0) {
    lines.push(`\n${s.blocked.length} SP bị chặn không ghi SEO:`);
    for (const b of s.blocked) lines.push(`  - ${b.slug}: ${b.problems.join(' ')}`);
  }
  return lines.join('\n');
}

export type BackfillStore = Pick<PrismaClient, 'product'>;

export async function loadBackfillRows(store: BackfillStore): Promise<BackfillProductInput[]> {
  return store.product.findMany({
    where: { storefrontId: null, isActive: true },
    orderBy: [{ slug: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      brand: true,
      shortDesc: true,
      description: true,
      metaTitle: true,
      metaDesc: true,
      isActive: true,
      storefrontId: true,
      ingredients: true,
      thumbnail: true,
      updatedAt: true,
      variations: { select: { name: true, isActive: true } },
    },
  });
}

export type ApplyStatus = 'APPLIED' | 'SKIPPED_CHANGED' | 'DRY_RUN';
export interface ApplyRow {
  slug: string;
  status: ApplyStatus;
}

/**
 * Ghi các dòng `ENRICH`. Không `apply` thì không đụng DB. UPDATE có điều kiện `updatedAt` đã đọc, `storefrontId: null` và `isActive`: ai sửa SP xen giữa (admin, Pancake)
 * thì dòng đó `SKIPPED_CHANGED`, chạy lại sẽ lập kế hoạch từ dữ liệu mới. Chỉ ghi trường nằm trong kế hoạch nên không bao giờ đè SEO hay thành phần đã có.
 */
export async function applyBackfill(store: BackfillStore, rows: readonly BackfillProductInput[], plans: readonly BackfillPlan[], opts: { apply: boolean }): Promise<ApplyRow[]> {
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
    const data: { metaTitle?: string; metaDesc?: string; ingredients?: { name: string }[] } = {};
    if (plan.seo?.metaTitle !== undefined) data.metaTitle = plan.seo.metaTitle;
    if (plan.seo?.metaDesc !== undefined) data.metaDesc = plan.seo.metaDesc;
    if (plan.ingredients) data.ingredients = plan.ingredients.names.map((name) => ({ name }));
    const written = await store.product.updateMany({ where: { id: plan.id, updatedAt: row.updatedAt, storefrontId: null, isActive: true }, data });
    out.push({ slug: plan.slug, status: written.count === 0 ? 'SKIPPED_CHANGED' : 'APPLIED' });
  }
  return out;
}
