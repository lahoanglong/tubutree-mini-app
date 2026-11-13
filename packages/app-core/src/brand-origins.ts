/**
 * Dữ liệu "Hành trình nguyên liệu" (nhãn, tỉnh xuất xứ, từ khoá tìm), dùng chung cho Mini App và web. Hình học bản đồ ở `brand-map-data.ts`,
 * huy hiệu minh hoạ ở `brand-badges.ts`.
 */
export interface BrandOrigin {
  /** Trùng id nhãn trong brand-theme.css (--color-brand-<id>). */
  id: string;
  /** Tên hiển thị trong câu chuyện thương hiệu. */
  brand: string;
  /** Tên đúng như cột products.brand của catalog (PDP dùng để lọc theo nhãn thật). */
  catalogBrand: string;
  /** Chính tả cũ của `catalogBrand` còn trong DB và link đã chia sẻ (`?brand=Sokfram`); nhận khi tra nhãn, không bao giờ hiển thị. */
  legacyCatalogBrands?: readonly string[];
  /**
   * Từ khoá tìm sản phẩm của nhãn, viết ĐÚNG như trong tên sản phẩm. PROD ghi mọi SKU là brand "Tubu Tree" nên `?brand=` luôn ra 0 sản phẩm;
   * `?q=` khớp tên sản phẩm (không phân biệt hoa thường), chữ hoa ở `PƠ LANG` và `BH.NONG` là cách tên sản phẩm đang viết, để kết quả
   * không phụ thuộc collation của cơ sở dữ liệu.
   */
  searchKeyword: string;
  province: string;
  ingredient: string;
  story: string;
  /** Vị trí tỉnh xuất xứ trên bản đồ sơ đồ hoá, theo hệ toạ độ gốc `MAP_GEO` (450 x 700) của `brand-map-data.ts`. */
  geo: { x: number; y: number };
}

