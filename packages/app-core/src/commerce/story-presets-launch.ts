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
  'nuoc-rua-chen-fuwa3e-3-8l': preset(
    [
      step('Enzyme vỏ dứa', 'Ảnh sản phẩm ghi làm sạch bằng enzyme vỏ dứa lên men.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15)),
      step('Hương dứa', 'Ảnh sản phẩm ghi hương dứa.', L('pineapple-enzyme', 'Hương dứa', 'right', 74, 30, 0.9, 10)),
      step('Can 3,8L', 'Một can 3,8 lít.'),
    ],
    [pt('h1', 26, 34, 'left', 'Enzyme vỏ dứa lên men'), pt('h2', 74, 52, 'right', 'Hương dứa'), pt('h3', 26, 72, 'left', 'Can 3,8L')],
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

/** Slug PROD có hậu tố băm sáu ký tự hex ở cuối; bỏ nó để khớp slug gốc. */
export const baseSlug = (slug: string): string => slug.replace(/-[0-9a-f]{6}$/, '');

/**
 * Preset cho một slug: mẫu seed khớp đúng slug, rồi mẫu đợt đầu khớp đúng slug hoặc slug gốc. Không khớp thì undefined.
 * Mọi tên có thật trong bảng (không dùng tiền tố hay khớp mờ) nên một sản phẩm khác không bao giờ vô tình nhận kịch bản.
 */
export function findStoryPreset(slug: string): ProductStoryConfig | undefined {
  if (Object.prototype.hasOwnProperty.call(STORY_PRESETS, slug)) return STORY_PRESETS[slug];
  for (const key of [slug, baseSlug(slug)]) {
    if (Object.prototype.hasOwnProperty.call(LAUNCH_STORY_PRESETS, key)) return LAUNCH_STORY_PRESETS[key];
  }
  return undefined;
}
