import type { AssemblyStep, HudCalloutPoint, IngredientLayerSprite, ProductStoryConfig, StoryFrom } from '@tubutree/shared-types';
import { STORY_PRESETS } from './story-presets';

/**
 * Kịch bản đợt đầu cho năm sản phẩm thật trên PROD (Sokfarm, BH.NONG, PƠ LANG, Fuwa3e, DURICA). Khoá theo slug gốc: slug PROD có thêm
 * hậu tố băm sáu ký tự (`duong-hoa-dua-sokfarm-d6c685`), `findStoryPreset` bỏ hậu tố đó rồi mới tra.
 *
 * Nguồn chữ duy nhất là chữ in trên bao bì và tên sản phẩm trong catalog PROD (docs/product-story-Rollout-Plan.md mục 4). Cố ý KHÔNG có
 * nơi sản xuất, nguồn gốc vùng miền, chứng nhận hữu cơ, công dụng sức khoẻ hay thông số đo lường: PROD chưa có `ingredients` hay giấy tờ
 * của nhãn hàng, và những câu đó là tuyên bố cần chứng minh. `story-presets-launch.spec.ts` chặn chúng. Thêm câu mới thì phải có nguồn.
 *
 * Hình lấy từ thư viện 14 sprite; sprite chỉ gần đúng (không có hình dừa, bơ, chanh dây) nên đặt nhãn riêng theo đúng nguyên liệu,
 * không để lộ tên sprite ("Giọt mật ong") thành nhãn của thứ khác. Không có cảnh vòng cung: nó sinh từ phân loại thật lúc chạy.
 */

let seq = 100;
function L(spriteId: string, label: string, from: StoryFrom, xPct: number, yPct: number, scale = 1, rotateDeg = 0): IngredientLayerSprite {
  seq += 1;
  return { id: `p${seq}`, spriteId, label, from, xPct, yPct, scale, rotateDeg };
}
const step = (title: string, body: string, ...layers: IngredientLayerSprite[]): AssemblyStep => ({ title, body, layers });
const pt = (id: string, xPct: number, yPct: number, side: 'left' | 'right', label: string): HudCalloutPoint => ({ id, xPct, yPct, label, side });

function preset(steps: AssemblyStep[], points: HudCalloutPoint[], closing: string): ProductStoryConfig {
  return {
    version: 1,
    enabled: true,
    scenes: [
      { kind: 'ingredient_assembly', steps },
      { kind: 'hud_callouts', points, closing },
    ],
  };
}

/**
 * Mỗi mục: slug gốc (không hậu tố) → kịch bản. Thứ tự theo Rollout Plan mục 4. Chỉ đặt lớp hình ở bước có sprite thật sự khớp nguyên liệu
 * (giọt mật, giọt dầu, lát dứa, hạt cà phê, hạt granola); bước chưa có hình phù hợp để trống thay vì gắn nhãn lên hình khác vật.
 * Cả năm kịch bản bật sẵn (`enabled: true`); admin tắt từng sản phẩm bằng ô "Bật câu chuyện sản phẩm" trong Story Studio rồi Lưu.
 */
