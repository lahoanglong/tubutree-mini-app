import { request as httpsRequest } from 'node:https';
import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { hasImageSignature, isStorefrontImageValue } from '../../common/uploaded-image';
import { storedThumbnailFor } from '../../common/public-image';
import { MAX_SOURCE_BYTES, MAX_SOURCE_PIXELS, safeLookup } from './image-resize';

/**
 * Nạp ảnh sản phẩm từ WordPress cũ (tubutree.com) về kho riêng của hệ thống để tắt WordPress không làm chết ảnh.
 *
 * "Kho riêng" là cột `products.images`: ảnh base64 trong Postgres, phát qua /public-image (cùng cách ảnh admin tải lên), KHÔNG trỏ
 * `https://tubutree.com/wp-content/...`. Tệp này không import Nest để `scripts/wp-image-sync.ts` dùng chung.
 *
 * Danh sách ứng viên lấy từ rà soát chỉ-đọc 13/11/2026 (25 SP đang bán `images=[]` đối chiếu 91 sản phẩm WordPress). Chỉ 4 SP là cùng sản
 * phẩm (EXACT) mới nạp thẳng được; các nhóm còn lại có thể là ảnh sai bao bì nên BẮT BUỘC người duyệt từng dòng.
 */

export type WpCandidateTier = 'EXACT' | 'SAME_LINE' | 'WEAK' | 'COMPOSITE';

export interface WpSource {
  /** Mã sản phẩm WooCommerce. */
  id: number;
  slug: string;
}

export interface WpImageCandidate {
  /** Slug sản phẩm trong DB PROD (đo 13/11/2026). */
  productSlug: string;
  tier: WpCandidateTier;
  sources: readonly WpSource[];
  note: string;
}

export const WP_TIER_LABELS: Readonly<Record<WpCandidateTier, string>> = {
  EXACT: 'Chắc chắn cùng sản phẩm',
  SAME_LINE: 'Cùng dòng, khác quy cách',
  WEAK: 'Khớp yếu',
  COMPOSITE: 'Combo, chỉ có ảnh từng món',
};

