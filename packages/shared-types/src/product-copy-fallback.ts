import { baseSlug, isBlankHtmlText } from './catalog-text';
import { FUWA3E_SKUS, type FuwaRow } from './fuwa3e-skus';

/**
 * Mô tả và thành phần dự phòng cho trang sản phẩm khi PROD chưa có (cột `description` rỗng, `ingredients` rỗng).
 *
 * Nguyên tắc: giá trị trong DB luôn thắng, từng trường độc lập (có mô tả mà thiếu thành phần thì chỉ bù thành phần). Chữ dự phòng chỉ gồm điều đọc
 * thẳng được từ tên sản phẩm hoặc chữ in trên ảnh bao bì (khi lấy từ bao bì thì câu mở đầu bằng "Bao bì ghi"). Không có con số %, chứng nhận,
 * công dụng y tế, nguồn gốc hay so sánh hơn; muốn thêm phải có nguồn do chủ nhãn xác nhận. `copy-claims-guard.ts` chặn các điều đó trong spec.
 * SKU không có nguồn nào để lập danh sách thành phần (chưa có ảnh bao bì, hoặc tên chỉ là ký hiệu) để `ingredients` rỗng thay vì bịa; khối "Thành phần" tự ẩn.
 * Mỗi mô tả dài trong [`FALLBACK_DESCRIPTION_MIN_CHARS`, `FALLBACK_DESCRIPTION_MAX_CHARS`]. Phần nối thêm sau câu nêu tên/quy cách chỉ là vai trò của loại hàng (món ăn nhẹ, thức uống,
 * rửa mặt...) hoặc nguyên liệu mà tên đã nêu; KHÔNG có mùi vị, độ giòn/mềm, công dụng, cách dùng hay bảo quản vì catalog chưa có nguồn cho chúng.
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

/** Mô tả ngắn hơn mức này (ký tự) thì trang sản phẩm trông trống; `product-copy-fallback-full.spec.ts` và `catalog-copy-enrichment-prod111.spec.ts` giữ mọi SKU trong khoảng [MIN, MAX]. */
export const FALLBACK_DESCRIPTION_MIN_CHARS = 80;
export const FALLBACK_DESCRIPTION_MAX_CHARS = 180;

/**
 * Câu vai trò cho loại hàng Fuwa3e chưa có ảnh bao bì (bậc 0): chỉ nhắc đúng việc mà tên loại hàng đã nói, không thêm mùi, công dụng hay cách dùng.
 * Chỉ nối khi câu cơ bản chưa đủ `FALLBACK_DESCRIPTION_MIN_CHARS`.
 */
const FUWA_ROLE: Record<string, string> = {
  'Gel rửa chén cho máy': 'Dạng gel, dùng cho máy rửa chén.',
  'Lau nội thất ô tô': 'Dùng để lau bề mặt nội thất trong xe ô tô.',
  'Nước rửa chén': 'Dùng để rửa chén bát.',
  'Refill Nước rửa tay dạng Bọt': 'Bản refill dùng để châm lại chai nước rửa tay dạng bọt.',
  'Xịt khử mùi ô tô': 'Dạng xịt, dùng trong xe ô tô.',
};

