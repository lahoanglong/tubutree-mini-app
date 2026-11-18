import type { Prisma } from '@prisma/client';
import { parseStoryConfig, type ProductStoryConfig } from '@tubutree/shared-types';

/**
 * Nội dung bổ sung MSS đã kiểm và lọc, đúng như lưu ở `product_mss_enrichment.payload` (hợp đồng commerce v0.9 mục 1.2). Quy ước:
 * `null` = MSS không có ý kiến, Tubu giữ giá trị của mình; mảng rỗng = cố ý để trống; chuỗi rỗng ở trường chữ không bắt buộc = cố ý để
 * trống. Tên (`title`) không bao giờ rỗng: MSS gửi rỗng thì coi như không có ý kiến.
 */
export interface MssEnrichmentImage {
  url: string;
  alt: string | null;
  w: number | null;
  h: number | null;
  /** `pancake_variation_id` của ảnh riêng một biến thể. */
  variationId: string | null;
}

export interface MssEnrichmentVideo {
  url: string;
  posterUrl: string | null;
  durationS: number | null;
}

export interface MssEnrichmentIngredient {
  name: string;
  note: string | null;
}

/**
 * Một "nhãn xanh" MSS đề xuất (từ vựng của bảng `product_eco_facts`). Không bao giờ hiện thẳng cho khách: Tubu tạo dòng NHÁP để admin
 * duyệt ở màn Sự thật xanh (luật duyệt của wave w2-01 giữ nguyên).
 */
export interface MssEcoFactProposal {
  kind: string;
  /** `pancake_variation_id` của nhãn riêng một biến thể; null = cả sản phẩm. */
  variationId: string | null;
  valueGrams: number | null;
  baselineText: string | null;
  label: string | null;
  co2Grams: number | null;
  sourceUrl: string;
  sourceNote: string;
}

export interface MssEnrichmentPayload {
  v: 1;
  title: string | null;
  shortDesc: string | null;
  descriptionHtml: string | null;
  images: MssEnrichmentImage[] | null;
  videos: MssEnrichmentVideo[] | null;
  ingredients: MssEnrichmentIngredient[] | null;
  certifications: string[] | null;
  metaTitle: string | null;
  metaDesc: string | null;
  /** Id danh mục Tubu (đã đổi từ `category_slugs`, slug lạ bị bỏ). */
  categoryIds: string[] | null;
  /**
   * Câu chuyện xanh (khung `ProductStoryConfig`, đã qua `parseStoryConfig`). Hai trường dưới chỉ có mặt khi MSS gửi: vắng = không có ý kiến,
   * và băm payload của tài liệu không có chúng giữ y như trước khi thêm trường.
   */
  storyConfig?: ProductStoryConfig;
  ecoFacts?: MssEcoFactProposal[];
}