export const WP_IMAGE_CANDIDATES: readonly WpImageCandidate[] = [
  { productSlug: 'cho-be-mat-co-dac-sokfarm-250g-3c395c', tier: 'EXACT', sources: [{ id: 8454, slug: 'mat-hoa-dua-co-dac-organic-sokfarm' }], note: 'Cùng tên và cùng 250g.' },
  { productSlug: 'cho-be-nuoc-tuong-mat-hoa-dua-sokfarm-200ml-6b9b40', tier: 'EXACT', sources: [{ id: 8414, slug: 'nuoc-tuong-mat-hoa-dua-organic-sokfarm' }], note: 'Cùng tên và cùng 200ml.' },
  { productSlug: 'lau-noi-that-o-to-fuwa3e-300ml-b202d9', tier: 'EXACT', sources: [{ id: 7022, slug: 'xit-ve-sinh-noi-that' }], note: 'Tên WordPress khác ("Xịt vệ sinh nội thất ô tô") nhưng cùng hãng, cùng 300ml, cùng công dụng.' },
  { productSlug: 'sua-hat-gao-lut-nay-mam-bh-nong-lon-400g-e0cafb', tier: 'EXACT', sources: [{ id: 8938, slug: 'sua-hat-gao-lut-nay-mam-bh-nong' }], note: 'Cùng tên và cùng 400g. WordPress còn bản thuần chay riêng (#9046), không dùng ở đây.' },

  { productSlug: 'ca-phe-muoi-tui-50x16g-9fbabb', tier: 'SAME_LINE', sources: [{ id: 8654, slug: 'ca-phe-muoi-csea' }], note: 'Cùng dòng cà phê muối gói 16g. WordPress bán hộp 10 gói, ở đây bán túi 50 gói: kiểm bao bì.' },
  { productSlug: 'ca-phe-sau-rieng-tui-20x20g-746f71', tier: 'SAME_LINE', sources: [{ id: 8657, slug: 'ca-phe-sau-rieng-durica' }], note: 'Cùng dòng cà phê sầu riêng. Quy cách khác (WordPress hộp 10 gói): kiểm bao bì.' },
  { productSlug: 'cho-be-duong-hoa-dua-sokfarm-hu-thuy-tinh-150g-64ec0b', tier: 'SAME_LINE', sources: [{ id: 8486, slug: 'duong-hoa-dua-organic-sokfarm' }], note: 'Cùng đường hoa dừa Sokfarm. WordPress là túi 300g, ở đây là hũ thuỷ tinh 150g: kiểm bao bì.' },
  { productSlug: 'dau-goi-dau-xa-qua-bo-po-lang-300g-bef378', tier: 'SAME_LINE', sources: [{ id: 8098, slug: 'dau-goi-dau-thao-duoc-tu-trai-bo-po-lang' }], note: 'WordPress có dầu gội trái bơ Pơ Lang, chưa thấy dầu xả riêng (còn combo gội + gel tắm #8094, không dùng ở đây).' },
  { productSlug: 'duong-hoa-dua-sokfarm-hu-thuy-tinh-150g-b67af3', tier: 'SAME_LINE', sources: [{ id: 8486, slug: 'duong-hoa-dua-organic-sokfarm' }], note: 'Như dòng "CHO BÉ" cùng quy cách: WordPress túi 300g, ở đây hũ thuỷ tinh 150g.' },
  { productSlug: 'mat-co-dac-sokfarm-hop-12-goi-9139b9', tier: 'SAME_LINE', sources: [{ id: 8454, slug: 'mat-hoa-dua-co-dac-organic-sokfarm' }], note: 'Cùng mật cô đặc. WordPress là chai 250g, ở đây là hộp 12 gói: kiểm bao bì.' },
  { productSlug: 'nuoc-uong-mat-hoa-dua-tuoi-sokfarm-330ml-b68b8c', tier: 'SAME_LINE', sources: [{ id: 8437, slug: 'mat-hoa-dua-tuoi-organic-sokfarm' }], note: 'Cùng nước mật hoa dừa tươi. WordPress 250ml, ở đây hộp 330ml: kiểm bao bì.' },

  { productSlug: 'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l-ab8688', tier: 'WEAK', sources: [{ id: 6643, slug: 'nuoc-rua-tay-fuwa3e-big-size' }], note: 'Yếu: WordPress chỉ có nước rửa tay Fuwa3e 3,8L, bao bì khác bản refill 10L.' },

  { productSlug: 'combo-sach-diu-nhe-po-lang-srm-tt-757657', tier: 'COMPOSITE', sources: [{ id: 8080, slug: 'sua-rua-mat-tao-bot-rau-ma-po-lang' }, { id: 8070, slug: 'nuoc-tay-trang-po-lang' }], note: 'Combo sữa rửa mặt + nước tẩy trang Pơ Lang: chỉ có ảnh từng món, không có ảnh combo.' },
  { productSlug: 'combo-son-duong-po-lang-1-thoi-co-mau-1-thoi-khong-mau-4de7da', tier: 'COMPOSITE', sources: [{ id: 8161, slug: 'son-duong-moi-co-mau-bo-tuoi-po-lang' }, { id: 8173, slug: 'son-duong-moi-khong-mau-bo-tuoi-po-lang' }], note: 'Combo son có màu + không màu: chỉ có ảnh từng thỏi, không có ảnh combo.' },
];

export const candidateForSlug = (slug: string): WpImageCandidate | undefined => WP_IMAGE_CANDIDATES.find((c) => c.productSlug === slug);

export const WP_HOSTS: readonly string[] = ['tubutree.com', 'www.tubutree.com'];
const WP_STORE_API = 'https://tubutree.com/wp-json/wc/store/v1/products';
const WP_IMAGE_EXT = /\.(?:png|jpe?g|webp)$/i;

export const PRODUCT_IMAGES_LIMIT = 8;
export const DEFAULT_MAX_IMAGES = 3;
/** Trần byte ảnh sau khi nén: data URL base64 phải dưới 1,5 triệu ký tự, 950 KB nhị phân ≈ 1,27 triệu ký tự. */
export const MAX_ENCODED_BYTES = 950_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 10_000;