export const BRAND_ORIGINS: BrandOrigin[] = [
  {
    id: 'fuwa3e',
    brand: 'Fuwa3e',
    catalogBrand: 'Fuwa3e',
    searchKeyword: 'Fuwa3e',
    province: 'Thanh Hóa',
    ingredient: 'Enzyme vỏ dứa & bồ hòn',
    story: 'Fuwa3e tận dụng nguồn vỏ dứa hữu cơ Thanh Hóa lên men sinh học cùng quả bồ hòn, làm nên dòng sản phẩm nước rửa chén, nước giặt lành tính cho cả gia đình và dòng nước.',
    geo: { x: 149, y: 148 },
  },
  {
    id: 'bhnong',
    brand: 'BH.Nong',
    catalogBrand: 'BH.Nong',
    searchKeyword: 'BH.NONG',
    province: 'Quảng Nam',
    ingredient: 'Mật ong rừng & trà thảo mộc',
    story: 'BH.Nong sinh ra từ núi rừng Quảng Nam, mang đến mật ong rừng nguyên chất và các dòng trà thảo mộc thanh nhiệt đậm vị thiên nhiên.',
    geo: { x: 213, y: 262 },
  },
  {
    id: 'polang',
    brand: 'Pơ Lang',
    catalogBrand: 'Pơ Lang',
    searchKeyword: 'PƠ LANG',
    province: 'Đắk Lắk',
    ingredient: 'Bơ ca cao & dầu gừng bazan',
    story: 'Pơ Lang khai thác nông sản bazan Đắk Lắk — bơ ca cao ép lạnh, dầu gừng, bồ kết — làm nên sản phẩm chăm sóc da và tóc thuần thực vật.',
    geo: { x: 230, y: 345 },
  },
  {
    id: 'visante',
    brand: 'Visante',
    catalogBrand: 'Visante',
    searchKeyword: 'Visante',
    province: 'Khánh Hòa (Nha Trang)',
    ingredient: 'Muối khoáng & rong biển',
    story: 'Visante tận dụng tinh chất muối khoáng & rong biển Nha Trang (Khánh Hòa) phục hồi dịu nhẹ cho làn da nhạy cảm.',
    geo: { x: 284, y: 408 },
  },
  {
    id: 'hector',
    brand: 'Hector',
    catalogBrand: 'Hector',
    searchKeyword: 'Hector',
    province: 'Lâm Đồng',
    ingredient: 'Đông trùng hạ thảo',
    story: 'Hector nghiên cứu và nuôi trồng đông trùng hạ thảo tại khí hậu ôn hoà Lâm Đồng, cung cấp dòng nước uống bổ dưỡng và chăm sóc sức khoẻ toàn diện.',
    geo: { x: 214, y: 402 },
  },
  {
    id: 'leplateau',
    brand: 'Le Plateau',
    catalogBrand: 'Le Plateau Coffee',
    searchKeyword: 'Le Plateau',
    province: 'Lâm Đồng (Cầu Đất)',
    ingredient: 'Cà phê đặc sản Cầu Đất',
    story: 'Le Plateau Coffee tuyển chọn từng hạt cà phê Arabica Cầu Đất & Robusta Honey chưng cất hương vị đậm đà từ vùng cao nguyên mây phủ.',
    geo: { x: 254, y: 392 },
  },
  {
    id: 'cobote',
    brand: 'Cobote',
    catalogBrand: 'Cobote',
    searchKeyword: 'Cobote',
    province: 'Bến Tre',
    ingredient: 'Dầu dừa hữu cơ Bến Tre',
    story: 'Cobote tận dụng vương quốc dừa Bến Tre cho dòng dầu dừa ép lạnh và sản phẩm dưỡng da, dưỡng tóc lành tính cho mẹ và bé.',
    geo: { x: 212, y: 536 },
  },
  {
    // `id` giữ nguyên chính tả cũ: nó là token CSS (`--color-brand-sokfram`), khoá bản đồ/huy hiệu và đích `/cau-chuyen?brand=sokfram` của link đã chia sẻ, không hiển thị.
    id: 'sokfram',
    brand: 'Sokfarm',
    catalogBrand: 'Sokfarm',
    legacyCatalogBrands: ['Sokfram'],
    searchKeyword: 'Sokfarm',
    province: 'Trà Vinh',
    ingredient: 'Mật hoa dừa hữu cơ',
    story: 'Sokfarm Trà Vinh tiên phong thu hoạch mật hoa dừa thủ công từ hoa dừa, cô đặc thành mật hoa dừa chỉ số đường huyết thấp, giàu khoáng chất.',
    geo: { x: 186, y: 560 },
  },
];

/**
 * Nhãn không có ghim riêng nhưng nguyên liệu lấy từ một nhà máy đã có ghim: khoá = tên nhãn đã chuẩn hoá (`normalizeBrandKey`), giá trị = id nhãn có ghim.
 * Pineboo (dòng Mẹ & Bé) vẫn là nhãn riêng trên thẻ sản phẩm và bộ lọc, nhưng sản xuất tại nhà máy Fuwa3e, Thanh Hóa (enzyme dứa lên men).
 */
const SHARED_FACTORY_ORIGIN: Readonly<Record<string, string>> = { pineboo: 'fuwa3e' };

/**
 * Nhãn có trên bản đồ xuất xứ (khớp theo id/slug hoặc tên catalog, kể cả chính tả cũ); nhãn dùng chung nhà máy (Pineboo) trả vùng của nhà máy đó;
 * nhãn chưa có ghim thì null.
 */
export function findBrandOrigin(brand: { slug: string; name: string }): BrandOrigin | null {
  const name = brand.name.trim().toLowerCase();
  const own = BRAND_ORIGINS.find(
    (o) =>
      o.id === brand.slug ||
      o.catalogBrand.toLowerCase() === name ||
      o.brand.toLowerCase() === name ||
      o.legacyCatalogBrands?.some((l) => l.toLowerCase() === name),
  );
  if (own) return own;
  const factoryId = SHARED_FACTORY_ORIGIN[normalizeBrandKey(brand.name)] ?? SHARED_FACTORY_ORIGIN[normalizeBrandKey(brand.slug)];
  return BRAND_ORIGINS.find((o) => o.id === factoryId) ?? null;
}

