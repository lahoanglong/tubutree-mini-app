import { baseSlug, FUWA3E_SKUS, type FuwaRow } from './story-presets-launch';

/**
 * Mô tả và thành phần dự phòng cho trang sản phẩm khi PROD chưa có (cột `description` rỗng, `ingredients` rỗng).
 *
 * Nguyên tắc: giá trị trong DB luôn thắng, từng trường độc lập (có mô tả mà thiếu thành phần thì chỉ bù thành phần). Chữ dự phòng chỉ gồm điều đọc
 * thẳng được từ tên sản phẩm hoặc chữ in trên ảnh bao bì (khi lấy từ bao bì thì câu mở đầu bằng "Bao bì ghi"). Không có con số %, chứng nhận,
 * công dụng y tế, nguồn gốc hay so sánh hơn; muốn thêm phải có nguồn do chủ nhãn xác nhận. `copy-claims-guard.ts` chặn các điều đó trong spec.
 * SKU không có nguồn nào để lập danh sách thành phần (chưa có ảnh bao bì, hoặc tên chỉ là ký hiệu) để `ingredients` rỗng thay vì bịa; khối "Thành phần" tự ẩn.
 *
 * Tra theo slug gốc đã bỏ hậu tố băm Pancake (như `findStoryPreset`), khớp tuyệt đối: slug lạ không nhận chữ dự phòng nên không bao giờ gắn nhầm.
 * Bảng nằm trong mã, không phải DB; điền thẳng vào sản phẩm thì bản trong DB thắng.
 */
/** Một dòng thành phần. Khai riêng vì kiểu `ingredients` của PDP ở hai app ghi `percentage` là chuỗi, còn `Ingredient` của shared-types ghi số; cả hai gán được vào đây. */
export interface CopyIngredient {
  name: string;
  percentage?: number | string;
  benefit?: string;
  /** Dòng do chữ dự phòng dựng, không phải dữ liệu của chủ hàng: kịch bản câu chuyện tự sinh bỏ qua dòng này (xem `normalizeIngredients` ở product-story.ts). */
  fromFallback?: true;
}

export interface ProductCopyFallback {
  description: string;
  ingredients: CopyIngredient[];
}

interface ProductCopyInput {
  slug: string;
  description?: string | null;
  ingredients?: readonly CopyIngredient[] | string | null;
}

const PACK = 'Theo chữ in trên bao bì';
const BY_NAME = 'Theo tên sản phẩm';
const ENZYME_PINEAPPLE: CopyIngredient = { name: 'Enzyme lên men từ vỏ dứa', benefit: PACK };
const ECO_ENZYME_PINEAPPLE: CopyIngredient = { name: 'Eco-enzyme lên men từ vỏ dứa', benefit: PACK };

const named = (name: string, benefit = BY_NAME): CopyIngredient => ({ name, benefit });
const entry = (description: string, ...ingredients: CopyIngredient[]): ProductCopyFallback => ({ description, ingredients: ingredients.map((i) => ({ ...i, fromFallback: true as const })) });

function fuwaCopy([type, size, tier, scent]: FuwaRow): ProductCopyFallback {
  const facts = [
    tier === 2 ? 'Bao bì ghi enzyme lên men từ vỏ dứa.' : tier === 1 ? 'Bao bì ghi Fuwa3e Enzyme Cleaner.' : '',
    scent ? `Hương ${scent.toLowerCase()}.` : '',
    `Quy cách ${size}.`,
  ].filter(Boolean);
  return entry(
    `${type}, một sản phẩm trong dòng Fuwa3e. ${facts.join(' ')}`,
    ...(tier === 2 ? [ENZYME_PINEAPPLE] : tier === 1 ? [named('Enzyme Cleaner', 'Tên dòng sản phẩm ghi trên bao bì')] : []),
  );
}

/** Nước rửa chén Fuwa3e: ảnh 500ml và 3,8L ghi enzyme vỏ dứa lên men và hương dứa. Ảnh 100ml mang tiêu đề của hàng khác (bồn cầu) nên bản 100ml chỉ nói điều tên nêu. Có kịch bản riêng ở `LAUNCH_STORY_PRESETS` nên không nằm trong `FUWA3E_SKUS`. */
const FUWA3E_DISH_WASH: Record<string, FuwaRow> = {
  'nuoc-rua-chen-fuwa3e-100ml': ['Nước rửa chén', '100ml', 0],
  'nuoc-rua-chen-fuwa3e-500ml': ['Nước rửa chén', '500ml', 2, 'Dứa'],
  'nuoc-rua-chen-fuwa3e-3-8l': ['Nước rửa chén', '3,8L', 2, 'Dứa'],
};