/** Ảnh WordPress hợp lệ: https, đúng host của tubutree.com, nằm trong wp-content/uploads, đuôi png/jpg/webp, không user:pass hay cổng lạ. Trả URL đã chuẩn hoá hoặc null. */
export function parseWpImageUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1_000) return null;
  let url: URL;
  try {
    url = new URL(raw.replace(/^http:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!WP_HOSTS.includes(url.hostname.toLowerCase())) return null;
  if (!url.pathname.startsWith('/wp-content/uploads/') || !WP_IMAGE_EXT.test(url.pathname)) return null;
  url.hash = '';
  url.search = '';
  return url;
}

export interface WpHttpResponse {
  status: number;
  contentType: string;
  body: Buffer;
}
export type WpHttp = (url: URL, opts: { maxBytes: number; timeoutMs: number }) => Promise<WpHttpResponse>;

/** GET một lần, không theo chuyển hướng (chuyển hướng coi như mã lạ: host WordPress không được đẩy ta sang nơi khác). DNS qua `safeLookup` chặn địa chỉ nội bộ. */
export const nodeWpHttp: WpHttp = (url, { maxBytes, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const done = <T>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(timer);
      fn(v);
    };
    const req = httpsRequest(url, { method: 'GET', headers: { 'user-agent': 'TubuTreeImageSync/1.0', accept: '*/*' }, lookup: safeLookup, signal: ctrl.signal }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (status !== 200) {
        res.resume();
        return done(resolve)({ status, contentType, body: Buffer.alloc(0) });
      }
      if (Number(res.headers['content-length']) > maxBytes) {
        res.destroy();
        return done(reject)(new Error('Tệp quá lớn.'));
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > maxBytes) {
          res.destroy();
          return done(reject)(new Error('Tệp quá lớn.'));
        }
        chunks.push(c);
      });
      res.on('end', () => done(resolve)({ status, contentType, body: Buffer.concat(chunks) }));
      res.on('error', done(reject));
    });
    req.on('error', done(reject));
    req.end();
  });

export interface ResolvedWpProduct {
  id: number;
  slug: string;
  name: string | null;
  imageUrls: string[];
  error: string | null;
}