/** Tên nhãn trùng một cách ghi của chính nhãn đó (tên hiển thị, `catalogBrand`, chính tả cũ), khác với nhãn mượn vùng nhà máy (Pineboo → Fuwa3e). */
function isOwnName(origin: BrandOrigin, name: string): boolean {
  const key = normalizeBrandKey(name);
  return [origin.brand, origin.catalogBrand, ...(origin.legacyCatalogBrands ?? [])].some((n) => normalizeBrandKey(n) === key);
}

export interface OriginLink {
  /** Id điểm trên bản đồ câu chuyện: đích là `/cau-chuyen?brand=<id>` (web) hoặc `/brand-story?brand=<id>` (Mini). */
  id: string;
  /** Chữ trên chip: tỉnh xuất xứ, kèm tên nhà máy khi nhãn mượn vùng ("Fuwa3e · Thanh Hóa"). */
  label: string;
  ariaLabel: string;
}

/**
 * Chip xuất xứ ở trang chi tiết sản phẩm, theo `product.brand`: nhãn có ghim cho tên tỉnh ("Trà Vinh"), nhãn mượn vùng nhà máy (Pineboo) cho
 * "Fuwa3e · Thanh Hóa"; nhãn chưa có ghim hoặc vỏ "Tubu Tree" thì null (không hiện chip).
 */
export function pdpOriginLink(productBrand: string): OriginLink | null {
  const origin = findBrandOrigin({ slug: '', name: productBrand });
  if (!origin) return null;
  const label = isOwnName(origin, productBrand) ? origin.province : `${origin.brand} · ${origin.province}`;
  return { id: origin.id, label, ariaLabel: `Xem xuất xứ ${label} trên bản đồ` };
}

export interface BrandPageOrigin {
  id: string;
  /** Dòng "Xuất xứ: …" khi bản ghi Brand chưa nhập xuất xứ: tỉnh, kèm "(nhà máy Fuwa3e)" khi nhãn mượn vùng nhà máy. */
  text: string;
}

/** Xuất xứ dự phòng cho trang thương hiệu `/brand/<slug>` (web) và `brand-view` (Mini) từ bản đồ; không ghim thì null. */
export function brandPageOrigin(brand: { slug: string; name: string }): BrandPageOrigin | null {
  const origin = findBrandOrigin(brand);
  if (!origin) return null;
  const own = origin.id === brand.slug || isOwnName(origin, brand.name);
  return { id: origin.id, text: own ? origin.province : `${origin.province} (nhà máy ${origin.brand})` };
}

/**
 * Tên chuẩn của nhãn trong `?brand=`: chính tả cũ ("Sokfram", "SOKFRAM") về `catalogBrand` hiện hành ("Sokfarm"); nhãn khác trả nguyên văn. Cùng kết quả với
 * `canonicalCatalogBrand` của shared-types (api dùng); web và Mini đọc bản này để khỏi nạp gói shared-types vào bundle trang. Spec giữ hai bảng khớp nhau.
 */
export function canonicalBrandName(name: string): string {
  const key = name.trim().toLowerCase();
  const hit = BRAND_ORIGINS.find((o) => o.legacyCatalogBrands && [o.catalogBrand, ...o.legacyCatalogBrands].some((s) => s.toLowerCase() === key));
  return hit ? hit.catalogBrand : name;
}

/** Bỏ dấu, hạ chữ thường, bỏ mọi ký tự không phải chữ-số: "PƠ LANG", "Pơ Lang" và "pơlang" cùng ra "polang"; "BH.NONG" ra "bhnong". */
export function normalizeBrandKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Cách viết chấp nhận được của mỗi nhãn (đã chuẩn hoá). Tên chuẩn là "Sokfarm" nhưng cột brand và tên sản phẩm cũ còn "Sokfram", nên nhãn
 * này nhận cả hai; "Le Plateau Coffee" chứa "Le Plateau" nên không cần dòng riêng.
 */
const BRAND_ALIASES: Record<string, string[]> = {
  fuwa3e: ['fuwa3e'],
  bhnong: ['bhnong'],
  polang: ['polang'],
  visante: ['visante'],
  hector: ['hector'],
  leplateau: ['leplateau'],
  cobote: ['cobote'],
  sokfram: ['sokfarm', 'sokfram'],
};

