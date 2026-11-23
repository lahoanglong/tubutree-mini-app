import type { MetadataRoute } from 'next';
import { CASHBACK_ENABLED } from '@tubutree/app-core/features';
import { fetchRefillLanding, REFILL_LANDING_PATH, refillLandingRows } from '@tubutree/app-core/refill/refill-landing';
import { NOINDEX_PUBLIC_PATHS, SITE_URL } from '@/lib/site';
import { publicStaticRoutes } from '@/lib/route-map';
import { ApiUnavailableError, getBrands, getCategories, getLegalDoc, getProducts, getStorefrontList, type CategoryItem } from '@/lib/api';
import { ApiNotFoundError, createServerHttp, getListOrEmptyAtBuild } from '@/lib/core-http-server';
import { browseCanonicalPath } from '@/lib/home-seo';
import { LEGAL_SLUGS } from '@/lib/legal';

export const revalidate = 3600;

/**
 * Trang sản phẩm là nội dung chính cần lập chỉ mục, nhưng trang chủ chỉ link tới 30 sản phẩm
 * nổi bật — phần còn lại phải chờ crawler tự mò ra. Sitemap rút ngắn việc đó.
 *
 * Gian hàng CTV/nhãn hàng (route /s/[slug]) — trước đây KHÔNG có trong sitemap vì API công
 * khai chưa có endpoint liệt kê chúng ("API công khai chưa có endpoint liệt kê chúng"). Nay
 * dùng GET /storefront/public-list (chỉ gian hàng đã đăng, 500 gian hàng cập nhật gần nhất —
 * mirror đúng giới hạn 500 sản phẩm bên dưới, không cần liệt kê TOÀN BỘ).
 *
 * Chiến dịch (/chien-dich/[slug]): GET /campaigns/public-slugs trả slug + ngày sửa của chiến dịch đang chạy có trang riêng (bản tắt, chưa mở,
 * đã hết và banner trỏ sản phẩm/danh mục không có trong đó).
 */

// API chặn limit > 100 (common/pagination.ts); xin 200 một lần từng trả 400 nên sitemap không có sản phẩm nào.
const PRODUCTS_PER_PAGE = 100;
const MAX_PRODUCT_PAGES = 5;

/**
 * `lastmod` chỉ cho gian hàng CTV và chiến dịch, nơi `updatedAt` là ngày sửa thật (người dùng chỉnh gian hàng, admin sửa chiến dịch). Sản phẩm KHÔNG có `lastmod`: `Product.updatedAt` bị
 * đồng bộ Pancake ban đêm và việc tính lại số đã bán đẩy tiến cho mọi sản phẩm dù nội dung không đổi, mà crawler bỏ qua `lastmod` khi thấy nó không phản ánh
 * thay đổi thật. Trang chủ, trang tĩnh, nhãn và chính sách cũng không có nguồn ngày thật nên để trống thay vì dùng giờ dựng sitemap.
 * Ngày hỏng hoặc ở tương lai (lệch đồng hồ quá một ngày) bị bỏ, để sitemap không khai một mốc vô lý.
 */
/** Mọi nút của cây danh mục (cả danh mục con), mỗi id một lần; `children` hỏng tạo vòng cũng không treo. */
function flattenCategories(tree: readonly CategoryItem[]): CategoryItem[] {
  const seen = new Set<string>();
  const out: CategoryItem[] = [];
  const walk = (nodes: readonly CategoryItem[]) => {
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
      walk(n.children ?? []);
    }
  };
  walk(tree);
  return out;
}

interface CampaignSlug {
  slug: string;
  updatedAt?: string;
}

/** Thân trả về không phải mảng hay dòng thiếu slug thì bỏ (không đoán URL). */
const campaignSlugRows = (json: unknown): CampaignSlug[] =>
  Array.isArray(json)
    ? json.filter((r): r is CampaignSlug => typeof r === 'object' && r !== null && typeof (r as CampaignSlug).slug === 'string' && (r as CampaignSlug).slug !== '')
    : [];

/**
 * Chiến dịch đang chạy cho sitemap. Lúc build lỗi API ra rỗng (getListOrEmptyAtBuild). Lúc chạy, 404 nghĩa là API bản cũ chưa có endpoint
 * (đường dẫn rơi vào `:slug`): không có chiến dịch để nộp, đừng làm hỏng cả sitemap. Lỗi tạm (5xx, mất kết nối) vẫn ném như mọi danh sách
 * khác để Next giữ bản đầy đủ lần trước.
 */
async function getCampaignSlugs(): Promise<CampaignSlug[]> {
  try {
    return await getListOrEmptyAtBuild(createServerHttp({ revalidate }), '/campaigns/public-slugs', campaignSlugRows);
  } catch (err) {
    if (err instanceof ApiNotFoundError) return [];
    throw err;
  }
}

/**
 * Trang "Tiết kiệm với Refill" chỉ được lập chỉ mục khi có ít nhất một thẻ gói bán được (cùng luật noindex của page.tsx: cờ `catalog.refill_first_enabled` tắt
 * hay mọi gói hết hàng thì trang chỉ còn lời trống). Lúc build API thường chưa chạy, và 404 là API bản cũ chưa có endpoint: không nộp. Lỗi tạm lúc chạy thì ném
 * như mọi danh sách khác để Next giữ bản đầy đủ lần trước.
 */
