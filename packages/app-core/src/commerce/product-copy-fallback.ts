import { baseSlug, isBlankHtmlText } from './catalog-text';
import { FUWA3E_SKUS, type FuwaRow } from './story-presets-launch';

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
  'banh-mam-hat-yen-mach-bh-nong': entry('Bánh mầm hạt yến mạch BH.NONG.', named('Mầm hạt'), named('Hạt yến mạch')),

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

/**
 * 47 SKU đang hết hàng trên PROD (ảnh chụp catalog 12/11/2026), để trang sản phẩm có chữ ngay khi hàng về. Nguồn duy nhất là tên sản phẩm: chưa đối
 * chiếu ảnh bao bì nên không có câu "Bao bì ghi". Phần tên nêu công dụng, nguồn gốc hay nhãn ("giảm gãy rụng", "trị gàu", "sáng da", "thiên nhiên",
 * "thuần chay", "chuẩn gu Huế"...) không chép lại vì cần giấy tờ; chỉ giữ loại hàng, thương hiệu, quy cách và tên nguyên liệu tên đã nêu.
 * Không có nguồn để lập thành phần (tên chỉ nêu loại hàng) thì `ingredients` để trống.
 */
const OUT_OF_STOCK: Record<string, ProductCopyFallback> = {
  'sua-hat-gao-lut-nay-mam-bh-nong-lon-400g': entry('Sữa hạt gạo lứt nảy mầm BH.NONG, đóng lon 400g.', named('Gạo lứt nảy mầm')),
  'sua-hat-gao-lut-nay-mam-bh-nong-khong-duong-400g-gom-18-loai-hat-thuan-chay': entry(
    'Sữa hạt gạo lứt nảy mầm BH.NONG, bản không đường, quy cách 400g, gồm 18 loại hạt.',
    named('Gạo lứt nảy mầm'),
    named('Hạt'),
  ),
  'xoai-say-deo-bh-nong': entry('Xoài sấy dẻo BH.NONG.', named('Xoài')),
  'thanh-gao-lut-cha-bong-bh-nong-240g': entry('Thanh gạo lứt chà bông BH.NONG, quy cách 240g.', named('Gạo lứt'), named('Chà bông')),
  'thanh-gao-lut-rong-bien-bh-nong-180g': entry('Thanh gạo lứt rong biển BH.NONG, quy cách 180g.', named('Gạo lứt'), named('Rong biển')),
  'mixed-nuts-granola-tui-tien-loi-hat-dinh-duong-nuong-moc': entry('Granola mixed nuts đóng túi tiện lợi, hạt nướng mộc.', named('Granola'), named('Hạt nướng mộc')),
  'hop-thiec-banh-mam-hat-rong-bien-225g': entry('Bánh mầm hạt rong biển, đóng hộp thiếc 225g.', named('Mầm hạt'), named('Rong biển')),
  'hop-thiec-banh-mam-hat-yen-mach-225g': entry('Bánh mầm hạt yến mạch, đóng hộp thiếc 225g.', named('Mầm hạt'), named('Hạt yến mạch')),
  'tui-tim-granola-bh-nong-250g': entry('Túi tím Granola BH.NONG, quy cách 250g.', named('Granola')),
  'granola-mix-trai-cay-say-bh-nong-lon-450g': entry('Granola mix trái cây sấy BH.NONG, đóng lon 450g.', named('Granola'), named('Trái cây sấy')),
  'tra-gao-lut-ray-dau-den-bh-nong-500g': entry('Trà gạo lứt rẫy đậu đen BH.NONG, quy cách 500g.', named('Gạo lứt rẫy'), named('Đậu đen')),

  'cho-be-duong-hoa-dua-sokfarm-hu-thuy-tinh-150g': entry('Đường hoa dừa Sokfarm trong mục Cho bé, đóng hũ thủy tinh 150g.', named('Đường hoa dừa')),
  'cho-be-nuoc-tuong-mat-hoa-dua-sokfarm-200ml': entry('Nước tương mật hoa dừa Sokfarm trong mục Cho bé, chai 200ml.', named('Mật hoa dừa')),
  'cho-be-mat-co-dac-sokfarm-250g': entry('Mật cô đặc Sokfarm trong mục Cho bé, quy cách 250g.', named('Mật cô đặc')),
  'nuoc-uong-mat-hoa-dua-tuoi-sokfarm-330ml': entry('Nước uống mật hoa dừa tươi Sokfarm, quy cách 330ml.', named('Mật hoa dừa tươi')),
  'nuoc-tuong-mat-hoa-dua-sokfarm-nau': entry('Nước tương mật hoa dừa Sokfarm dùng để nấu.', named('Mật hoa dừa')),

  'ca-phe-sau-rieng-tui-20x20g': entry('Cà phê sầu riêng, túi 20x20g.', named('Cà phê'), named('Sầu riêng')),
  'ca-phe-muoi-tui-50x16g': entry('Cà phê muối, túi 50x16g.', named('Cà phê'), named('Muối')),
  'ca-phe-muoi-c-sea-dam-da-thom-beo-chuan-gu-hue-hop-16g-x-10-goi': entry('Cà phê muối C&Sea, hộp 10 gói, mỗi gói 16g.', named('Cà phê'), named('Muối')),
  'ca-phe-sua-dua-hoa-tan-kafedua-le-plateau-thom-beo-16g-x-10-goi': entry('Cà phê sữa dừa hoà tan KAFEDUA Le Plateau, hộp 10 gói, mỗi gói 16g.', named('Cà phê'), named('Sữa dừa')),
  'ca-phe-trung-ahano-chuan-vi-ha-noi-thom-ngay-kho-cuong': entry('Cà phê trứng thương hiệu AHANO.', named('Cà phê'), named('Trứng')),
  'ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi': entry('Cà phê sầu riêng DURICA Le Plateau, hộp 10 gói.', named('Cà phê'), named('Sầu riêng')),
  'socola-hoa-tan-uong-lien-choco-oke': entry('Socola hoà tan uống liền CHOCO-OKE.', named('Socola')),

  'nuoc-nam-dong-trung-ha-thao-hector-collagen-50ml-x-10-bo-sung-collagen-ho-tro-dep-da': entry(
    'Nước nấm đông trùng hạ thảo Hector Collagen, hộp 10 chai, mỗi chai 50ml.',
    named('Đông trùng hạ thảo'),
    named('Collagen'),
  ),
  'nuoc-dong-trung-ha-thao-hector-collagen-plus-dep-da-chong-lao-hoa-70ml-x-10-chai': entry(
    'Nước đông trùng hạ thảo Hector Collagen Plus, hộp 10 chai, mỗi chai 70ml.',
    named('Đông trùng hạ thảo'),
    named('Collagen'),
  ),
  'nuoc-dong-trung-ha-thao-hector-sam-tang-cuong-suc-khoe-70ml-x-10-chai': entry(
    'Nước đông trùng hạ thảo Hector Sâm, hộp 10 chai, mỗi chai 70ml.',
    named('Đông trùng hạ thảo'),
    named('Sâm'),
  ),
  'nuoc-dong-trung-ha-thao-hector-lite-thanh-loc-co-the-70ml-x-10-chai-dieu-hoa-duong-huyet': entry(
    'Nước đông trùng hạ thảo Hector Lite, hộp 10 chai, mỗi chai 70ml.',
    named('Đông trùng hạ thảo'),
  ),
  'nuoc-uong-sang-da-hector-white-collagen-dong-trung-ha-thao-50ml-x-10-lo': entry(
    'Nước uống Hector White Collagen đông trùng hạ thảo, hộp 10 lọ, mỗi lọ 50ml.',
    named('Collagen'),
    named('Đông trùng hạ thảo'),
  ),
  'nuoc-nam-dong-trung-ha-thao-hector-basic-dang-tui-25ml-x-10-goi': entry(
    'Nước nấm đông trùng hạ thảo Hector Basic dạng túi, hộp 10 gói, mỗi gói 25ml.',
    named('Đông trùng hạ thảo'),
  ),
  'nuoc-uong-dong-trung-ha-thao-hector-thao-moc-25ml-x-10-goi-boi-bo-co-the-tang-suc-de-khang': entry(
    'Nước uống đông trùng hạ thảo Hector Thảo mộc, hộp 10 gói, mỗi gói 25ml.',
    named('Đông trùng hạ thảo'),
    named('Thảo mộc'),
  ),

  'dau-goi-thao-duoc-sam-visante-giam-gay-rung-500ml-cho-toc-yeu-gay-rung-chiet-xuat-sam-viet-nam': entry('Dầu gội thảo dược Sâm Visante, chai 500ml.', named('Sâm')),
  'dau-goi-thao-duoc-sam-visante-tri-gau-giam-bet-dau-500ml-cho-toc-gau-bet-dau-chiet-xuat-sam': entry('Dầu gội thảo dược Sâm Visante, chai 500ml.', named('Sâm')),
  'dau-xa-thao-duoc-visante-chiet-xuat-sam-duong-toc-mem-muot-500ml': entry('Dầu xả thảo dược Visante chiết xuất sâm, chai 500ml.', named('Sâm')),
  'xit-duong-toc-visante-thao-duoc-chiet-xuat-sam-ngan-rung-toc-100ml': entry('Xịt dưỡng tóc thảo dược Visante chiết xuất sâm, chai 100ml.', named('Sâm')),
  'tay-te-bao-chet-da-dau-thao-duoc-visante-lam-sach-nhe-nhang-150g': entry('Tẩy tế bào chết da đầu thảo dược Visante, quy cách 150g.'),
  'sua-rua-mat-tao-bot-visante-chiet-xuat-sam-lam-sach-diu-nhe-150ml': entry('Sữa rửa mặt tạo bọt Visante chiết xuất sâm, quy cách 150ml.', named('Sâm')),
  'nuoc-tay-trang-visante-chiet-xuat-sam-thien-nhien-diu-nhe-250ml': entry('Nước tẩy trang Visante chiết xuất sâm, quy cách 250ml.', named('Sâm')),

  'dau-bo-tuoi-po-lang-30ml-10ml': entry('Dầu bơ tươi Pơ Lang, quy cách 30ml hoặc 10ml.', named('Dầu bơ tươi')),
  'nuoc-tay-trang-po-lang-300ml': entry('Nước tẩy trang Pơ Lang, quy cách 300ml.'),
  'dau-goi-thao-duoc-po-lang-300g': entry('Dầu gội thảo dược Pơ Lang, quy cách 300g.', named('Thảo dược')),
  'sua-rua-mat-tao-bot-po-lang-150ml': entry('Sữa rửa mặt tạo bọt Pơ Lang, quy cách 150ml.'),
  'dau-u-toc-po-lang-50ml': entry('Dầu ủ tóc Pơ Lang, quy cách 50ml.'),
  'mat-na-ngu-po-lang-30g': entry('Mặt nạ ngủ Pơ Lang, quy cách 30g.'),
  'son-duong-co-mau-po-lang-a01-a03-a04-a05': entry('Son dưỡng có màu Pơ Lang, các mã màu A01, A03, A04 và A05.'),
  'son-duong-bo-tuoi-po-lang-a08': entry('Son dưỡng bơ tươi Pơ Lang, mã A08.', named('Bơ tươi')),
  'son-duong-gac-tuoi-a07': entry('Son dưỡng gấc tươi, mã A07.', named('Gấc tươi')),

  'gel-rua-chen-cho-may-fuwa3e-2000ml': fuwaCopy(['Gel rửa chén cho máy', '2000ml', 0]),
};

const CATALOG: Record<string, ProductCopyFallback> = {
  ...Object.fromEntries(Object.entries(FUWA3E_SKUS).map(([slug, row]) => [slug, fuwaCopy(row)])),
  ...Object.fromEntries(Object.entries(FUWA3E_DISH_WASH).map(([slug, row]) => [slug, fuwaCopy(row)])),
  ...MANUAL,
  ...OUT_OF_STOCK,
};

const has = (table: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

/** Chữ dự phòng của một slug, hoặc undefined nếu catalog chưa có. Dùng cho spec; mã gọi dùng `resolveProductCopyFallback` hay `withProductCopyFallback`. */
export function findProductCopyFallback(slug: string): ProductCopyFallback | undefined {
  const key = baseSlug(slug);
  return has(CATALOG, key) ? CATALOG[key] : undefined;
}

const blankText = isBlankHtmlText;

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