/**
 * Nhãn hành trình của một tên (tên sản phẩm hoặc tên nhãn): tìm cách viết của nhãn xuất hiện SỚM nhất trong tên. Dùng khi dữ liệu không mang nhãn
 * thật (mọi SKU PROD là brand "Tubu Tree"). Không khớp thì undefined.
 */
export function brandOriginOf(name: string): BrandOrigin | undefined {
  const key = normalizeBrandKey(name);
  if (!key) return undefined;
  let best: { origin: BrandOrigin; at: number } | undefined;
  for (const origin of BRAND_ORIGINS) {
    for (const alias of BRAND_ALIASES[origin.id] ?? []) {
      const at = key.indexOf(alias);
      if (at >= 0 && (!best || at < best.at)) best = { origin, at };
    }
  }
  return best?.origin;
}

/** Đường dẫn danh sách sản phẩm của nhãn hành trình: tìm theo từ khoá trong tên (`?q=`), không lọc `?brand=` vì cột brand của PROD đều là "Tubu Tree". */
export function brandBrowseTarget(origin: BrandOrigin, base: '/san-pham' | '/browse'): string {
  return `${base}?${new URLSearchParams({ q: origin.searchKeyword }).toString()}`;
}

/** Vỏ chung của PROD: mọi SKU mang brand này nên nó không phân biệt nhãn nào, không được hiện như một thương hiệu. */
export const SHELL_BRAND_KEY = 'tubutree';

export interface ApiBrandLike {
  brand: string;
  slug?: string | null;
}

export interface JourneyBrand {
  /** Id nhãn hành trình, hoặc tên nhãn API lạ. */
  key: string;
  label: string;
  origin: BrandOrigin | null;
  /** Có slug thì nhãn có trang riêng `/brand/<slug>`. */
  slug: string | null;
  /** Tên đúng như cột products.brand, chỉ dùng cho nhãn API lạ (không có `origin`). */
  apiBrand: string | null;
}

/**
 * Dải thương hiệu của Trang chủ: 8 nhãn hành trình theo thứ tự `BRAND_ORIGINS`, khớp với nhãn API nếu có (để lấy `slug`), bỏ vỏ "Tubu Tree", nhãn API
 * lạ không thuộc 8 nhãn nối thêm phía sau. API chỉ trả "Tubu Tree" (hoặc chưa tải) thì vẫn ra đủ 8 nhãn đích tìm kiếm.
 */
export function journeyBrands(apiBrands: ReadonlyArray<ApiBrandLike> | undefined): JourneyBrand[] {
  const slugOf = new Map<string, string>();
  const extras: JourneyBrand[] = [];
  const seenExtra = new Set<string>();
  for (const b of apiBrands ?? []) {
    const key = normalizeBrandKey(b.brand);
    if (!key || key === SHELL_BRAND_KEY) continue;
    const origin = brandOriginOf(b.brand);
    if (origin) {
      if (b.slug && !slugOf.has(origin.id)) slugOf.set(origin.id, b.slug);
    } else if (!seenExtra.has(key)) {
      seenExtra.add(key);
      extras.push({ key: b.brand, label: b.brand, origin: null, slug: b.slug ?? null, apiBrand: b.brand });
    }
  }
  const core = BRAND_ORIGINS.map<JourneyBrand>((o) => ({ key: o.id, label: o.brand, origin: o, slug: slugOf.get(o.id) ?? null, apiBrand: null }));
  return [...core, ...extras];
}

/** Đích của một chip thương hiệu: trang nhãn nếu có slug, tìm theo từ khoá cho nhãn hành trình, lọc `?brand=` cho nhãn API lạ. */
export function journeyBrandHref(item: JourneyBrand, base: '/san-pham' | '/browse'): string {
  if (item.slug) return `/brand/${encodeURIComponent(item.slug)}`;
  if (item.origin) return brandBrowseTarget(item.origin, base);
  return `${base}?${new URLSearchParams({ brand: item.apiBrand ?? item.label }).toString()}`;
}