async function refillLandingIndexed(): Promise<boolean> {
  try {
    return refillLandingRows(await fetchRefillLanding(createServerHttp({ revalidate }))).length > 0;
  } catch (err) {
    if (err instanceof ApiNotFoundError || process.env.NEXT_PHASE === 'phase-production-build') return false;
    throw err;
  }
}

/**
 * Trang chính sách có nội dung đã duyệt (cùng quy tắc với generateMetadata của /chinh-sach/[loai]: `content === null` thì trang noindex nên không nộp).
 * Lúc `next build` dùng đúng lối thoát của getProducts/getBrands: API trả lời thì nộp ngay cả 5 trang (sitemap đủ URL từ lúc deploy, không chờ
 * `revalidate` 1 giờ); API chưa lên (ApiUnavailableError) thì bỏ riêng trang đó thay vì làm hỏng bản build. Lúc chạy lỗi vẫn nổi lên để Next giữ bản trước.
 */
async function indexedLegalSlugs(): Promise<string[]> {
  const building = process.env.NEXT_PHASE === 'phase-production-build';
  const docs = await Promise.all(
    LEGAL_SLUGS.map(async (slug) => {
      try {
        return (await getLegalDoc(slug)).content !== null ? slug : null;
      } catch (err) {
        if (building && err instanceof ApiUnavailableError) return null;
        throw err;
      }
    }),
  );
  return docs.filter((slug): slug is (typeof LEGAL_SLUGS)[number] => slug !== null);
}

function lastModified(iso: string | null | undefined, now = Date.now()): Date | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  const t = at.getTime();
  return Number.isFinite(t) && t <= now + 24 * 3_600_000 ? at : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
  ];
  const routes = publicStaticRoutes();
  const refillOn = routes.includes(REFILL_LANDING_PATH.web) && (await refillLandingIndexed());
  for (const route of routes) {
    if (route === '/' || NOINDEX_PUBLIC_PATHS.includes(route)) continue;
    // Cùng cờ với robots noindex của layout /hoan-tien: không nộp URL mà chính trang đánh dấu noindex.
    if (route === '/hoan-tien' && !CASHBACK_ENABLED) continue;
    if (route === REFILL_LANDING_PATH.web && !refillOn) continue;
    base.push({ url: `${SITE_URL}${route}`, changeFrequency: 'weekly', priority: 0.6 });
  }
  // Không bắt lỗi: nếu nuốt lỗi rồi trả sitemap rút gọn thì ISR sẽ giữ bản thiếu cả giờ; để lỗi nổi lên
  // thì Next giữ sitemap đầy đủ lần trước. Lúc build API chưa chạy đã được getProducts/getStorefrontList xử lý.
  for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
    const products = await getProducts({ limit: String(PRODUCTS_PER_PAGE), page: String(page) });
    for (const p of products) {
      base.push({ url: `${SITE_URL}/san-pham/${p.slug}`, changeFrequency: 'weekly', priority: 0.7 });
    }
    if (products.length < PRODUCTS_PER_PAGE) break;
  }
  // Trang danh mục (/san-pham?category=<id>, cả danh mục con) được lập chỉ mục với canonical tự trỏ về chính nó (browseMetadata), cùng dạng URL ở đây.
  // Chỉ nộp danh mục còn sản phẩm đang bán: danh mục rỗng là trang trống. API cũ chưa trả productCount thì không nộp danh mục nào thay vì đoán.
  for (const c of flattenCategories(await getCategories())) {
    if ((c.productCount ?? 0) > 0) {
      base.push({ url: `${SITE_URL}${browseCanonicalPath({ category: { id: c.id, name: c.name } })}`, changeFrequency: 'daily', priority: 0.7 });
    }
  }
  // Nhãn đã công khai (có slug) mới có trang /brand/[slug]; nhãn chưa công khai không có URL để nộp.
  for (const b of await getBrands()) {
    if (b.slug) base.push({ url: `${SITE_URL}/brand/${encodeURIComponent(b.slug)}`, changeFrequency: 'weekly', priority: 0.6 });
  }
  for (const slug of await indexedLegalSlugs()) {
    base.push({ url: `${SITE_URL}/chinh-sach/${slug}`, changeFrequency: 'monthly', priority: 0.4 });
  }
  const storefronts = await getStorefrontList();
  for (const s of storefronts) {
    const lastmod = lastModified(s.updatedAt);
    base.push({
      url: `${SITE_URL}/s/${s.slug}`,
      ...(lastmod ? { lastModified: lastmod } : {}),
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }
  // Cùng dạng đường dẫn với canonical của trang (`/chien-dich/${encodeURIComponent(slug)}`); mỗi slug một lần.
  const campaignSeen = new Set<string>();
  for (const c of await getCampaignSlugs()) {
    if (campaignSeen.has(c.slug)) continue;
    campaignSeen.add(c.slug);
    const lastmod = lastModified(c.updatedAt);
    base.push({
      url: `${SITE_URL}/chien-dich/${encodeURIComponent(c.slug)}`,
      ...(lastmod ? { lastModified: lastmod } : {}),
      changeFrequency: 'daily',
      priority: 0.6,
    });
  }
  return base;
}