function fuwaCopy([type, size, tier, scent]: FuwaRow): ProductCopyFallback {
  const facts = [
    tier === 2 ? 'Bao bì ghi enzyme lên men từ vỏ dứa.' : tier === 1 ? 'Bao bì ghi Fuwa3e Enzyme Cleaner.' : '',
    scent ? `Hương ${scent.toLowerCase()}.` : '',
    `Quy cách ${size}.`,
  ].filter(Boolean);
  const base = `${type}, một sản phẩm trong dòng Fuwa3e. ${facts.join(' ')}`;
  const role = FUWA_ROLE[type];
  return entry(
    role && base.length < FALLBACK_DESCRIPTION_MIN_CHARS ? `${base} ${role}` : base,
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

  'muoi-rua-chen-cho-may-fuwa3e-2kg': entry('Muối rửa chén cho máy Fuwa3e, quy cách 2kg, dùng cho máy rửa chén. Sản phẩm dạng muối thuộc dòng Fuwa3e, dành cho nhà có máy rửa chén.', named('Muối rửa chén')),

  'duong-hoa-dua-sokfarm': entry(
    'Đường hoa dừa Sokfarm, túi 300g. Bao bì ghi thơm hương dừa. Sản phẩm dạng đường, nguyên liệu nêu trong tên gọi là hoa dừa.',
    named('Hoa dừa'),
  ),
  'duong-hoa-dua-sokfarm-hu-thuy-tinh-150g': entry('Đường hoa dừa Sokfarm, đóng hũ thuỷ tinh 150g. Sản phẩm dạng đường, nguyên liệu nêu trong tên gọi là hoa dừa.', named('Đường hoa dừa')),
  'mat-co-dac-sokfarm-hop-12-goi': entry('Mật cô đặc Sokfarm, hộp 12 gói. Dạng mật cô đặc, đóng sẵn thành từng gói riêng trong hộp.', named('Mật cô đặc')),
  'mat-hoa-dua-co-dac-sokfarm': entry('Mật hoa dừa cô đặc Sokfarm, chai thuỷ tinh khối lượng tịnh 250 g. Dạng mật cô đặc, làm từ hoa dừa theo tên gọi.', named('Mật hoa dừa')),
  'nuoc-tuong-mat-hoa-dua-sokfarm-cham': entry('Nước tương mật hoa dừa Sokfarm dùng để chấm, chai 200 ml. Nước tương làm từ mật hoa dừa theo tên gọi, bản dùng để chấm.', named('Mật hoa dừa')),

  'granola-mix-nuts-tui-tien-loi-bh-nong': entry('Granola mix nuts BH.NONG, đóng túi tiện lợi. Granola trộn cùng các loại hạt theo tên gọi, dùng làm món ăn nhẹ.', named('Granola'), named('Hạt mix nuts')),
  'bot-hat-cu-qua-bh-nong-lon-400g': entry('Bột hạt củ quả BH.NONG, đóng lon 400g. Sản phẩm dạng bột, nguyên liệu nêu trong tên gọi gồm hạt, củ và quả.', named('Hạt, củ, quả')),
  'banh-mam-hat-rong-bien-bh-nong': entry('Bánh mầm hạt rong biển BH.NONG. Bánh làm từ mầm hạt và rong biển theo tên gọi, thuộc nhóm món ăn nhẹ.', named('Mầm hạt'), named('Rong biển')),
  'banh-mam-hat-yen-mach-bh-nong': entry('Bánh mầm hạt yến mạch BH.NONG. Bánh làm từ mầm hạt và hạt yến mạch theo tên gọi, thuộc nhóm món ăn nhẹ.', named('Mầm hạt'), named('Hạt yến mạch')),

  'nuoc-mui-gia-po-lang-160ml': entry('Nước mùi già Pơ Lang, chai 160ml. Sản phẩm dạng nước, nguyên liệu nêu trong tên gọi là mùi già.', named('Mùi già')),
  'dau-goi-dau-xa-qua-bo-po-lang-300g': entry('Dầu gội và dầu xả quả bơ Pơ Lang, quy cách 300g. Nguyên liệu nêu trong tên gọi là quả bơ, dùng khi gội đầu và xả tóc.', named('Quả bơ')),
  'combo-son-duong-po-lang-1-thoi-co-mau-1-thoi-khong-mau': entry(
    'Combo hai thỏi son dưỡng Pơ Lang: một thỏi có màu và một thỏi không màu. Hai thỏi son dưỡng môi bán chung trong một combo.',
    named('Son dưỡng có màu', 'Một thỏi trong combo'),
    named('Son dưỡng không màu', 'Một thỏi trong combo'),
  ),
  'combo-sach-diu-nhe-po-lang-srm-tt': entry('Combo sạch dịu nhẹ Pơ Lang gồm hai sản phẩm ký hiệu SRM và TT. Hai sản phẩm được bán chung trong một combo.'),
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
  'sua-hat-gao-lut-nay-mam-bh-nong-lon-400g': entry('Sữa hạt gạo lứt nảy mầm BH.NONG, đóng lon 400g. Là sữa hạt làm từ gạo lứt nảy mầm theo tên gọi, dùng như một thức uống.', named('Gạo lứt nảy mầm')),
  'sua-hat-gao-lut-nay-mam-bh-nong-khong-duong-400g-gom-18-loai-hat-thuan-chay': entry(
    'Sữa hạt gạo lứt nảy mầm BH.NONG, bản không đường, quy cách 400g, gồm 18 loại hạt.',
    named('Gạo lứt nảy mầm'),
    named('Hạt'),
  ),
  'xoai-say-deo-bh-nong': entry('Xoài sấy dẻo BH.NONG. Xoài được sấy theo kiểu dẻo như tên gọi, dùng làm món ăn vặt hoặc ăn nhẹ.', named('Xoài')),
  'thanh-gao-lut-cha-bong-bh-nong-240g': entry('Thanh gạo lứt chà bông BH.NONG, quy cách 240g. Dạng thanh làm từ gạo lứt kèm chà bông theo tên gọi, dùng làm món ăn nhẹ.', named('Gạo lứt'), named('Chà bông')),
  'thanh-gao-lut-rong-bien-bh-nong-180g': entry('Thanh gạo lứt rong biển BH.NONG, quy cách 180g. Dạng thanh làm từ gạo lứt kèm rong biển theo tên gọi, dùng làm món ăn nhẹ.', named('Gạo lứt'), named('Rong biển')),
  'mixed-nuts-granola-tui-tien-loi-hat-dinh-duong-nuong-moc': entry('Granola mixed nuts đóng túi tiện lợi, hạt nướng mộc. Gồm granola và các loại hạt nướng mộc theo tên gọi, dùng làm món ăn nhẹ.', named('Granola'), named('Hạt nướng mộc')),
  'hop-thiec-banh-mam-hat-rong-bien-225g': entry('Bánh mầm hạt rong biển, đóng hộp thiếc 225g. Bánh làm từ mầm hạt và rong biển theo tên gọi, dùng làm món ăn nhẹ.', named('Mầm hạt'), named('Rong biển')),
  'hop-thiec-banh-mam-hat-yen-mach-225g': entry('Bánh mầm hạt yến mạch, đóng hộp thiếc 225g. Bánh làm từ mầm hạt và hạt yến mạch theo tên gọi, dùng làm món ăn nhẹ.', named('Mầm hạt'), named('Hạt yến mạch')),
  'tui-tim-granola-bh-nong-250g': entry('Túi tím Granola BH.NONG, quy cách 250g. Granola của BH.NONG, nhận biết qua túi tím như tên gọi, dùng làm món ăn nhẹ.', named('Granola')),
  'granola-mix-trai-cay-say-bh-nong-lon-450g': entry('Granola mix trái cây sấy BH.NONG, đóng lon 450g. Granola trộn cùng trái cây sấy theo tên gọi, dùng làm món ăn nhẹ.', named('Granola'), named('Trái cây sấy')),
  'tra-gao-lut-ray-dau-den-bh-nong-500g': entry('Trà gạo lứt rẫy đậu đen BH.NONG, quy cách 500g. Nguyên liệu nêu trong tên gọi gồm gạo lứt rẫy và đậu đen, dùng để pha uống.', named('Gạo lứt rẫy'), named('Đậu đen')),

  'cho-be-duong-hoa-dua-sokfarm-hu-thuy-tinh-150g': entry('Đường hoa dừa Sokfarm trong mục Cho bé, đóng hũ thuỷ tinh 150g. Sản phẩm dạng đường, nguyên liệu nêu trong tên gọi là hoa dừa.', named('Đường hoa dừa')),
  'cho-be-nuoc-tuong-mat-hoa-dua-sokfarm-200ml': entry('Nước tương mật hoa dừa Sokfarm trong mục Cho bé, chai 200ml. Nước tương làm từ mật hoa dừa theo tên gọi, dùng cho bữa ăn.', named('Mật hoa dừa')),
  'cho-be-mat-co-dac-sokfarm-250g': entry('Mật cô đặc Sokfarm trong mục Cho bé, quy cách 250g. Dạng mật cô đặc, đóng theo quy cách ghi trong tên.', named('Mật cô đặc')),
  'nuoc-uong-mat-hoa-dua-tuoi-sokfarm-330ml': entry('Nước uống mật hoa dừa tươi Sokfarm, quy cách 330ml. Là thức uống từ mật hoa dừa tươi theo tên gọi.', named('Mật hoa dừa tươi')),
  'nuoc-tuong-mat-hoa-dua-sokfarm-nau': entry('Nước tương mật hoa dừa Sokfarm dùng để nấu. Nước tương làm từ mật hoa dừa theo tên gọi, bản dùng để nấu.', named('Mật hoa dừa')),

  'ca-phe-sau-rieng-tui-20x20g': entry('Cà phê sầu riêng, túi 20x20g. Vị cà phê kèm sầu riêng theo tên gọi, dùng làm thức uống.', named('Cà phê'), named('Sầu riêng')),
  'ca-phe-muoi-tui-50x16g': entry('Cà phê muối, túi 50x16g. Vị cà phê có muối theo tên gọi, đóng gói nhỏ dùng làm thức uống.', named('Cà phê'), named('Muối')),
  'ca-phe-muoi-c-sea-dam-da-thom-beo-chuan-gu-hue-hop-16g-x-10-goi': entry('Cà phê muối C&Sea, hộp 10 gói, mỗi gói 16g. Vị cà phê có muối theo tên gọi, dùng làm thức uống.', named('Cà phê'), named('Muối')),
  'ca-phe-sua-dua-hoa-tan-kafedua-le-plateau-thom-beo-16g-x-10-goi': entry('Cà phê sữa dừa hoà tan KAFEDUA Le Plateau, hộp 10 gói, mỗi gói 16g. Là cà phê sữa dừa dạng hoà tan theo tên gọi.', named('Cà phê'), named('Sữa dừa')),
  'ca-phe-trung-ahano-chuan-vi-ha-noi-thom-ngay-kho-cuong': entry('Cà phê trứng thương hiệu AHANO. Tên gọi cho thấy đây là cà phê trứng, dùng làm thức uống.', named('Cà phê'), named('Trứng')),
  'ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi': entry('Cà phê sầu riêng DURICA Le Plateau, hộp 10 gói. Vị cà phê kèm sầu riêng theo tên gọi, dùng làm thức uống.', named('Cà phê'), named('Sầu riêng')),
  'socola-hoa-tan-uong-lien-choco-oke': entry('Socola hoà tan uống liền CHOCO-OKE. Vị socola, dạng hoà tan uống liền theo tên gọi, dùng làm thức uống.', named('Socola')),

  'nuoc-nam-dong-trung-ha-thao-hector-collagen-50ml-x-10-bo-sung-collagen-ho-tro-dep-da': entry(
    'Nước nấm đông trùng hạ thảo Hector Collagen, hộp 10 chai, mỗi chai 50ml. Là thức uống đóng chai, nguyên liệu nêu trong tên gồm đông trùng hạ thảo và collagen.',
    named('Đông trùng hạ thảo'),
    named('Collagen'),
  ),
  'nuoc-dong-trung-ha-thao-hector-collagen-plus-dep-da-chong-lao-hoa-70ml-x-10-chai': entry(
    'Nước đông trùng hạ thảo Hector Collagen Plus, hộp 10 chai, mỗi chai 70ml. Là thức uống đóng chai, nguyên liệu nêu trong tên gồm đông trùng hạ thảo và collagen.',
    named('Đông trùng hạ thảo'),
    named('Collagen'),
  ),
  'nuoc-dong-trung-ha-thao-hector-sam-tang-cuong-suc-khoe-70ml-x-10-chai': entry(
    'Nước đông trùng hạ thảo Hector Sâm, hộp 10 chai, mỗi chai 70ml. Là thức uống đóng chai, nguyên liệu nêu trong tên gồm đông trùng hạ thảo và sâm.',
    named('Đông trùng hạ thảo'),
    named('Sâm'),
  ),
  'nuoc-dong-trung-ha-thao-hector-lite-thanh-loc-co-the-70ml-x-10-chai-dieu-hoa-duong-huyet': entry(
    'Nước đông trùng hạ thảo Hector Lite, hộp 10 chai, mỗi chai 70ml. Là thức uống đóng chai, nguyên liệu nêu trong tên gọi là đông trùng hạ thảo.',
    named('Đông trùng hạ thảo'),
  ),
  'nuoc-uong-sang-da-hector-white-collagen-dong-trung-ha-thao-50ml-x-10-lo': entry(
    'Nước uống Hector White Collagen đông trùng hạ thảo, hộp 10 lọ, mỗi lọ 50ml. Là thức uống đóng lọ, nguyên liệu nêu trong tên gồm collagen và đông trùng hạ thảo.',
    named('Collagen'),
    named('Đông trùng hạ thảo'),
  ),
  'nuoc-nam-dong-trung-ha-thao-hector-basic-dang-tui-25ml-x-10-goi': entry(
    'Nước nấm đông trùng hạ thảo Hector Basic dạng túi, hộp 10 gói, mỗi gói 25ml. Nguyên liệu nêu trong tên gọi là đông trùng hạ thảo.',
    named('Đông trùng hạ thảo'),
  ),
  'nuoc-uong-dong-trung-ha-thao-hector-thao-moc-25ml-x-10-goi-boi-bo-co-the-tang-suc-de-khang': entry(
    'Nước uống đông trùng hạ thảo Hector Thảo mộc, hộp 10 gói, mỗi gói 25ml. Là thức uống dạng gói, nguyên liệu nêu trong tên gồm đông trùng hạ thảo và thảo mộc.',
    named('Đông trùng hạ thảo'),
    named('Thảo mộc'),
  ),

  'dau-goi-thao-duoc-sam-visante-giam-gay-rung-500ml-cho-toc-yeu-gay-rung-chiet-xuat-sam-viet-nam': entry('Dầu gội thảo dược Sâm Visante, chai 500ml. Dòng thảo dược của Visante, chiết xuất sâm nêu trong tên gọi, dùng khi gội đầu.', named('Sâm')),
  'dau-goi-thao-duoc-sam-visante-tri-gau-giam-bet-dau-500ml-cho-toc-gau-bet-dau-chiet-xuat-sam': entry('Dầu gội thảo dược Sâm Visante, chai 500ml. Dòng thảo dược của Visante, chiết xuất sâm nêu trong tên gọi, dùng khi gội đầu.', named('Sâm')),
  'dau-xa-thao-duoc-visante-chiet-xuat-sam-duong-toc-mem-muot-500ml': entry('Dầu xả thảo dược Visante chiết xuất sâm, chai 500ml. Dòng thảo dược của Visante, thuộc nhóm dầu xả theo tên gọi.', named('Sâm')),
  'xit-duong-toc-visante-thao-duoc-chiet-xuat-sam-ngan-rung-toc-100ml': entry('Xịt dưỡng tóc thảo dược Visante chiết xuất sâm, chai 100ml. Dạng xịt, dùng để dưỡng tóc theo tên gọi.', named('Sâm')),
  'tay-te-bao-chet-da-dau-thao-duoc-visante-lam-sach-nhe-nhang-150g': entry('Tẩy tế bào chết da đầu thảo dược Visante, quy cách 150g. Dùng cho da đầu theo tên gọi, thuộc dòng thảo dược Visante.'),
  'sua-rua-mat-tao-bot-visante-chiet-xuat-sam-lam-sach-diu-nhe-150ml': entry('Sữa rửa mặt tạo bọt Visante chiết xuất sâm, quy cách 150ml. Dạng tạo bọt, dùng để rửa mặt.', named('Sâm')),
  'nuoc-tay-trang-visante-chiet-xuat-sam-thien-nhien-diu-nhe-250ml': entry('Nước tẩy trang Visante chiết xuất sâm, quy cách 250ml. Dùng để tẩy trang, nguyên liệu nêu trong tên gọi là sâm.', named('Sâm')),

  'dau-bo-tuoi-po-lang-30ml-10ml': entry('Dầu bơ tươi Pơ Lang, quy cách 30ml hoặc 10ml. Dạng dầu làm từ bơ tươi theo tên gọi, tên sản phẩm nêu hai quy cách.', named('Dầu bơ tươi')),
  'nuoc-tay-trang-po-lang-300ml': entry('Nước tẩy trang Pơ Lang, quy cách 300ml. Dùng để tẩy trang theo tên gọi, thuộc nhóm chăm sóc da mặt.'),
  'dau-goi-thao-duoc-po-lang-300g': entry('Dầu gội thảo dược Pơ Lang, quy cách 300g. Nguyên liệu nêu trong tên gọi là thảo dược, dùng khi gội đầu.', named('Thảo dược')),
  'sua-rua-mat-tao-bot-po-lang-150ml': entry('Sữa rửa mặt tạo bọt Pơ Lang, quy cách 150ml. Dạng tạo bọt, dùng để rửa mặt theo tên gọi.'),
  'dau-u-toc-po-lang-50ml': entry('Dầu ủ tóc Pơ Lang, quy cách 50ml. Dùng để ủ tóc theo tên gọi, thuộc nhóm sản phẩm chăm sóc tóc.'),
  'mat-na-ngu-po-lang-30g': entry('Mặt nạ ngủ Pơ Lang, quy cách 30g. Là mặt nạ ngủ theo tên gọi, thuộc nhóm chăm sóc da mặt.'),
  'son-duong-co-mau-po-lang-a01-a03-a04-a05': entry('Son dưỡng có màu Pơ Lang, các mã màu A01, A03, A04 và A05. Son dưỡng môi có màu, tên nêu bốn mã màu.'),
  'son-duong-bo-tuoi-po-lang-a08': entry('Son dưỡng bơ tươi Pơ Lang, mã A08. Son dưỡng môi mã A08, nguyên liệu nêu trong tên gọi là bơ tươi.', named('Bơ tươi')),
  'son-duong-gac-tuoi-a07': entry('Son dưỡng gấc tươi, mã A07. Son dưỡng môi mã A07, nguyên liệu nêu trong tên gọi là gấc tươi.', named('Gấc tươi')),

  'gel-rua-chen-cho-may-fuwa3e-2000ml': fuwaCopy(['Gel rửa chén cho máy', '2000ml', 0]),
};

const CATALOG: Record<string, ProductCopyFallback> = {
  ...Object.fromEntries(Object.entries(FUWA3E_SKUS).map(([slug, row]) => [slug, fuwaCopy(row)])),
  ...Object.fromEntries(Object.entries(FUWA3E_DISH_WASH).map(([slug, row]) => [slug, fuwaCopy(row)])),
  ...MANUAL,
  ...OUT_OF_STOCK,
};

/** Mọi slug gốc đang có chữ dự phòng. Cho spec đo trần độ dài và độ phủ catalog (api không nạp được fixture của app-core). */
export const listProductCopyFallbackSlugs = (): string[] => Object.keys(CATALOG);

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
