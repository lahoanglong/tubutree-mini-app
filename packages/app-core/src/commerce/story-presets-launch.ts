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

/** Mỗi mục: slug gốc (không hậu tố) → kịch bản. Thứ tự theo Rollout Plan mục 4. */
export const LAUNCH_STORY_PRESETS: Record<string, ProductStoryConfig> = {
  'duong-hoa-dua-sokfarm': preset(
    [
      step('Từ hoa dừa', 'Đường làm từ mật hoa dừa.', L('honey-drop', 'Mật hoa dừa', 'top', 30, 24, 1.1, -15)),
      step('Nhiệt độ thấp', 'Bao bì ghi công nghệ chế biến nhiệt độ thấp.', L('water-droplet', 'Nhiệt độ thấp', 'left', 22, 56, 0.9, 15)),
      step('Không qua tinh luyện', 'Bao bì ghi không qua tinh luyện.', L('honey-drop', 'Mật hoa dừa', 'right', 74, 30, 0.9, 10)),
    ],
    [pt('h1', 26, 30, 'left', '100% nguyên chất'), pt('h2', 74, 46, 'right', 'Thơm hương dừa'), pt('h3', 26, 64, 'left', 'Chế biến nhiệt độ thấp'), pt('h4', 74, 80, 'right', 'Không qua tinh luyện')],
    'Vị ngọt tự nhiên từ hoa dừa',
  ),
  'banh-mam-hat-yen-mach-bh-nong': preset(
    [
      step('Gạo lứt mầm', 'Tên bánh in trên bao có gạo lứt mầm.', L('granola-clusters', 'Gạo lứt mầm', 'top', 30, 24, 1, -15)),
      step('Hạt yến mạch', 'Và có hạt yến mạch.', L('granola-clusters', 'Hạt yến mạch', 'right', 74, 30, 1.1, 10)),
      step('Nhiều lớp mỏng', 'Bao bì ghi công nghệ 1000 lớp Đài Loan.', L('water-droplet', 'Lớp bánh', 'left', 22, 58, 0.9, 20)),
    ],
    [pt('h1', 26, 30, 'left', 'Gạo lứt mầm'), pt('h2', 74, 46, 'right', 'Hạt yến mạch'), pt('h3', 26, 64, 'left', 'Ăn sáng ít ngọt'), pt('h4', 74, 80, 'right', 'Công nghệ 1000 lớp')],
    'Bữa sáng ít ngọt',
  ),
  'dau-rua-mat-po-lang-100ml-55ml': preset(
    [
      step('Dầu bơ', 'Tên sản phẩm có dầu bơ.', L('oil-drop', 'Dầu bơ', 'top', 30, 24, 1.1, -15)),
      step('Dầu hạt chanh dây', 'Trên chai ghi thêm dầu hạt chanh dây.', L('oil-drop', 'Dầu hạt chanh dây', 'right', 74, 30, 0.9, 10)),
      step('Vitamin E', 'Trên chai ghi có vitamin E.', L('water-droplet', 'Vitamin E', 'left', 22, 58, 0.9, 20)),
    ],
    [pt('h1', 26, 34, 'left', 'Dầu bơ'), pt('h2', 74, 52, 'right', 'Dầu hạt chanh dây'), pt('h3', 26, 72, 'left', 'Vitamin E')],
    'Dầu bơ, dầu hạt chanh dây, vitamin E',
  ),
  'nuoc-rua-chen-fuwa3e-3-8l': preset(
    [
      step('Vỏ dứa', 'Nguyên liệu là vỏ dứa.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15)),
      step('Lên men thành enzyme', 'Bao bì ghi làm sạch bằng enzyme vỏ dứa lên men.', L('water-droplet', 'Enzyme', 'left', 22, 56, 0.9, 15)),
      step('Hương dứa', 'Bao bì ghi hương dứa.', L('pineapple-enzyme', 'Hương dứa', 'right', 74, 30, 0.9, 10)),
    ],
    [pt('h1', 26, 34, 'left', 'Enzyme vỏ dứa lên men'), pt('h2', 74, 52, 'right', 'Thành phần gốc thực vật'), pt('h3', 26, 72, 'left', 'Hương dứa')],
    'Sạch bằng enzyme từ vỏ dứa',
  ),
  'ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi': preset(
    [
      step('Cà phê', 'Hương vị bắt đầu từ cà phê.', L('arabica-bean', 'Cà phê', 'top', 30, 24, 1.1, -15)),
      step('Sầu riêng', 'Kết hợp với sầu riêng, thơm béo.', L('honey-drop', 'Sầu riêng', 'right', 74, 30, 0.9, 10)),
      step('Hộp mười gói', 'Mỗi hộp có mười gói.', L('water-droplet', 'Gói pha', 'left', 22, 58, 0.9, 20)),
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