const pineboo = (head: string, packFact: string, ...ingredients: CopyIngredient[]): ProductCopyFallback =>
  entry(`${head} Bao bì ghi eco-enzyme lên men từ vỏ dứa. ${packFact}`, ECO_ENZYME_PINEAPPLE, ...ingredients);

const MANUAL: Record<string, ProductCopyFallback> = {
  'xit-tram-cho-be-pineboo-150ml': pineboo(
    'Xịt tràm cho bé Pineboo, quy cách 150ml.',
    'Dạng bình xịt dùng bên ngoài cơ thể, bao bì ghi Outside Body Spray.',
    named('Tràm'),
  ),
  'bot-rua-tay-cho-be-pineboo-300ml': pineboo('Bọt rửa tay cho bé Pineboo, quy cách 300ml.', 'Dạng bọt, bao bì ghi Foaming Hand Soap for Kids.'),
  'bot-tam-goi-cho-be-pineboo-500ml': pineboo(
    'Bọt tắm gội cho bé Pineboo, quy cách 500ml, tắm và gội trong một chai bọt.',
    'Bao bì ghi thêm bọt từ ngô.',
    named('Ngô', 'Bao bì ghi bọt từ ngô'),
  ),
  'nuoc-giat-cho-be-pineboo-2-1l': pineboo(
    'Nước giặt sinh học cho bé Pineboo, quy cách 2,1L.',
    'Bao bì ghi Baby Laundry Detergent.',
    named('Enzyme sinh học', 'Bao bì ghi chiết xuất enzyme sinh học'),
  ),
  'nuoc-giat-cho-be-pineboo-500ml': pineboo(
    'Nước giặt sinh học cho bé Pineboo, quy cách 500ml.',
    'Bao bì ghi Baby Laundry Detergent.',
    named('Enzyme sinh học', 'Bao bì ghi chiết xuất enzyme sinh học'),
  ),
  'bot-rua-binh-sua-cho-be-pineboo-500ml': pineboo(
    'Bọt rửa bình sữa cho bé Pineboo, quy cách 500ml.',
    'Dạng bọt, bao bì ghi Foaming Baby Bottle Cleanser, tạo bọt từ bột ngô.',
    named('Bột ngô', 'Bao bì ghi tạo bọt từ bột ngô'),
  ),

  'muoi-rua-chen-cho-may-fuwa3e-2kg': entry('Muối rửa chén cho máy Fuwa3e, quy cách 2kg, dùng cho máy rửa chén.', named('Muối rửa chén')),

  'duong-hoa-dua-sokfarm': entry(
    'Đường hoa dừa Sokfarm, túi 300g. Bao bì ghi thơm hương dừa.',
    named('Hoa dừa'),
  ),
  'duong-hoa-dua-sokfarm-hu-thuy-tinh-150g': entry('Đường hoa dừa Sokfarm, đóng hũ thủy tinh 150g.', named('Đường hoa dừa')),
  'mat-co-dac-sokfarm-hop-12-goi': entry('Mật cô đặc Sokfarm, hộp 12 gói.', named('Mật cô đặc')),
  'mat-hoa-dua-co-dac-sokfarm': entry('Mật hoa dừa cô đặc Sokfarm, chai thủy tinh khối lượng tịnh 250 g.', named('Mật hoa dừa')),
  'nuoc-tuong-mat-hoa-dua-sokfarm-cham': entry('Nước tương mật hoa dừa Sokfarm dùng để chấm, chai 200 ml.', named('Mật hoa dừa')),

  'granola-mix-nuts-tui-tien-loi-bh-nong': entry('Granola mix nuts BH.NONG, đóng túi tiện lợi.', named('Granola'), named('Hạt mix nuts')),
  'bot-hat-cu-qua-bh-nong-lon-400g': entry('Bột hạt củ quả BH.NONG, đóng lon 400g.', named('Hạt, củ, quả')),
  'banh-mam-hat-rong-bien-bh-nong': entry('Bánh mầm hạt rong biển BH.NONG.', named('Mầm hạt'), named('Rong biển')),

  'nuoc-mui-gia-po-lang-160ml': entry('Nước mùi già Pơ Lang, chai 160ml.', named('Mùi già')),
  'dau-goi-dau-xa-qua-bo-po-lang-300g': entry('Dầu gội và dầu xả quả bơ Pơ Lang, quy cách 300g.', named('Quả bơ')),
  'combo-son-duong-po-lang-1-thoi-co-mau-1-thoi-khong-mau': entry(
    'Combo hai thỏi son dưỡng Pơ Lang: một thỏi có màu và một thỏi không màu.',
    named('Son dưỡng có màu', 'Một thỏi trong combo'),
    named('Son dưỡng không màu', 'Một thỏi trong combo'),
  ),
  'combo-sach-diu-nhe-po-lang-srm-tt': entry('Combo sạch dịu nhẹ Pơ Lang gồm hai sản phẩm ký hiệu SRM và TT.'),
  'dau-rua-mat-po-lang-100ml-55ml': entry(
    'Dầu rửa mặt Pơ Lang, quy cách 100ml hoặc 55ml. Bao bì ghi dầu bơ và vitamin E, chiết xuất từ dầu bơ và dầu hạt chanh dây.',
    named('Dầu bơ', PACK),
    named('Dầu hạt chanh dây', PACK),
    named('Vitamin E', PACK),
  ),
  'mat-na-bo-tuoi-po-lang': entry(
    'Mặt nạ bơ tươi Pơ Lang, gồm gói bột bơ tươi 3,5 gram và gói khoáng tươi 10 gram.',
    named('Bột bơ tươi', 'Gói 3,5 gram'),
    named('Khoáng tươi', 'Gói 10 gram'),
  ),
};

