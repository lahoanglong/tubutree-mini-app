/**
 * Dựng sẵn bản nháp `storyConfig` (enabled:false) và ảnh bao bì tách nền cho 4 sản phẩm chủ lực đợt đầu (W161):
 * Sokfarm, BH.NONG, PƠ LANG, Fuwa3e 3,8L (docs/product-story-Rollout-Plan.md mục 4).
 *
 * Dùng (từ apps/api, cần DATABASE_URL của DB đích):
 *   npx tsx ../../scripts/ops/seed-flagship-story-drafts.ts                # DRY-RUN (mặc định): tính ảnh tách nền, KHÔNG ghi DB
 *   npx tsx ../../scripts/ops/seed-flagship-story-drafts.ts --apply        # GHI
 *   thêm --force-draft để ghi đè storyConfig đã có (mặc định bỏ qua sản phẩm đã có storyConfig do người dùng lưu)
 *   Test: npx tsx --test ../../scripts/ops/seed-flagship-story-drafts.spec.ts
 *
 * An toàn:
 * - Mọi bản nháp ghi ra có enabled=false: resolveStoryConfig trả null cho cấu hình tắt nên khách chưa thấy gì cho tới khi admin mở Story Studio, xem thử và bật.
 * - Idempotent: sản phẩm đã có storyConfig bị bỏ qua. Ghi một lần, có điều kiện (ảnh và storyConfig chưa đổi từ lúc đọc), nên không đè lên lượt đồng bộ Pancake chen giữa.
 * - Chữ kịch bản là chữ của `LAUNCH_STORY_PRESETS` (đã kiểm với bao bì); mỗi bản nháp phải qua `storyDraftProblems` (0 từ cấm, 0 `[object Object]`) mới được ghi.
 * - Ảnh nguồn chỉ tải từ content.pancake.vn (hoặc data URL có sẵn trong sản phẩm), qua https, giới hạn dung lượng.
 *
 * Giới hạn đã biết (đọc trước khi chạy PROD):
 * - Ảnh tách nền nằm trong `products.images` (kho upload chuẩn, phát qua /public-image). Đồng bộ Pancake (15 phút một lần với sản phẩm đổi, 03:37 hằng đêm với tất cả)
 *   ghi lại `images` từ Pancake, nên ảnh tách nền của sản phẩm do Pancake quản lý có thể mất ở lượt đồng bộ kế tiếp; khi đó `cutoutUrl` trỏ vào ô trống.
 * - Thuật toán chỉ tách nền SÁNG nối với mép (cùng `cutoutWhite` của máy chủ). Ảnh poster PROD có nền màu hoặc ảnh chụp bối cảnh (BH.NONG, Fuwa3e) không tách được,
 *   nên chỉ Sokfarm và PƠ LANG có công thức ảnh; hai sản phẩm kia vẫn nhận bản nháp nhưng không có `cutoutUrl` (cần ảnh bao bì nền trắng từ nhãn hàng).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveStoryConfig } from '../../packages/app-core/src/commerce/product-story';
import { findStoryPreset, storyDraftProblems } from '../../packages/app-core/src/commerce/story-presets-launch';
import type { ProductStoryConfig } from '../../packages/shared-types/src/product-story';

export const CUTOUT_MAX_BYTES = 150 * 1024;
export const CUTOUT_MAX_EDGE = 1200;
/** Ô ảnh cao nhất mà /public-image/product/:id/:slot phát (apps/api/src/modules/catalog/public-image.service.ts: `n > 20` là 404). */
export const PUBLIC_IMAGE_MAX_SLOT = 20;
const MIN_REMOVED_PCT = 10;
const MAX_RING_OPAQUE = 0.02;
const SOURCE_MAX_BYTES = 12 * 1024 * 1024;
const SOURCE_MAX_PIXELS = 50_000_000;
const SOURCE_HOST = 'content.pancake.vn';
const OWN_SLOT = /^\/public-image\/product\/[A-Za-z0-9_-]{1,64}\/(\d{1,2})(?:\?|$)/;

