import { createHash } from 'node:crypto';
import type { MssEnrichmentImage, MssEnrichmentIngredient, MssEnrichmentPayload, MssEnrichmentVideo } from '../../../catalog/mss-enrichment';
import { sanitizeMssHtml } from './mss-catalog-html';
import { parseMssMediaUrl } from './mss-media';

/**
 * Trần độ dài và số phần tử Tubu tự đặt (hợp đồng v0.9 chưa ghi trần): chuỗi dài hơn bị cắt, mảng dài hơn bị cắt đuôi. Trần chọn rộng
 * hơn mọi giá trị đang có trên PROD và đủ chặt để một tài liệu không làm phình bảng hay trang.
 */
export const MSS_DOC_LIMITS = {
  title: 200,
  shortDesc: 500,
  descriptionHtml: 20_000,
  alt: 200,
  metaTitle: 120,
  metaDesc: 320,
  ingredientName: 120,
  ingredientNote: 300,
  certification: 120,
  images: 20,
  videos: 5,
  ingredients: 50,
  certifications: 20,
  categorySlugs: 10,
} as const;

export const MSS_DOC_STATES = ['published', 'unpublished', 'removed', 'preview'] as const;
export type MssDocState = (typeof MSS_DOC_STATES)[number];

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_VERSION = 2_147_483_647;

/** Lý do gọt một tài liệu, để Ops đếm. */
export type MssDocIssue = 'media_rejected' | 'html_emptied' | 'string_truncated' | 'array_truncated';

export interface MssParsedDoc {
  pancakeProductId: string;
  mssProductId: string | null;
  state: MssDocState;
  /** `published_version`; chưa từng xuất bản thì 0. */
  version: number;
  updatedAt: Date;
  /** Payload đã lọc, trừ danh mục: `categoryIds` để `null`, slug nằm ở `categorySlugs` chờ đổi sang id Tubu. */
  payload: MssEnrichmentPayload;
  /** `null` = không có ý kiến; mảng (có thể rỗng) = danh sách slug MSS gửi. */
  categorySlugs: string[] | null;
  issues: Partial<Record<MssDocIssue, number>>;
}

export type MssDocParse = { ok: true; doc: MssParsedDoc } | { ok: false; reason: 'invalid_doc' | 'no_pancake_id' };

export interface MssDocContext {
  mediaHosts: readonly string[];
  /** Tài liệu xem trước: URL media được mang `?token=`. */
  preview?: boolean;
}

class DocError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Chuỗi dạng ISO có múi giờ. */
function parseInstant(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

class Reader {
  readonly issues: Partial<Record<MssDocIssue, number>> = {};

  constructor(private readonly ctx: MssDocContext) {}

  note(issue: MssDocIssue, n = 1): void {
    this.issues[issue] = (this.issues[issue] ?? 0) + n;
  }

  /** Chuỗi (bỏ khoảng trắng hai đầu, gom khoảng trắng thừa) hoặc null. Sai kiểu thì cả tài liệu hỏng. */
  text(v: unknown, max: number): string | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw new DocError();
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim();
    if (s.length <= max) return s;
    this.note('string_truncated');
    return s.slice(0, max).trimEnd();
  }

  list(v: unknown, max: number): unknown[] | null {
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v)) throw new DocError();
    if (v.length <= max) return v;
    this.note('array_truncated');
    return v.slice(0, max);
  }

  obj(v: unknown): Record<string, unknown> | null {
    if (v === undefined || v === null) return null;
    if (!isObj(v)) throw new DocError();
    return v;
  }

  num(v: unknown, max: number): number | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new DocError();
    return v >= 0 && v <= max ? Math.round(v) : null;
  }

  media(v: unknown): string | null {
    if (typeof v !== 'string') throw new DocError();
    const url = parseMssMediaUrl(v, this.ctx.mediaHosts, { allowPreviewToken: this.ctx.preview === true });
    if (!url) this.note('media_rejected');
    return url;
  }

  /**
   * Danh sách có phần tử bị loại (URL ngoài host cho phép): còn ít nhất một phần tử thì dùng phần còn lại; MSS gửi danh sách không rỗng mà
   * không phần tử nào qua được thì coi như MSS không có ý kiến, không xoá ảnh/video đang có của Tubu.
   */
  kept<T>(raw: unknown[] | null, items: T[]): T[] | null {
    if (raw === null) return null;
    return raw.length > 0 && items.length === 0 ? null : items;
  }
}