export const EMPTY_MSS_PAYLOAD: MssEnrichmentPayload = {
  v: 1,
  title: null,
  shortDesc: null,
  descriptionHtml: null,
  images: null,
  videos: null,
  ingredients: null,
  certifications: null,
  metaTitle: null,
  metaDesc: null,
  categoryIds: null,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Đọc lại payload đã lưu. Dữ liệu được kiểm lúc ghi; ở đây chỉ bảo vệ chỗ đọc khỏi dòng hỏng (sửa tay DB, phiên bản payload lạ): trường sai
 * kiểu thành `null`, nghĩa là giữ giá trị Tubu. Không bao giờ ném.
 */
export function readStoredPayload(raw: Prisma.JsonValue | unknown): MssEnrichmentPayload {
  if (!isObj(raw) || raw.v !== 1) return EMPTY_MSS_PAYLOAD;
  const arr = <T>(v: unknown, item: (x: unknown) => T | null): T[] | null => {
    if (!Array.isArray(v)) return null;
    return v.map(item).filter((x): x is T => x !== null);
  };
  return {
    v: 1,
    title: strOrNull(raw.title) || null,
    shortDesc: strOrNull(raw.shortDesc),
    descriptionHtml: strOrNull(raw.descriptionHtml),
    images: arr(raw.images, (x) =>
      isObj(x) && typeof x.url === 'string' ? { url: x.url, alt: strOrNull(x.alt), w: numOrNull(x.w), h: numOrNull(x.h), variationId: strOrNull(x.variationId) } : null,
    ),
    videos: arr(raw.videos, (x) => (isObj(x) && typeof x.url === 'string' ? { url: x.url, posterUrl: strOrNull(x.posterUrl), durationS: numOrNull(x.durationS) } : null)),
    ingredients: arr(raw.ingredients, (x) => (isObj(x) && typeof x.name === 'string' && x.name ? { name: x.name, note: strOrNull(x.note) } : null)),
    certifications: arr(raw.certifications, (x) => (typeof x === 'string' && x ? x : null)),
    metaTitle: strOrNull(raw.metaTitle),
    metaDesc: strOrNull(raw.metaDesc),
    categoryIds: arr(raw.categoryIds, (x) => (typeof x === 'string' && x ? x : null)),
    ...storedStory(raw.storyConfig),
  };
}

/** Câu chuyện đã lưu được kiểm lại bằng chính bộ kiểm của shared-types: dòng hỏng thì coi như không có ý kiến, PDP dùng câu chuyện Tubu. */
function storedStory(raw: unknown): { storyConfig?: ProductStoryConfig } {
  if (raw === undefined || raw === null) return {};
  const parsed = parseStoryConfig(raw);
  return parsed.ok ? { storyConfig: parsed.value } : {};
}

/** Ảnh chung trước, ảnh riêng biến thể sau (thư viện ảnh PDP mở bằng ảnh chung). */
export function orderedImageUrls(images: readonly MssEnrichmentImage[]): string[] {
  return [...images.filter((i) => !i.variationId), ...images.filter((i) => i.variationId)].map((i) => i.url);
}

/** Các trường PDP mà nội dung bổ sung có thể thay. Kiểu của từng trường giữ đúng như cột Tubu để client cũ đọc được. */
export interface EnrichableProduct {
  name: string;
  shortDesc: string | null;
  description: string;
  images: string[];
  videos: string[];
  thumbnail: string | null;
  categoryIds: string[];
  ingredients: Prisma.JsonValue | null;
  certifications: string[];
  metaTitle: string | null;
  metaDesc: string | null;
  storyConfig?: Prisma.JsonValue | null;
}

/**
 * Ghép từng trường: giá trị MSS khác `null` thắng, `null` giữ Tubu. Ảnh MSS thay cả danh sách và ảnh đại diện (ảnh đầu), kể cả khi
 * MSS cố ý để trống. Thành phần đổi `note` thành `benefit` (dòng phụ của khối Thành phần ở hai app).
 */
export function mergeEnrichment<T extends EnrichableProduct>(product: T, e: MssEnrichmentPayload): T {
  const out: T = { ...product };
  if (e.title) out.name = e.title;
  if (e.shortDesc !== null) out.shortDesc = e.shortDesc;
  if (e.descriptionHtml !== null) out.description = e.descriptionHtml;
  if (e.images !== null) {
    out.images = orderedImageUrls(e.images);
    out.thumbnail = out.images[0] ?? null;
  }
  if (e.videos !== null) out.videos = e.videos.map((v) => v.url);
  if (e.ingredients !== null) out.ingredients = e.ingredients.map((i) => (i.note ? { name: i.name, benefit: i.note } : { name: i.name }));
  if (e.certifications !== null) out.certifications = [...e.certifications];
  if (e.metaTitle !== null) out.metaTitle = e.metaTitle;
  if (e.metaDesc !== null) out.metaDesc = e.metaDesc;
  if (e.categoryIds !== null) out.categoryIds = [...e.categoryIds];
  // Câu chuyện MSS đang tắt thì giữ câu chuyện admin soạn trên Tubu, không ẩn nó.
  if (e.storyConfig?.enabled) out.storyConfig = e.storyConfig as unknown as Prisma.JsonValue;
  return out;
}

/** Cột rút gọn của dòng bổ sung mà thẻ sản phẩm cần (không đọc cả payload). */
export interface MssCardOverride {
  title: string | null;
  imagesOverride: boolean;
  coverImage: string | null;
}

/** Thẻ sản phẩm: tên và ảnh đại diện. MSS cố ý để trống ảnh thì thẻ không có ảnh, không rơi về ảnh Pancake. */
export function mergeCardOverride<T extends { name: string; thumbnail: string | null; images?: readonly string[] }>(row: T, o: MssCardOverride): T {
  const out: T = { ...row };
  if (o.title) out.name = o.title;
  if (o.imagesOverride) {
    out.thumbnail = o.coverImage;
    out.images = o.coverImage ? [o.coverImage] : [];
  }
  return out;
}

/** Điều kiện "dòng bổ sung đã xuất bản thay danh mục" cho Prisma (lọc theo danh mục và đếm danh mục khi cờ bật). */
export const MSS_CATEGORY_OVERRIDE_WHERE = { state: 'published', categoryOverride: true } as const;

/**
 * Lọc theo danh mục khi cờ bật: sản phẩm có danh mục MSS thì xét danh mục MSS, không có thì xét danh mục Tubu. `match` là điều kiện cột
 * mảng (`{ has }` hoặc `{ hasSome }`), áp cho cả hai phía.
 */
export function enrichedCategoryWhere(match: Prisma.StringNullableListFilter): Prisma.ProductWhereInput {
  return {
    OR: [
      { categoryIds: match, NOT: { mssEnrichment: { is: MSS_CATEGORY_OVERRIDE_WHERE } } },
      { mssEnrichment: { is: { ...MSS_CATEGORY_OVERRIDE_WHERE, categoryIds: match } } },
    ],
  };
}

/** Danh mục hiệu lực của một sản phẩm khi cờ bật. */
export function effectiveCategoryIds(p: { categoryIds: string[]; mssEnrichment?: { state: string; categoryOverride: boolean; categoryIds: string[] } | null }): string[] {
  const e = p.mssEnrichment;
  return e && e.state === 'published' && e.categoryOverride ? e.categoryIds : p.categoryIds;
}