const asRecord = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Đọc tên và danh sách ảnh của một sản phẩm WordPress qua Store API công khai (GET, không cần khoá). Lỗi mạng hay WordPress đã tắt trả `error`, không ném. */
export async function resolveWpProduct(http: WpHttp, source: WpSource): Promise<ResolvedWpProduct> {
  const fail = (error: string): ResolvedWpProduct => ({ id: source.id, slug: source.slug, name: null, imageUrls: [], error });
  if (!/^[a-z0-9-]+$/.test(source.slug)) return fail('Slug WordPress không hợp lệ.');
  const url = new URL(`${WP_STORE_API}?slug=${source.slug}`);
  let res: WpHttpResponse;
  try {
    res = await http(url, { maxBytes: MAX_JSON_BYTES, timeoutMs: HTTP_TIMEOUT_MS });
  } catch (e) {
    return fail(`Không gọi được WordPress (${e instanceof Error ? e.message : 'lỗi mạng'}). Trang cũ có thể đã tắt.`);
  }
  if (res.status !== 200) return fail(`WordPress trả mã ${res.status}.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body.toString('utf8'));
  } catch {
    return fail('WordPress trả dữ liệu không đọc được.');
  }
  const found = (Array.isArray(parsed) ? parsed : []).map(asRecord).find((p) => p && (p.id === source.id || p.slug === source.slug));
  if (!found) return fail('WordPress không còn sản phẩm này.');
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const image of Array.isArray(found.images) ? found.images : []) {
    const u = parseWpImageUrl(asRecord(image)?.src);
    if (u && !seen.has(u.toString())) {
      seen.add(u.toString());
      imageUrls.push(u.toString());
    }
  }
  return { id: source.id, slug: source.slug, name: typeof found.name === 'string' ? found.name : null, imageUrls, error: imageUrls.length === 0 ? 'Sản phẩm WordPress không có ảnh.' : null };
}

/**
 * Ảnh mặc định của một ứng viên. Combo (chỉ có ảnh từng món) lấy xen kẽ ảnh đầu của từng món để ảnh nào cũng thấy đủ các món; còn lại lấy các ảnh
 * đầu của sản phẩm WordPress đầu tiên có ảnh (ảnh đầu của WooCommerce là ảnh đại diện).
 */
export function pickImageUrls(tier: WpCandidateTier, resolved: readonly ResolvedWpProduct[], maxImages = DEFAULT_MAX_IMAGES): string[] {
  const max = Math.max(1, Math.min(maxImages, PRODUCT_IMAGES_LIMIT));
  if (tier === 'COMPOSITE') {
    const out: string[] = [];
    for (let i = 0; out.length < max; i += 1) {
      const row = resolved.map((r) => r.imageUrls[i]).filter((u): u is string => u !== undefined);
      if (row.length === 0) break;
      out.push(...row.slice(0, max - out.length));
    }
    return out;
  }
  return (resolved.find((r) => r.imageUrls.length > 0)?.imageUrls ?? []).slice(0, max);
}

export interface EncodedImage {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

/** Nén về WebP cạnh dài tối đa 1200px (giữ nền trong suốt), hạ dần chất lượng/cỡ đến khi dưới MAX_ENCODED_BYTES. Chỉ nhận PNG/JPEG/WebP. */
export async function encodeWpImage(source: Buffer): Promise<EncodedImage> {
  const meta = await sharp(source, { limitInputPixels: MAX_SOURCE_PIXELS }).metadata().catch(() => null);
  if (!meta?.width || !meta.height || !['png', 'jpeg', 'webp'].includes(meta.format ?? '')) throw new Error('Tệp không phải ảnh PNG, JPEG hoặc WebP.');
  for (const [edge, quality] of [[1200, 82], [1200, 72], [960, 70], [800, 62]] as const) {
    const out = await sharp(source, { limitInputPixels: MAX_SOURCE_PIXELS }).rotate().resize(edge, edge, { fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer({ resolveWithObject: true });
    if (out.data.length > MAX_ENCODED_BYTES) continue;
    const dataUrl = `data:image/webp;base64,${out.data.toString('base64')}`;
    if (!hasImageSignature(dataUrl) || !isStorefrontImageValue(dataUrl)) throw new Error('Ảnh sau khi nén không hợp lệ.');
    return { dataUrl, width: out.info.width, height: out.info.height, bytes: out.data.length };
  }
  throw new Error('Ảnh quá nặng, không nén xuống được mức cho phép.');
}

export async function downloadWpImage(http: WpHttp, rawUrl: string): Promise<EncodedImage> {
  const url = parseWpImageUrl(rawUrl);
  if (!url) throw new Error('Địa chỉ ảnh không thuộc kho ảnh của WordPress cũ.');
  const res = await http(url, { maxBytes: MAX_SOURCE_BYTES, timeoutMs: HTTP_TIMEOUT_MS });
  if (res.status !== 200) throw new Error(`WordPress trả mã ${res.status} cho ảnh.`);
  if (!/^image\/(?:png|jpe?g|webp)$/.test(res.contentType)) throw new Error('Tệp WordPress trả về không phải ảnh PNG, JPEG hoặc WebP.');
  return encodeWpImage(res.body);
}

/** Bản ghi quyết định duyệt ảnh: mỗi sản phẩm một dòng `ops_health_states` (khoá riêng nên hai quản trị viên duyệt hai sản phẩm không đè nhau). */
export const WP_DECISION_PREFIX = 'catalog.wp_image:';
export type WpDecision = 'APPLIED' | 'SKIPPED';
export const decisionKey = (productSlug: string): string => `${WP_DECISION_PREFIX}${productSlug}`;

export interface DecisionDetail {
  decision: WpDecision;
  by: string;
  at: string;
  imageCount?: number;
  sources?: string[];
}

export type SyncStore = Pick<PrismaClient, 'product' | 'opsHealthState'>;

export type ApplySkipReason = 'PRODUCT_NOT_FOUND' | 'PARTNER_OWNED' | 'HAS_IMAGES' | 'NO_WP_IMAGES';
export type ApplyOutcome =
  | { status: 'APPLIED'; imageCount: number; failed: number; thumbnail: string | null; urls: string[] }
  | { status: 'SKIPPED'; reason: ApplySkipReason }
  | { status: 'FAILED'; reason: string };

export interface ApplyInput {
  candidate: WpImageCandidate;
  /** Ảnh đã chọn (đã kiểm thuộc danh sách của WordPress); thiếu thì dùng `pickImageUrls`. */
  imageUrls?: readonly string[];
  maxImages?: number;
  actor: string;
}

/**
 * Ghi ảnh WordPress vào một sản phẩm đang chưa có ảnh. Idempotent: chạy lại, hoặc hai người duyệt cùng lúc, chỉ một lần ghi (UPDATE có điều kiện
 * `images = {}` là chốt chặn nguyên tử) và KHÔNG BAO GIỜ đè ảnh đã có. Sản phẩm đối tác không đụng (ảnh của họ do họ tự sửa).
 */
export async function applyWpCandidate(deps: { store: SyncStore; http: WpHttp; now?: () => Date; resolved?: readonly ResolvedWpProduct[] }, input: ApplyInput): Promise<ApplyOutcome> {
  const { store, http } = deps;
  const product = await store.product.findUnique({ where: { slug: input.candidate.productSlug }, select: { id: true, storefrontId: true } });
  if (!product) return { status: 'SKIPPED', reason: 'PRODUCT_NOT_FOUND' };
  if (product.storefrontId !== null) return { status: 'SKIPPED', reason: 'PARTNER_OWNED' };
  if ((await store.product.count({ where: { id: product.id, images: { isEmpty: true } } })) === 0) return { status: 'SKIPPED', reason: 'HAS_IMAGES' };

  const resolved = deps.resolved ?? (await Promise.all(input.candidate.sources.map((s) => resolveWpProduct(http, s))));
  const urls = (input.imageUrls ? [...input.imageUrls] : pickImageUrls(input.candidate.tier, resolved, input.maxImages)).slice(0, PRODUCT_IMAGES_LIMIT);
  if (urls.length === 0) return resolved.every((r) => r.error) ? { status: 'FAILED', reason: resolved.map((r) => r.error).filter(Boolean).join(' ') } : { status: 'SKIPPED', reason: 'NO_WP_IMAGES' };

  const images: string[] = [];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      images.push((await downloadWpImage(http, url)).dataUrl);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'lỗi không rõ');
    }
  }
  if (images.length === 0) return { status: 'FAILED', reason: `Không tải được ảnh nào từ WordPress: ${errors[0] ?? 'lỗi không rõ'}` };

  const thumbnail = storedThumbnailFor(product.id, images[0]);
  const written = await store.product.updateMany({ where: { id: product.id, images: { isEmpty: true }, storefrontId: null }, data: { images, thumbnail } });
  if (written.count === 0) return { status: 'SKIPPED', reason: 'HAS_IMAGES' };

  await recordDecision(store, input.candidate.productSlug, { decision: 'APPLIED', by: input.actor, at: (deps.now?.() ?? new Date()).toISOString(), imageCount: images.length, sources: input.candidate.sources.map((s) => s.slug) });
  return { status: 'APPLIED', imageCount: images.length, failed: errors.length, thumbnail, urls };
}

export async function recordDecision(store: SyncStore, productSlug: string, detail: DecisionDetail): Promise<void> {
  const key = decisionKey(productSlug);
  const data = { lastOkAt: new Date(detail.at), detail: detail as unknown as object };
  await store.opsHealthState.upsert({ where: { key }, create: { key, ...data }, update: data });
}

export async function clearDecision(store: SyncStore, productSlug: string): Promise<void> {
  await store.opsHealthState.deleteMany({ where: { key: decisionKey(productSlug) } });
}

export async function loadDecisions(store: SyncStore): Promise<Map<string, DecisionDetail>> {
  const rows = await store.opsHealthState.findMany({ where: { key: { startsWith: WP_DECISION_PREFIX } }, select: { key: true, detail: true } });
  const out = new Map<string, DecisionDetail>();
  for (const row of rows) {
    const d = asRecord(row.detail);
    if (d && (d.decision === 'APPLIED' || d.decision === 'SKIPPED') && typeof d.by === 'string' && typeof d.at === 'string') {
      out.set(row.key.slice(WP_DECISION_PREFIX.length), d as unknown as DecisionDetail);
    }
  }
  return out;
}

export interface ExactSyncRow {
  productSlug: string;
  outcome: ApplyOutcome | { status: 'DRY_RUN'; urls: string[]; errors: string[] };
}

/** Việc của `scripts/wp-image-sync.ts`: chỉ nhóm EXACT. Không `apply` thì không ghi gì, chỉ liệt kê ảnh sẽ nạp. */
export async function runExactSync(deps: { store: SyncStore; http: WpHttp; now?: () => Date }, opts: { apply: boolean; maxImages?: number; actor: string }): Promise<ExactSyncRow[]> {
  const rows: ExactSyncRow[] = [];
  for (const candidate of WP_IMAGE_CANDIDATES.filter((c) => c.tier === 'EXACT')) {
    if (opts.apply) {
      rows.push({ productSlug: candidate.productSlug, outcome: await applyWpCandidate(deps, { candidate, maxImages: opts.maxImages, actor: opts.actor }) });
      continue;
    }
    const resolved = await Promise.all(candidate.sources.map((s) => resolveWpProduct(deps.http, s)));
    rows.push({ productSlug: candidate.productSlug, outcome: { status: 'DRY_RUN', urls: pickImageUrls(candidate.tier, resolved, opts.maxImages), errors: resolved.flatMap((r) => (r.error ? [r.error] : [])) } });
  }
  return rows;
}