function readEnrichment(r: Reader, raw: Record<string, unknown> | null): { payload: MssEnrichmentPayload; categorySlugs: string[] | null } {
  const e = raw ?? {};
  const L = MSS_DOC_LIMITS;
  const title = r.text(e.title, L.title) || null;
  const shortDesc = r.text(e.short_desc, L.shortDesc);

  let descriptionHtml: string | null = null;
  if (e.description_html !== undefined && e.description_html !== null) {
    if (typeof e.description_html !== 'string') throw new DocError();
    const clean = sanitizeMssHtml(e.description_html, L.descriptionHtml);
    // Lọc xong không còn gì từ một chuỗi có nội dung (chỉ toàn script/style): không có ý kiến, không xoá mô tả Tubu.
    if (clean === '' && e.description_html.trim() !== '') r.note('html_emptied');
    else descriptionHtml = clean;
  }

  const rawImages = r.list(e.images, L.images);
  const images: MssEnrichmentImage[] = [];
  for (const it of rawImages ?? []) {
    if (!isObj(it)) throw new DocError();
    const url = r.media(it.url);
    const vid = it.variation_id;
    if (vid !== undefined && vid !== null && (typeof vid !== 'string' || !ID_RE.test(vid))) throw new DocError();
    const alt = r.text(it.alt, L.alt);
    const w = r.num(it.w, 20_000);
    const h = r.num(it.h, 20_000);
    if (url) images.push({ url, alt: alt || null, w, h, variationId: typeof vid === 'string' ? vid : null });
  }

  const rawVideos = r.list(e.videos, L.videos);
  const videos: MssEnrichmentVideo[] = [];
  for (const it of rawVideos ?? []) {
    if (!isObj(it)) throw new DocError();
    const url = r.media(it.url);
    const posterUrl = it.poster_url === undefined || it.poster_url === null ? null : r.media(it.poster_url);
    const durationS = r.num(it.duration_s, 3_600);
    if (url) videos.push({ url, posterUrl, durationS });
  }

  const rawIngredients = r.list(e.ingredients, L.ingredients);
  const ingredients: MssEnrichmentIngredient[] = [];
  for (const it of rawIngredients ?? []) {
    if (!isObj(it)) throw new DocError();
    const name = r.text(it.name, L.ingredientName);
    const note = r.text(it.note, L.ingredientNote);
    if (name) ingredients.push({ name, note: note || null });
  }

  const rawCerts = r.list(e.certifications, L.certifications);
  const certifications: string[] = [];
  for (const it of rawCerts ?? []) {
    const c = r.text(it, L.certification);
    if (c) certifications.push(c);
  }

  const seo = r.obj(e.seo);
  const metaTitle = r.text(seo?.meta_title, L.metaTitle);
  const metaDesc = r.text(seo?.meta_desc, L.metaDesc);

  const rawSlugs = r.list(e.category_slugs, L.categorySlugs);
  let categorySlugs: string[] | null = null;
  if (rawSlugs) {
    categorySlugs = [];
    for (const s of rawSlugs) {
      if (typeof s !== 'string') throw new DocError();
      const slug = s.trim().toLowerCase();
      if (slug.length <= 120 && SLUG_RE.test(slug) && !categorySlugs.includes(slug)) categorySlugs.push(slug);
    }
  }

  return {
    payload: {
      v: 1,
      title,
      shortDesc,
      descriptionHtml,
      images: r.kept(rawImages, images),
      videos: r.kept(rawVideos, videos),
      ingredients: rawIngredients === null ? null : ingredients,
      certifications: rawCerts === null ? null : certifications,
      metaTitle,
      metaDesc,
      categoryIds: null,
    },
    categorySlugs,
  };
}

/**
 * Đọc một tài liệu sản phẩm MSS (mục 1.2) theo lược đồ chặt: trường đã biết mà sai kiểu thì bỏ cả tài liệu (`invalid_doc`); trường lạ thì
 * bỏ qua (hợp đồng mục 5: thêm trường là thay đổi tương thích). `source` (giá, tồn) KHÔNG được đọc: khi `mss.catalog_source = pancake`,
 * giá và tồn chỉ đến từ Pancake. Không ném.
 */
export function parseMssProductDoc(raw: unknown, ctx: MssDocContext): MssDocParse {
  if (!isObj(raw)) return { ok: false, reason: 'invalid_doc' };
  const pid = raw.pancake_product_id;
  if (pid === undefined || pid === null) return { ok: false, reason: 'no_pancake_id' };
  if (typeof pid !== 'string' || !ID_RE.test(pid)) return { ok: false, reason: 'invalid_doc' };
  const state = raw.state;
  if (typeof state !== 'string' || !(MSS_DOC_STATES as readonly string[]).includes(state)) return { ok: false, reason: 'invalid_doc' };
  if ((state === 'preview') !== (ctx.preview === true)) return { ok: false, reason: 'invalid_doc' };
  const ver = raw.published_version;
  if (ver !== undefined && ver !== null && (typeof ver !== 'number' || !Number.isInteger(ver) || ver < 0 || ver > MAX_VERSION)) return { ok: false, reason: 'invalid_doc' };
  const updatedAt = parseInstant(raw.updated_at);
  if (!updatedAt) return { ok: false, reason: 'invalid_doc' };
  const mss = raw.mss_product_id;
  if (mss !== undefined && mss !== null && (typeof mss !== 'string' || mss.length === 0 || mss.length > 64)) return { ok: false, reason: 'invalid_doc' };

  const r = new Reader(ctx);
  try {
    const { payload, categorySlugs } = readEnrichment(r, r.obj(raw.enrichment));
    return {
      ok: true,
      doc: {
        pancakeProductId: pid,
        mssProductId: typeof mss === 'string' ? mss : null,
        state: state as MssDocState,
        version: typeof ver === 'number' ? ver : 0,
        updatedAt,
        payload,
        categorySlugs,
        issues: r.issues,
      },
    };
  } catch (err) {
    if (err instanceof DocError) return { ok: false, reason: 'invalid_doc' };
    throw err;
  }
}

/** Băm ổn định của phần sẽ lưu (trạng thái + payload đã đổi danh mục): bằng nhau là không có gì đổi, khỏi ghi và khỏi xoá bộ đệm. */
export function payloadSha256(state: string, payload: MssEnrichmentPayload): string {
  return createHash('sha256').update(JSON.stringify([state, payload])).digest('hex');
}