export interface RoiRatio {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CutoutRecipe {
  /** Mã tệp (băm trong đường dẫn Pancake) của ảnh nguồn đã duyệt bằng mắt; tìm theo mã chứ không theo vị trí vì danh sách ảnh có ảnh trùng. */
  sourceFile: string;
  /** Vùng bên trong khung poster, tỉ lệ 0..1 so với ảnh gốc. */
  roi: RoiRatio;
  /** Độ lệch so với trắng tinh, 0..60 (ngưỡng = 255 − độ lệch), như thanh trong Story Studio. */
  tolerance: number;
}
export interface Flagship {
  slug: string;
  recipes: CutoutRecipe[];
  note: string;
}

/** Công thức chọn tay sau khi xem ảnh PROD ngày 14/11/2026; ảnh nguồn nền trắng hoặc xám nhạt mới có công thức. */
export const FLAGSHIP: readonly Flagship[] = [
  {
    slug: 'duong-hoa-dua-sokfarm-d6c685',
    recipes: [{ sourceFile: 'f7e5b05bf2e2a3a74162f6520557208aa66df676', roi: { x: 0.06, y: 0.12, width: 0.88, height: 0.84 }, tolerance: 20 }],
    note: 'Ảnh đầu: bao trên nền trắng, bỏ khung xanh rêu và băng Tubu Tree ở trên.',
  },
  {
    slug: 'banh-mam-hat-yen-mach-bh-nong-ec5325',
    recipes: [],
    note: 'Mọi ảnh PROD là ảnh chụp bối cảnh hoặc poster chữ, không có ảnh nền trắng chỉ có sản phẩm. Cần ảnh bao bì nền trắng từ nhãn hàng.',
  },
  {
    slug: 'dau-rua-mat-po-lang-100ml-55ml-8478ee',
    recipes: [{ sourceFile: 'caa7a9bb93635c0f86299afceb80ad03cf288fff', roi: { x: 0.3, y: 0.18, width: 0.4, height: 0.72 }, tolerance: 40 }],
    note: 'Ảnh thứ hai: một chai trên nền xám nhạt, cần độ lệch 40 vì nền chuyển sắc.',
  },
  {
    slug: 'nuoc-rua-chen-fuwa3e-3-8l-ef3979',
    recipes: [],
    note: 'Ảnh có can nền cam hoặc ảnh bếp; thuật toán nền sáng xoá nhầm thân can trắng. Cần ảnh bao bì nền trắng từ nhãn hàng.',
  },
];

export interface Args {
  apply: boolean;
  forceDraft: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  let apply = false;
  let dry = false;
  let forceDraft = false;
  for (const a of argv) {
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') dry = true;
    else if (a === '--force-draft') forceDraft = true;
    else throw new Error(`cờ lạ: ${a} (chỉ có --dry-run, --apply, --force-draft)`);
  }
  if (apply && dry) throw new Error('--dry-run và --apply mâu thuẫn nhau');
  return { apply, forceDraft };
}

/** Nạp một gói của apps/api (sharp, @prisma/client): script nằm ngoài apps/api nên không tự resolve được gói của nó. */
export function loadFromApi(name: string): unknown {
  const cwd = process.cwd();
  const bases = [path.join(cwd, 'apps/api/package.json'), path.join(cwd, 'package.json')];
  if (typeof __dirname === 'string') bases.push(path.join(__dirname, '../../apps/api/package.json'));
  let last: unknown;
  for (const base of bases) {
    try {
      return createRequire(base)(name);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`không nạp được "${name}" từ apps/api (chạy từ thư mục apps/api và đã pnpm install): ${String(last)}`);
}

export type CutoutResult = { ok: true; dataUrl: string; width: number; height: number; bytes: number; removedPct: number } | { ok: false; reason: string };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Cắt `roi`, tách nền sáng nối với mép (loang 4 hướng, cùng thuật toán `cutoutWhite` và `cutoutLight` của Story Studio), cắt sát sản phẩm,
 * thu cạnh dài về ≤1200px, mã hoá WebP trong suốt ≤150KB. Từ chối (ok:false, có lý do) khi nền không tách được hoặc sản phẩm chạm mép khung cắt.
 */
export async function renderCutout(source: Buffer, recipe: Pick<CutoutRecipe, 'roi' | 'tolerance'>): Promise<CutoutResult> {
  try {
    const sharp = loadFromApi('sharp') as typeof import('sharp');
    const meta = await sharp(source, { limitInputPixels: SOURCE_MAX_PIXELS }).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (W < 2 || H < 2) return { ok: false, reason: 'không đọc được kích thước ảnh nguồn' };
    const left = clamp(Math.round(recipe.roi.x * W), 0, W - 1);
    const top = clamp(Math.round(recipe.roi.y * H), 0, H - 1);
    const rect = { left, top, width: clamp(Math.round(recipe.roi.width * W), 1, W - left), height: clamp(Math.round(recipe.roi.height * H), 1, H - top) };
    const { data, info } = await sharp(source, { limitInputPixels: SOURCE_MAX_PIXELS }).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const total = width * height;
    const light = 255 - clamp(Math.round(recipe.tolerance), 0, 60);
    const isBackground = (p: number) => {
      const i = p * 4;
      return (data[i + 3] ?? 255) < 16 || ((data[i] ?? 0) >= light && (data[i + 1] ?? 0) >= light && (data[i + 2] ?? 0) >= light);
    };
    const seen = new Uint8Array(total);
    const stack = new Int32Array(total);
    let sp = 0;
    let removed = 0;
    const push = (p: number) => {
      if (seen[p] || !isBackground(p)) return;
      seen[p] = 1;
      stack[sp++] = p;
    };
    for (let x = 0; x < width; x++) {
      push(x);
      push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      push(y * width);
      push(y * width + width - 1);
    }
    while (sp > 0) {
      const p = stack[--sp] as number;
      const x = p % width;
      data[p * 4 + 3] = 0;
      removed++;
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (p >= width) push(p - width);
      if (p < width * (height - 1)) push(p + width);
    }
    const removedPct = (removed / total) * 100;
    if (removedPct < MIN_REMOVED_PCT) {
      return { ok: false, reason: `nền không tách được (chỉ ${removedPct.toFixed(1)}% điểm ảnh nền nối với mép): ảnh nguồn không có nền sáng quanh sản phẩm` };
    }
    let ring = 0;
    let ringOpaque = 0;
    const tally = (p: number) => {
      ring++;
      if (!seen[p]) ringOpaque++;
    };
    for (let x = 0; x < width; x++) {
      tally(x);
      tally((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      tally(y * width);
      tally(y * width + width - 1);
    }
    if (ringOpaque / ring > MAX_RING_OPAQUE) {
      return { ok: false, reason: `sản phẩm chạm mép khung cắt (${((ringOpaque / ring) * 100).toFixed(1)}% viền còn đặc): khung quá chặt hoặc nền không phải màu sáng` };
    }
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return { ok: false, reason: 'không còn điểm ảnh nào của sản phẩm sau khi tách nền' };
    const pad = Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * 0.02);
    const cx0 = Math.max(0, minX - pad);
    const cy0 = Math.max(0, minY - pad);
    const cw = Math.min(width, maxX + pad + 1) - cx0;
    const ch = Math.min(height, maxY + pad + 1) - cy0;
    const trimmed = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) data.copy(trimmed, y * cw * 4, ((cy0 + y) * width + cx0) * 4, ((cy0 + y) * width + cx0 + cw) * 4);

    let edge = Math.min(CUTOUT_MAX_EDGE, Math.max(cw, ch));
    for (let round = 0; round < 10; round++) {
      for (const quality of [85, 75, 65, 55, 45]) {
        const out = await sharp(trimmed, { raw: { width: cw, height: ch, channels: 4 } })
          .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
          .webp({ quality, alphaQuality: 90, effort: 4 })
          .toBuffer({ resolveWithObject: true });
        if (out.data.length <= CUTOUT_MAX_BYTES) {
          return { ok: true, dataUrl: `data:image/webp;base64,${out.data.toString('base64')}`, width: out.info.width, height: out.info.height, bytes: out.data.length, removedPct };
        }
      }
      edge = Math.floor(edge * 0.85);
      if (edge < 64) break;
    }
    return { ok: false, reason: `ảnh sau khi cắt vẫn nặng hơn ${CUTOUT_MAX_BYTES / 1024}KB dù đã thu nhỏ` };
  } catch (e) {
    return { ok: false, reason: `không xử lý được ảnh nguồn: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Ảnh nguồn đã duyệt: URL trong `images` chứa mã tệp; null khi sản phẩm không còn ảnh đó (Pancake đổi ảnh). */
export function pickSource(images: readonly string[], sourceFile: string): string | null {
  return images.find((u) => u.includes(sourceFile)) ?? null;
}

/**
 * Chọn ô cho ảnh tách nền trong `products.images`, chỉ trong ô phát được (≤20). Thứ tự: ô cũ của chính ảnh tách nền (`reuseSlot`, còn là ảnh data), nối cuối khi còn chỗ,
 * thay một ảnh TRÙNG với ảnh trước nó (ô cao nhất ≤20, ví dụ BH.NONG có 36 ảnh là ba lần lặp 12 ảnh); không có chỗ an toàn thì null. Không bao giờ làm mất ảnh duy nhất.
 */
export function placeCutout(images: readonly string[], dataUrl: string, reuseSlot?: number): { images: string[]; slot: number } | null {
  const next = [...images];
  if (reuseSlot !== undefined && reuseSlot >= 0 && reuseSlot <= PUBLIC_IMAGE_MAX_SLOT && next[reuseSlot]?.startsWith('data:image/')) {
    next[reuseSlot] = dataUrl;
    return { images: next, slot: reuseSlot };
  }
  if (next.length <= PUBLIC_IMAGE_MAX_SLOT) {
    next.push(dataUrl);
    return { images: next, slot: next.length - 1 };
  }
  for (let i = Math.min(PUBLIC_IMAGE_MAX_SLOT, next.length - 1); i >= 1; i--) {
    if (next.indexOf(next[i] as string) < i) {
      next[i] = dataUrl;
      return { images: next, slot: i };
    }
  }
  return null;
}

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  brand: string;
  shortDesc: string | null;
  certifications: string[];
  ingredients: unknown;
  images: string[];
  storyConfig: unknown;
  variations: { id: string; name: string; attributes: unknown }[];
}
export interface WriteInput {
  id: string;
  /** `images` như lúc đọc: chỉ ghi khi DB vẫn đúng như vậy. */
  expectImages: string[];
  images: string[];
  storyConfig: ProductStoryConfig;
  /** true (--force-draft): ghi dù đã có storyConfig; false: chỉ ghi khi storyConfig vẫn NULL. */
  overwrite: boolean;
}
export interface Deps {
  find(slug: string): Promise<ProductRow | null>;
  loadImage(ref: string): Promise<Buffer>;
  /** Ghi có điều kiện; false khi sản phẩm đã đổi giữa lúc đọc và lúc ghi. */
  write(w: WriteInput): Promise<boolean>;
  log(line: string): void;
}
export type OutcomeStatus = 'DRY_RUN' | 'APPLIED' | 'SKIPPED' | 'FAILED' | 'NOT_FOUND';
export interface Outcome {
  slug: string;
  status: OutcomeStatus;
  reason?: string;
  cutout: 'OK' | 'NO_CUTOUT' | 'NONE';
  cutoutReason?: string;
  slot?: number;
  bytes?: number;
}

function buildDraft(row: ProductRow): ProductStoryConfig | null {
  if (!findStoryPreset(row.slug)) return null;
  const resolved = resolveStoryConfig({
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    shortDesc: row.shortDesc,
    certifications: row.certifications,
    ingredients: row.ingredients,
    variations: row.variations,
    storyConfig: null,
  });
  return resolved ? { ...resolved, enabled: false } : null;
}

function ownSlot(config: unknown): number | undefined {
  const url = (config as { cutoutUrl?: unknown } | null)?.cutoutUrl;
  const m = typeof url === 'string' ? OWN_SLOT.exec(url) : null;
  return m ? Number(m[1]) : undefined;
}

export async function seedDrafts(deps: Deps, args: Args): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const fl of FLAGSHIP) {
    const out = await seedOne(deps, args, fl);
    deps.log(`  ${fl.slug}: ${out.status}${out.reason ? ` — ${out.reason}` : ''} | ảnh tách nền: ${out.cutout}${out.cutoutReason ? ` (${out.cutoutReason})` : ''}${out.slot !== undefined ? ` ô #${out.slot}, ${Math.round((out.bytes ?? 0) / 1024)}KB` : ''}`);
    outcomes.push(out);
  }
  return outcomes;
}

async function seedOne(deps: Deps, args: Args, fl: Flagship): Promise<Outcome> {
  const row = await deps.find(fl.slug);
  if (!row) return { slug: fl.slug, status: 'NOT_FOUND', reason: 'không có sản phẩm này trong DB', cutout: 'NONE' };
  if (row.storyConfig !== null && row.storyConfig !== undefined && !args.forceDraft) {
    return { slug: fl.slug, status: 'SKIPPED', reason: 'đã có storyConfig (người dùng đã lưu), dùng --force-draft để ghi đè', cutout: 'NONE' };
  }
  const draft = buildDraft(row);
  if (!draft) return { slug: fl.slug, status: 'FAILED', reason: 'không dựng được kịch bản từ mẫu findStoryPreset', cutout: 'NONE' };

  let cutout: Outcome['cutout'] = 'NO_CUTOUT';
  let cutoutReason: string | undefined = fl.recipes.length === 0 ? `chưa có công thức: ${fl.note}` : undefined;
  let images = row.images;
  let cutoutUrl: string | undefined;
  let slot: number | undefined;
  let bytes: number | undefined;
  const reuse = args.forceDraft ? ownSlot(row.storyConfig) : undefined;
  for (const recipe of fl.recipes) {
    const ref = pickSource(row.images, recipe.sourceFile);
    if (!ref) {
      cutoutReason = 'ảnh nguồn đã duyệt không còn trong sản phẩm (Pancake đổi ảnh?)';
      continue;
    }
    let buf: Buffer;
    try {
      buf = await deps.loadImage(ref);
    } catch (e) {
      cutoutReason = `không tải được ảnh nguồn: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }
    const r = await renderCutout(buf, recipe);
    if (!r.ok) {
      cutoutReason = r.reason;
      continue;
    }
    const placed = placeCutout(row.images, r.dataUrl, reuse);
    if (!placed) {
      cutoutReason = `không còn ô ảnh ≤${PUBLIC_IMAGE_MAX_SLOT} an toàn (sản phẩm có ${row.images.length} ảnh, không ảnh nào trùng)`;
      continue;
    }
    images = placed.images;
    slot = placed.slot;
    bytes = r.bytes;
    cutoutUrl = `/public-image/product/${row.id}/${placed.slot}`;
    cutout = 'OK';
    cutoutReason = undefined;
    break;
  }

  const config: ProductStoryConfig = { ...draft, enabled: false, ...(cutoutUrl ? { cutoutUrl } : {}) };
  const problems = storyDraftProblems(config);
  if (problems.length > 0) return { slug: fl.slug, status: 'FAILED', reason: `kiểm chữ không qua: ${problems.join('; ')}`, cutout, cutoutReason };
  const base = { slug: fl.slug, cutout, ...(cutoutReason ? { cutoutReason } : {}), ...(slot !== undefined ? { slot, bytes } : {}) };
  if (!args.apply) return { ...base, status: 'DRY_RUN', reason: 'chưa ghi (dry-run)' };
  const ok = await deps.write({ id: row.id, expectImages: row.images, images, storyConfig: config, overwrite: args.forceDraft });
  if (!ok) return { ...base, status: 'FAILED', reason: 'sản phẩm đổi giữa chừng (ảnh hoặc storyConfig), không ghi gì; chạy lại' };
  return { ...base, status: 'APPLIED' };
}

async function fetchSource(ref: string): Promise<Buffer> {
  if (ref.startsWith('data:image/')) {
    const comma = ref.indexOf(',');
    if (comma < 0) throw new Error('data URL hỏng');
    return Buffer.from(ref.slice(comma + 1), 'base64');
  }
  const u = new URL(ref);
  if (u.protocol !== 'https:' || u.hostname !== SOURCE_HOST) throw new Error(`chỉ tải ảnh từ https://${SOURCE_HOST}, gặp ${u.protocol}//${u.hostname}`);
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > SOURCE_MAX_BYTES) throw new Error(`ảnh nguồn ${len} byte vượt trần ${SOURCE_MAX_BYTES}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > SOURCE_MAX_BYTES) throw new Error(`ảnh nguồn ${buf.length} byte vượt trần ${SOURCE_MAX_BYTES}`);
  return buf;
}

function dbTarget(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(không đọc được DATABASE_URL)';
  }
}

async function main() {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
    return;
  }
  const { PrismaClient, Prisma } = loadFromApi('@prisma/client') as typeof import('@prisma/client');
  const prisma = new PrismaClient();
  console.log(`\n=== BẢN NHÁP STORY 4 SẢN PHẨM CHỦ LỰC ${args.apply ? '(APPLY — sẽ ghi DB)' : '(DRY-RUN — chỉ xem)'}${args.forceDraft ? ' +force-draft' : ''} ===`);
  console.log(`DB đích: ${dbTarget()}\n`);
  const deps: Deps = {
    find: async (slug) => {
      const p = await prisma.product.findFirst({
        where: { slug },
        select: {
          id: true,
          slug: true,
          name: true,
          brand: true,
          shortDesc: true,
          certifications: true,
          ingredients: true,
          images: true,
          storyConfig: true,
          variations: { where: { isActive: true }, orderBy: [{ retailPrice: 'asc' }, { sku: 'asc' }, { id: 'asc' }], select: { id: true, name: true, attributes: true } },
        },
      });
      return p as ProductRow | null;
    },
    loadImage: fetchSource,
    write: async (w) => {
      const r = await prisma.product.updateMany({
        where: { id: w.id, images: { equals: w.expectImages }, ...(w.overwrite ? {} : { storyConfig: { equals: Prisma.DbNull } }) },
        data: { images: { set: w.images }, storyConfig: w.storyConfig as unknown as Prisma.InputJsonValue },
      });
      return r.count === 1;
    },
    log: (l) => console.log(l),
  };
  try {
    const outcomes = await seedDrafts(deps, args);
    const count = (s: OutcomeStatus) => outcomes.filter((o) => o.status === s).length;
    console.log(`\nTổng: ${count('APPLIED')} đã ghi, ${count('DRY_RUN')} dry-run, ${count('SKIPPED')} bỏ qua, ${count('NOT_FOUND')} không thấy, ${count('FAILED')} lỗi.`);
    console.log(`Ảnh tách nền: ${outcomes.filter((o) => o.cutout === 'OK').length}/${outcomes.length} sản phẩm.`);
    if (!args.apply) console.log('DRY-RUN: chưa ghi gì. Chạy lại với --apply để ghi.');
    else console.log('Ảnh API phát ra có thể cũ tối đa 5 phút (bộ nhớ đệm); khởi động lại API để thấy ngay.');
    if (count('FAILED') > 0 || count('NOT_FOUND') > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('seed-flagship-story-drafts.ts') || entry.endsWith('seed-flagship-story-drafts.js')) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
