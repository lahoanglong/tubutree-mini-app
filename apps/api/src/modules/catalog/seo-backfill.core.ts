import type { PrismaClient } from '@prisma/client';
import { normalizeCopyText } from '@tubutree/shared-types';
import { checkIngredientsForSave } from '../ai-advisor/copy-draft';
import { ingredientNames } from './ingredient-names';
import { SEO_DESC_MAX, SEO_TITLE_MAX, draftSeo, isBlank, seoTextProblems, type SeoProductInput } from './seo-enrich.core';

/**
 * Lõi script backfill W160: điền `metaTitle`/`metaDesc` còn trống cho SP nhà đang bán, và thành phần THẬT cho SP chưa có.
 * Thành phần chỉ ghi khi có nguồn kiểm được: nhãn "Thành phần:" trong mô tả, hoặc danh sách người đã đọc từ bao bì (`--verified-file`).
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

export type IngredientSource = 'DESCRIPTION_LABEL' | 'VERIFIED_FILE';
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
  problems: string[];
}

const LABEL = /(?:thành phần|nguyên liệu|ingredients?)\s*[:：]\s*/iu;
const NO_LABEL = 'Mô tả không có nhãn "Thành phần:" hay "Nguyên liệu:".';

export type IngredientExtract = { ok: true; names: string[] } | { ok: false; reason: string };

/** Danh sách sau nhãn "Thành phần:", "Nguyên liệu:" hay "Ingredients:" đến hết dòng/câu. Vi phạm bộ chặn (công dụng, chứng nhận, phần trăm, quá 8 tên) thì từ chối cả danh sách. */
export function extractIngredientsFromText(text: string | null | undefined): IngredientExtract {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: 'Mô tả trống.' };
  const plain = normalizeCopyText(text);
  const found = LABEL.exec(plain);
  if (!found) return { ok: false, reason: NO_LABEL };
  const rest = plain.slice(found.index + found[0].length);
  const line = (rest.split('\n')[0] ?? '').split(/\.(?=\s|$)/)[0] ?? '';
  const raw = line
    .split(/[,;]/)
    .map((s) => s.trim().replace(/\.$/, '').trim())
    .filter((s) => s !== '');
  const check = checkIngredientsForSave(raw);
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

function planIngredients(p: BackfillProductInput, opts: PlanOptions): Pick<BackfillPlan, 'ingredients' | 'ingredientState' | 'ingredientReason'> {
  if (ingredientNames(p.ingredients).length > 0) return { ingredients: null, ingredientState: 'HAS', ingredientReason: '' };
  const fromFile = opts.verified?.[p.slug];
  if (fromFile) {
    const check = checkIngredientsForSave(fromFile);
    if (check.ok) return { ingredients: { names: check.value, source: 'VERIFIED_FILE' }, ingredientState: 'FILL', ingredientReason: '' };
    return { ingredients: null, ingredientState: 'UNRESOLVED', ingredientReason: `Danh sách đã xác minh bị chặn: ${check.reasons.join(' ')}` };
  }
  const fromText = extractIngredientsFromText(p.description);
  if (fromText.ok) return { ingredients: { names: fromText.names, source: 'DESCRIPTION_LABEL' }, ingredientState: 'FILL', ingredientReason: '' };
  return { ingredients: null, ingredientState: 'UNRESOLVED', ingredientReason: fromText.reason };
}

export function planProduct(p: BackfillProductInput, opts: PlanOptions = {}): BackfillPlan {
  const base = { id: p.id, slug: p.slug, name: p.name, thumbnail: p.thumbnail };
  if (!p.isActive || p.storefrontId !== null) {
    return { ...base, status: 'EXCLUDED', seo: null, seoEmptyAfter: false, ingredients: null, ingredientState: 'N/A', ingredientReason: '', problems: [] };
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
  unresolved: { slug: string; name: string; thumbnail: string | null; reason: string }[];
  blocked: { slug: string; problems: string[] }[];
}

export function summarizeBackfill(plans: readonly BackfillPlan[]): BackfillSummary {
  const active = plans.filter((p) => p.status !== 'EXCLUDED');
  return {
    activeTotal: active.length,
    seoWrites: active.filter((p) => p.seo !== null).length,
    ingredientWrites: active.filter((p) => p.ingredients !== null).length,
    emptySeoAfter: active.filter((p) => p.seoEmptyAfter).length,
    unresolved: active.filter((p) => p.ingredientState === 'UNRESOLVED').map((p) => ({ slug: p.slug, name: p.name, thumbnail: p.thumbnail, reason: p.ingredientReason })),
    blocked: plans.filter((p) => p.problems.length > 0).map((p) => ({ slug: p.slug, problems: p.problems })),
  };
}

export function renderReport(plans: readonly BackfillPlan[], s: BackfillSummary): string {
  const lines: string[] = [];
  lines.push(`Sản phẩm đang bán (nhà): ${s.activeTotal}`);
  lines.push(`Sẽ ghi SEO: ${s.seoWrites} SP. Sẽ ghi thành phần: ${s.ingredientWrites} SP. Còn trống SEO sau khi ghi: ${s.emptySeoAfter} SP.`);
  const fills = plans.filter((p) => p.ingredients !== null);
  if (fills.length > 0) {
    lines.push('\nThành phần SẼ ghi (nguồn):');
    for (const p of fills) lines.push(`  - ${p.slug} [${p.ingredients!.source}]: ${p.ingredients!.names.join(', ')}`);
  }
  if (s.unresolved.length > 0) {
    lines.push(`\n${s.unresolved.length} SP chưa có nguồn thành phần thật, GIỮ TRỐNG (hỏi nhãn hàng hoặc đọc bao bì):`);
    for (const u of s.unresolved) lines.push(`  - ${u.slug} | ${u.name} | ảnh: ${u.thumbnail ?? '(chưa có ảnh)'} | ${u.reason}`);
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