const CATALOG: Record<string, ProductCopyFallback> = {
  ...Object.fromEntries(Object.entries(FUWA3E_SKUS).map(([slug, row]) => [slug, fuwaCopy(row)])),
  ...Object.fromEntries(Object.entries(FUWA3E_DISH_WASH).map(([slug, row]) => [slug, fuwaCopy(row)])),
  ...MANUAL,
};

const has = (table: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

/** Chữ dự phòng của một slug, hoặc undefined nếu catalog chưa có. Dùng cho spec; mã gọi dùng `resolveProductCopyFallback` hay `withProductCopyFallback`. */
export function findProductCopyFallback(slug: string): ProductCopyFallback | undefined {
  const key = baseSlug(slug);
  return has(CATALOG, key) ? CATALOG[key] : undefined;
}

const blankText = (v: string | null | undefined): boolean => !v || v.replace(/<[^>]*>|&nbsp;/gi, ' ').trim() === '';

function readIngredients(v: ProductCopyInput['ingredients']): CopyIngredient[] {
  if (typeof v === 'string') {
    return v
      .split(/[,;\n]/)
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }
  return (v ?? []).filter((i) => !blankText(i?.name));
}

/**
 * Mô tả và thành phần hiển thị: giá trị DB nếu có chữ, nếu không thì chữ dự phòng của slug (nếu có), nếu không nữa thì rỗng.
 * Thành phần DB là danh sách thì trả lại đúng các phần tử đó (giữ nguyên `percentage`, `benefit`).
 */
export function resolveProductCopyFallback(p: ProductCopyInput): ProductCopyFallback {
  const own = readIngredients(p.ingredients);
  const fb = findProductCopyFallback(p.slug);
  return {
    description: blankText(p.description) ? (fb?.description ?? '') : (p.description as string),
    ingredients: own.length > 0 ? own : (fb?.ingredients ?? []),
  };
}

/** Gắn chữ dự phòng vào một sản phẩm. Không có gì để bù thì trả lại chính đối tượng đó (không tạo bản sao, nên React Query giữ tham chiếu cũ). */
export function withProductCopyFallback<T extends { slug: string; description: string; ingredients?: CopyIngredient[] | null }>(p: T): T {
  const needsDescription = blankText(p.description);
  const needsIngredients = readIngredients(p.ingredients).length === 0;
  if (!needsDescription && !needsIngredients) return p;
  const fb = findProductCopyFallback(p.slug);
  if (!fb) return p;
  return {
    ...p,
    ...(needsDescription ? { description: fb.description } : null),
    ...(needsIngredients ? { ingredients: fb.ingredients } : null),
  };
}