export const LAUNCH_STORY_PRESETS: Record<string, ProductStoryConfig> = {
  'duong-hoa-dua-sokfarm': preset(
    [
      step('Từ hoa dừa', 'Đường hoa dừa, thơm hương dừa.', L('honey-drop', 'Mật hoa dừa', 'top', 30, 24, 1.1, -15)),
      step('Nhiệt độ thấp', 'Bao bì ghi công nghệ chế biến nhiệt độ thấp.'),
      step('Không qua tinh luyện', 'Bao bì ghi không qua tinh luyện.'),
    ],
    [pt('h1', 26, 30, 'left', '100% nguyên chất'), pt('h2', 74, 46, 'right', 'Thơm hương dừa'), pt('h3', 26, 64, 'left', 'Chế biến nhiệt độ thấp'), pt('h4', 74, 80, 'right', 'Không qua tinh luyện')],
    'Vị ngọt tự nhiên từ hoa dừa',
  ),
  'banh-mam-hat-yen-mach-bh-nong': preset(
    [
      step('Gạo lứt mầm', 'Tên bánh in trên bao có gạo lứt mầm.'),
      step('Hạt yến mạch', 'Và có hạt yến mạch.', L('granola-clusters', 'Hạt yến mạch', 'right', 74, 30, 1.1, 10)),
      step('Nhiều lớp mỏng', 'Bao bì ghi công nghệ 1000 lớp.'),
    ],
    [pt('h1', 26, 34, 'left', 'Gạo lứt mầm'), pt('h2', 74, 52, 'right', 'Hạt yến mạch'), pt('h3', 26, 72, 'left', 'Công nghệ 1000 lớp')],
    'Bánh gạo lứt mầm yến mạch',
  ),
  'dau-rua-mat-po-lang-100ml-55ml': preset(
    [
      step('Dầu bơ', 'Bao bì ghi có dầu bơ.', L('oil-drop', 'Dầu bơ', 'top', 30, 24, 1.1, -15)),
      step('Dầu hạt chanh dây', 'Bao bì ghi thêm dầu hạt chanh dây.', L('oil-drop', 'Dầu hạt chanh dây', 'right', 74, 30, 0.9, 10)),
      step('Vitamin E', 'Bao bì ghi có vitamin E.'),
    ],
    [pt('h1', 26, 34, 'left', 'Dầu bơ'), pt('h2', 74, 52, 'right', 'Dầu hạt chanh dây'), pt('h3', 26, 72, 'left', 'Vitamin E')],
    'Dầu bơ, dầu hạt chanh dây, vitamin E',
  ),
  'dau-goi-thao-duoc-po-lang-300g': preset(
    [
      step('Gừng và bưởi', 'Có phiên bản hương gừng bưởi.', L('pomelo-peel', 'Vỏ bưởi', 'top', 30, 24, 1.1, -15)),
      step('Hương bạc hà', 'Và phiên bản hương bạc hà.', L('ocimum-leaf', 'Lá bạc hà', 'right', 74, 30, 0.95, 10)),
      step('Chai 300g', 'Một chai dầu gội thảo dược 300g.'),
    ],
    [pt('h1', 26, 34, 'left', 'Thảo dược Pơ Lang'), pt('h2', 74, 52, 'right', 'Bạc hà · Gừng bưởi'), pt('h3', 26, 72, 'left', 'Chai 300g')],
    'Dầu gội thảo dược Pơ Lang 300g',
  ),
  'nuoc-rua-chen-fuwa3e-3-8l': preset(
    [
      step('Enzyme vỏ dứa', 'Ảnh sản phẩm ghi làm sạch bằng enzyme vỏ dứa lên men.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15)),
      step('Hương dứa', 'Ảnh sản phẩm ghi hương dứa.', L('pineapple-enzyme', 'Hương dứa', 'right', 74, 30, 0.9, 10)),
      step('Can 3,8L', 'Một can 3,8 lít.'),
    ],
    [pt('h1', 26, 34, 'left', 'Enzyme vỏ dứa lên men'), pt('h2', 74, 52, 'right', 'Hương dứa'), pt('h3', 26, 72, 'left', 'Can 3,8L')],
    'Sạch bằng enzyme từ vỏ dứa',
  ),
  'nuoc-rua-chen-fuwa3e-500ml': preset(
    [
      step('Enzyme vỏ dứa', 'Ảnh sản phẩm ghi làm sạch bằng enzyme vỏ dứa lên men.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15)),
      step('Hương dứa', 'Ảnh sản phẩm ghi hương dứa.', L('pineapple-enzyme', 'Hương dứa', 'right', 74, 30, 0.9, 10)),
      step('Chai 500ml', 'Một chai 500ml cho bồn rửa hằng ngày.'),
    ],
    [pt('h1', 26, 34, 'left', 'Enzyme vỏ dứa lên men'), pt('h2', 74, 52, 'right', 'Hương dứa'), pt('h3', 26, 72, 'left', 'Chai 500ml')],
    'Sạch bằng enzyme từ vỏ dứa',
  ),
  'nuoc-rua-chen-fuwa3e-100ml': preset(
    [
      step('Enzyme vỏ dứa', 'Ảnh sản phẩm ghi làm sạch bằng enzyme vỏ dứa lên men.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15)),
      step('Hương dứa', 'Ảnh sản phẩm ghi hương dứa.', L('pineapple-enzyme', 'Hương dứa', 'right', 74, 30, 0.9, 10)),
      step('Chai 100ml', 'Cỡ chai nhỏ 100ml gọn mang theo.'),
    ],
    [pt('h1', 26, 34, 'left', 'Enzyme vỏ dứa lên men'), pt('h2', 74, 52, 'right', 'Hương dứa'), pt('h3', 26, 72, 'left', 'Chai 100ml')],
    'Sạch bằng enzyme từ vỏ dứa',
  ),
  'ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi': preset(
    [
      step('Cà phê', 'Hương vị bắt đầu từ cà phê.', L('arabica-bean', 'Cà phê', 'top', 30, 24, 1.1, -15)),
      step('Sầu riêng', 'Kết hợp với sầu riêng, thơm béo.'),
      step('Hộp mười gói', 'Mỗi hộp có mười gói.'),
    ],
    [pt('h1', 26, 34, 'left', 'Cà phê'), pt('h2', 74, 52, 'right', 'Sầu riêng'), pt('h3', 26, 72, 'left', 'Hộp 10 gói')],
    'Cà phê thơm béo vị sầu riêng',
  ),
};

/**
 * Kịch bản theo SKU cho 6 sản phẩm Pineboo và 39 sản phẩm Fuwa3e còn hàng trên PROD (ảnh chụp catalog 12/11/2026) chưa có kịch bản riêng ở trên.
 * Nguồn: tên sản phẩm và chữ in trên ảnh bao bì của từng SKU, đã đối chiếu. Bao bì Pineboo và Fuwa3e in eco-enzyme lên men từ vỏ dứa; KHÔNG có
 * thân tre hay sợi tre nào (mô tả Pineboo là tre/tăm bông/khăn giấy là sai). Ảnh vài SKU lệch tên (ảnh "nước rửa chén 100ml" mang tiêu đề bồn cầu)
 * nên chữ chỉ lấy khi khớp tên SKU. Câu bao bì cần giấy tờ (diệt khuẩn kèm %, chứng chỉ, Vegan, "an toàn", xua đuổi côn trùng) không chép lại:
 * `story-presets-launch.spec.ts` chặn bằng `copy-claims-guard.ts`. Muối rửa chén cho máy 2kg cố ý không có kịch bản riêng vì bao bì không nêu enzyme;
 * nó nhận kịch bản cấp nhãn (`brand-story.ts`).
 *
 * Hàng bảng Fuwa3e: [loại hàng như trong tên, quy cách, bậc, hương]. Bậc 2 = bao bì ghi enzyme lên men từ vỏ dứa; bậc 1 = chỉ thấy logo Enzyme Cleaner
 * hay "Eco-enzyme làm nền tảng"; bậc 0 = SKU chưa có ảnh bao bì để đối chiếu nên chỉ nói đúng điều tên đã nêu (thương hiệu, loại hàng, quy cách).
 * Hương lấy từ tên SKU, hoặc từ dòng "HƯƠNG ..." in trên nhãn đúng loại hàng đó.
 */
export type FuwaRow = readonly [type: string, size: string, tier: 0 | 1 | 2, scent?: string];
export const FUWA3E_SKUS: Record<string, FuwaRow> = {
  'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l': ['Refill Nước rửa tay dạng Bọt', '10L', 0],
  'lau-noi-that-o-to-fuwa3e-300ml': ['Lau nội thất ô tô', '300ml', 0],
  'xit-khu-mui-o-to-fuwa3e-150ml': ['Xịt khử mùi ô tô', '150ml', 0],
  'xit-thom-huong-xuan-fuwa3e-300ml': ['Xịt thơm hương Xuân', '300ml', 0, 'Xuân'],
  'refill-nuoc-lau-san-que-fuwa3e-10l': ['Refill Nước lau sàn Quế', '10L', 2, 'Quế'],
  'nuoc-lau-san-sa-chanh-fuwa3e-100ml': ['Nước lau sàn Sả chanh', '100ml', 2, 'Sả chanh'],
  'nuoc-ngam-rua-thuc-pham-fuwa3e-100ml': ['Nước ngâm rửa thực phẩm', '100ml', 2],
  've-sinh-nha-tam-va-toilet-fuwa3e-100ml': ['Vệ sinh nhà tắm và toilet', '100ml', 2],
  'refill-nuoc-giat-bac-ha-fuwa3e-10l': ['Refill nước giặt Bạc hà', '10L', 2, 'Bạc hà'],
  'nuoc-giat-huong-bac-ha-fuwa3e-3-5l': ['Nước giặt hương Bạc hà', '3,5L', 2, 'Bạc hà'],
  'nuoc-giat-huong-bac-ha-fuwa3e-500ml': ['Nước giặt hương Bạc hà', '500ml', 1, 'Bạc hà'],
  'nuoc-giat-huong-bac-ha-fuwa3e-100ml': ['Nước giặt hương Bạc hà', '100ml', 2, 'Bạc hà'],
  'nuoc-giat-huong-cam-fuwa3e-500ml': ['Nước giặt hương Cam', '500ml', 2, 'Cam'],
  'nuoc-giat-huong-cam-fuwa3e-100ml': ['Nước giặt hương Cam', '100ml', 2, 'Cam'],
  'nuoc-rua-tay-dang-bot-fuwa3e-3-8l': ['Nước rửa tay dạng Bọt', '3,8L', 2, 'Quýt'],
  'nuoc-rua-tay-dang-bot-fuwa3e-300ml': ['Nước rửa tay dạng Bọt', '300ml', 2, 'Quýt'],
  'refill-nuoc-rua-tay-dang-gel-fuwa3e-10l': ['Refill Nước rửa tay dạng Gel', '10L', 2],
  'gel-rua-chen-cho-may-fuwa3e-500ml': ['Gel rửa chén cho máy', '500ml', 1, 'Cam'],
  'gel-rua-chen-cho-may-fuwa3e-100ml': ['Gel rửa chén cho máy', '100ml', 2, 'Cam'],
  'lau-da-nang-fuwa3e-2l': ['Lau đa năng', '2L', 2, 'Nhu'],
  've-sinh-nha-tam-va-toilet-fuwa3e-2l': ['Vệ sinh nhà tắm và toilet', '2L', 2, 'Khuynh diệp'],
  'nuoc-rua-tay-dang-gel-fuwa3e-300ml': ['Nước rửa tay dạng Gel', '300ml', 2, 'Quýt'],
  'nuoc-lau-ban-tho-fuwa3e-500ml': ['Nước lau bàn thờ', '500ml', 1, 'Quế'],
  'nuoc-giat-do-lot-fuwa3e-500ml': ['Nước giặt đồ lót', '500ml', 2, 'Chanh vàng'],
  'refill-nuoc-ngam-rua-thuc-pham-fuwa3e-10l': ['Refill Nước ngâm rửa thực phẩm', '10L', 2],
  'refill-nuoc-lau-san-sa-chanh-fuwa3e-10l': ['Refill Nước lau sàn Sả chanh', '10L', 2, 'Sả chanh'],
  'refill-nuoc-giat-cam-fuwa3e-10l': ['Refill nước giặt Cam', '10L', 2, 'Cam'],
  'refill-nuoc-rua-chen-fuwa3e-10l': ['Refill Nước rửa chén', '10L', 2],
  'nuoc-ngam-rua-thuc-pham-fuwa3e-1l': ['Nước ngâm rửa thực phẩm', '1L', 2],
  'nuoc-lau-da-nang-fuwa3e-500ml': ['Nước lau đa năng', '500ml', 2, 'Nhu'],
  'nuoc-lau-san-sa-chanh-fuwa3e-1l': ['Nước lau sàn Sả chanh', '1L', 1, 'Sả chanh'],
  'nuoc-rua-tay-dang-gel-fuwa3e-3-8l': ['Nước rửa tay dạng Gel', '3,8L', 2, 'Quýt'],
  'nuoc-ngam-rua-thuc-pham-fuwa3e-3-8l': ['Nước ngâm rửa thực phẩm', '3,8L', 2],
  'nuoc-ho-tro-xa-lam-bong-fuwa3e-500ml': ['Nước hỗ trợ xả & làm bóng', '500ml', 1],
  'refill-ve-sinh-bon-cau-fuwa3e-10l': ['Refill Vệ sinh bồn cầu', '10L', 2],
  'refill-gel-rua-chen-cho-may-fuwa3e-10l': ['Refill Gel rửa chén cho máy', '10L', 2],
  'refill-lau-da-nang-fuwa3e-10l': ['Refill Lau đa năng', '10L', 2],
  've-sinh-nha-tam-va-toilet-fuwa3e-500ml': ['Vệ sinh nhà tắm và toilet', '500ml', 2],
  'nuoc-giat-huong-cam-fuwa3e-3-5l': ['Nước giặt hương Cam', '3,5L', 1, 'Cam'],
};

const SCENT_SPRITE: Record<string, readonly [spriteId: string, label: string]> = { 'Sả chanh': ['lemongrass', 'Sả chanh'], Nhu: ['ocimum-leaf', 'Hương nhu'] };
const SLOTS_3 = [[26, 34, 'left'], [74, 52, 'right'], [26, 72, 'left']] as const;
const SLOTS_4 = [[26, 30, 'left'], [74, 46, 'right'], [26, 64, 'left'], [74, 80, 'right']] as const;
const points = (labels: readonly string[]): HudCalloutPoint[] => {
  const slots = labels.length > 3 ? SLOTS_4 : SLOTS_3;
  return labels.map((label, i) => pt(`h${i + 1}`, slots[i]![0], slots[i]![1], slots[i]![2], label));
};
const SIZE_NOTE = 'Chọn quy cách vừa với nhu cầu của nhà bạn.';

function fuwaPreset([type, size, tier, scent]: FuwaRow): ProductStoryConfig {
  const scentSprite = scent ? SCENT_SPRITE[scent] : undefined;
  const hương = scent ? `Hương ${scent.toLowerCase()}` : null;
  return preset(
    [
      tier === 2
        ? step('Từ vỏ dứa lên men', 'Bao bì ghi enzyme lên men từ vỏ dứa.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15))
        : tier === 1
          ? step('Dòng Enzyme Cleaner', 'Bao bì ghi Fuwa3e Enzyme Cleaner.')
          : step('Thương hiệu Fuwa3e', 'Sản phẩm của thương hiệu Fuwa3e.'),
      step(type, hương ? `${hương}.` : 'Một sản phẩm trong dòng Fuwa3e.', ...(scentSprite ? [L(scentSprite[0], scentSprite[1], 'right', 74, 30, 0.95, 10)] : [])),
      step(`Quy cách ${size}`, SIZE_NOTE, ...(tier !== 2 && !scentSprite ? [L('water-droplet', 'Giọt nước', 'right', 74, 30, 0.9, 10)] : [])),
    ],
    points([tier === 2 ? 'Enzyme từ vỏ dứa' : tier === 1 ? 'Enzyme Cleaner' : 'Thương hiệu Fuwa3e', type, ...(hương ? [hương] : []), `Quy cách ${size}`]),
    tier === 2 ? 'Sạch bằng enzyme từ vỏ dứa' : tier === 1 ? 'Fuwa3e, dòng Enzyme Cleaner' : 'Sản phẩm thương hiệu Fuwa3e',
  );
}

function pinebooPreset(type: string, size: string, fact: string, ...extra: IngredientLayerSprite[]): ProductStoryConfig {
  return preset(
    [
      step('Từ vỏ dứa lên men', 'Bao bì ghi eco-enzyme lên men từ vỏ dứa.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15)),
      step(type, fact, ...extra),
      step(`Quy cách ${size}`, SIZE_NOTE),
    ],
    points(['Eco-enzyme từ vỏ dứa', type, `Quy cách ${size}`]),
    'Pineboo, eco-enzyme từ vỏ dứa cho bé',
  );
}

export const CATALOG_STORY_PRESETS: Record<string, ProductStoryConfig> = {
  'xit-tram-cho-be-pineboo-150ml': pinebooPreset('Xịt tràm cho bé', '150ml', 'Bình xịt, bao bì ghi Outside Body Spray.', L('cajeput-leaf', 'Tràm', 'right', 74, 30, 0.95, 10)),
  'bot-rua-tay-cho-be-pineboo-300ml': pinebooPreset('Bọt rửa tay cho bé', '300ml', 'Dạng bọt, bao bì ghi Foaming Hand Soap for Kids.'),
  'bot-tam-goi-cho-be-pineboo-500ml': pinebooPreset('Bọt tắm gội cho bé', '500ml', 'Tắm và gội trong một chai bọt, bao bì ghi bọt từ ngô.'),
  'nuoc-giat-cho-be-pineboo-2-1l': pinebooPreset('Nước giặt sinh học cho bé', '2,1L', 'Bao bì ghi nước giặt sinh học cho bé.'),
  'nuoc-giat-cho-be-pineboo-500ml': pinebooPreset('Nước giặt sinh học cho bé', '500ml', 'Bao bì ghi nước giặt sinh học cho bé.'),
  'bot-rua-binh-sua-cho-be-pineboo-500ml': pinebooPreset('Bọt rửa bình sữa cho bé', '500ml', 'Dạng bọt, bao bì ghi tạo bọt từ bột ngô.'),
  ...Object.fromEntries(Object.entries(FUWA3E_SKUS).map(([slug, row]) => [slug, fuwaPreset(row)])),
};

/** Slug đồng bộ Pancake trên PROD có hậu tố băm 6–8 ký tự hex ở cuối; chuẩn hoá rồi bỏ hậu tố để khớp slug gốc. */
export const baseSlug = (slug: string): string =>
  slug
    .trim()
    .toLowerCase()
    .replace(/-[0-9a-f]{6,8}$/i, '');

/**
 * Preset cho một slug: khớp thẳng theo slug chuẩn hoá trước (LAUNCH_STORY_PRESETS, CATALOG_STORY_PRESETS rồi STORY_PRESETS), sau đó thử slug gốc đã bỏ hậu tố
 * băm Pancake (`-[0-9a-f]{6,8}$`) trên cả ba bảng. Mọi khoá tra bằng `hasOwnProperty` (không khớp tiền tố hay khớp mờ) nên sản phẩm khác
 * không bao giờ vô tình nhận kịch bản.
 */
export function findStoryPreset(slug: string): ProductStoryConfig | undefined {
  const norm = slug.trim().toLowerCase();
  if (!norm) return undefined;
  const stripped = baseSlug(norm);
  const candidates = stripped === norm ? [norm] : [norm, stripped];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(LAUNCH_STORY_PRESETS, key)) return LAUNCH_STORY_PRESETS[key];
    if (Object.prototype.hasOwnProperty.call(CATALOG_STORY_PRESETS, key)) return CATALOG_STORY_PRESETS[key];
    if (Object.prototype.hasOwnProperty.call(STORY_PRESETS, key)) return STORY_PRESETS[key];
  }
  return undefined;
}
