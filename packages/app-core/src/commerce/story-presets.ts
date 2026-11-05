import type { AssemblyStep, HudCalloutPoint, IngredientLayerSprite, ProductStoryConfig, StoryFrom } from '@tubutree/shared-types';
import { STORY_SPRITES } from './story-sprites';

/**
 * Kịch bản mẫu cho 10 sản phẩm chủ lực (3 nhóm: chăm sóc cá nhân và mẹ bé, thực phẩm và đồ uống, chăm sóc nhà cửa).
 * Chỉ nêu điều có trong dữ liệu sản phẩm (thành phần, phần trăm, chứng nhận, mô tả ngắn); phần trăm chỉ lấy từ `ingredients`.
 * Không có cảnh vòng cung: nó sinh từ biến thể thật lúc chạy (`resolveStoryConfig`).
 */

let seq = 0;
function L(spriteId: string, from: StoryFrom, xPct: number, yPct: number, scale = 1, rotateDeg = 0, label?: string): IngredientLayerSprite {
  seq += 1;
  return { id: `l${seq}`, spriteId, label: label ?? STORY_SPRITES[spriteId]?.label ?? spriteId, from, xPct, yPct, scale, rotateDeg };
}

function step(title: string, body: string, ...layers: IngredientLayerSprite[]): AssemblyStep {
  return { title, body, layers };
}

function pt(id: string, xPct: number, yPct: number, side: 'left' | 'right', label: string, value?: string): HudCalloutPoint {
  const p: HudCalloutPoint = { id, xPct, yPct, label, side };
  if (value) {
    p.value = value;
    const n = Number.parseFloat(value);
    if (/%$/.test(value) && Number.isFinite(n)) p.barPct = Math.min(100, Math.max(0, n));
  }
  return p;
}

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

const T1 = 'Tinh tuyển nguyên liệu';
const T3 = 'Hoà quyện đa tầng';
const T4 = 'Tinh chất hoàn thiện';
const T5 = 'An lành cho cả nhà';

export const STORY_PRESETS: Record<string, ProductStoryConfig> = {
  // ── Nhóm 1: chăm sóc cá nhân và mẹ bé ──
  'dau-goi-buoi-po-lang': preset(
    [
      step(T1, 'Vỏ bưởi, bồ kết và hương nhu, dược liệu Tây Nguyên được chọn từng loại.', L('pomelo-peel', 'top', 28, 22, 1.1, -20), L('gleditsia-pod', 'left', 20, 52, 1, 15)),
      step('Chiết xuất tinh dầu', 'Tinh dầu bưởi giúp kích thích mọc tóc, giảm gãy rụng.', L('pomelo-slice', 'right', 74, 28, 1.1, 10), L('water-droplet', 'top', 64, 56, 0.8)),
      step(T3, 'Bồ kết làm sạch dịu nhẹ, hương nhu thư giãn da đầu.', L('ocimum-leaf', 'right', 76, 52, 1, 25), L('gleditsia-pod', 'left', 24, 60, 0.9, -10)),
      step(T4, 'Dầu gội thảo dược mượt tóc, sạch gàu tự nhiên.', L('water-droplet', 'top', 50, 24, 1), L('pomelo-peel', 'bottom', 34, 70, 0.8, 40)),
      step(T5, 'Dịu nhẹ để cả nhà gội mỗi ngày.', L('ocimum-leaf', 'left', 22, 30, 0.9, -30), L('pomelo-slice', 'right', 78, 66, 0.9, 20)),
    ],
    [pt('h1', 26, 30, 'left', 'Tinh dầu bưởi', '2%'), pt('h2', 74, 46, 'right', 'Bồ kết'), pt('h3', 26, 66, 'left', 'Hương nhu'), pt('h4', 74, 80, 'right', 'Vegan')],
    'Mượt tóc từ thảo dược Tây Nguyên',
  ),
  'serum-duong-am-visante': preset(
    [
      step(T1, 'Rau má và lô hội được chọn để làm dịu da nhạy cảm.', L('centella-leaf', 'top', 30, 24, 1.1, -15), L('centella-leaf', 'left', 22, 56, 0.8, 20)),
      step('Chiết xuất rau má', 'Chiết xuất rau má 5% giúp phục hồi, làm dịu da.', L('centella-leaf', 'right', 74, 30, 1, 10), L('water-droplet', 'top', 60, 56, 0.8)),
      step(T3, 'Hyaluronic Acid 2% cấp ẩm sâu, da căng mịn.', L('water-droplet', 'right', 76, 50, 1), L('water-droplet', 'left', 26, 58, 0.7)),
      step(T4, 'Serum cấp ẩm chuyên sâu, thấm nhanh.', L('water-droplet', 'top', 50, 22, 1.1), L('centella-leaf', 'bottom', 66, 72, 0.7, -30)),
      step(T5, 'Lành tính cho làn da nhạy cảm.', L('centella-leaf', 'left', 24, 30, 0.9), L('water-droplet', 'right', 78, 64, 0.8)),
    ],
    [pt('h1', 26, 30, 'left', 'Chiết xuất rau má', '5%'), pt('h2', 74, 46, 'right', 'Hyaluronic Acid', '2%'), pt('h3', 26, 66, 'left', 'Chiết xuất lô hội'), pt('h4', 74, 80, 'right', 'USDA Organic')],
    'Cấp ẩm sâu, dịu nhẹ cho da nhạy cảm',
  ),
  'kem-duong-ba-bau-visante': preset(
    [
      step(T1, 'Bơ hạt mỡ và dầu jojoba cho làn da thai kỳ.', L('shea-butter', 'top', 30, 26, 1.1, -10), L('oil-drop', 'left', 22, 56, 0.9)),
      step('Chắt lọc dưỡng chất', 'Bơ hạt mỡ 8% giúp tăng đàn hồi, ngừa rạn da.', L('shea-butter', 'right', 74, 30, 1, 15), L('oil-drop', 'top', 62, 58, 0.8)),
      step(T3, 'Dầu jojoba dưỡng ẩm sâu, thẩm thấu nhanh.', L('oil-drop', 'right', 76, 50, 1), L('shea-butter', 'left', 26, 60, 0.8, -20)),
      step(T4, 'Kem dưỡng ngừa rạn da, lành tính cho thai kỳ.', L('shea-butter', 'bottom', 50, 70, 1), L('oil-drop', 'top', 40, 24, 0.8)),
      step(T5, 'Mẹ nhẹ nhàng, bé an toàn.', L('shea-butter', 'left', 24, 32, 0.8), L('oil-drop', 'right', 78, 66, 0.8)),
    ],
    [pt('h1', 26, 32, 'left', 'Bơ hạt mỡ (Shea)', '8%'), pt('h2', 74, 52, 'right', 'Dầu jojoba'), pt('h3', 26, 70, 'left', 'USDA Organic')],
    'Lành tính cho mẹ bầu',
  ),
  'nuoc-tam-goi-be-cobote': preset(
    [
      step(T1, 'Thảo dược dịu nhẹ dành cho làn da của bé.', L('ocimum-leaf', 'top', 30, 24, 1, -15, 'Thảo dược'), L('centella-leaf', 'left', 22, 56, 0.8, 20, 'Thảo dược')),
      step('Dịu nhẹ từng giọt', 'Công thức không cay mắt bé.', L('water-droplet', 'right', 74, 30, 1, 0, 'Giọt dịu nhẹ'), L('water-droplet', 'top', 60, 58, 0.7, 0, 'Giọt dịu nhẹ')),
      step(T3, 'Tắm và gội trong một sản phẩm.', L('ocimum-leaf', 'right', 76, 50, 0.9, 20, 'Thảo dược'), L('water-droplet', 'left', 26, 60, 0.8, 0, 'Giọt dịu nhẹ')),
      step(T4, 'Tắm gội 2 trong 1, không cay mắt bé.', L('water-droplet', 'top', 50, 24, 1.1, 0, 'Giọt dịu nhẹ')),
      step(T5, 'Giờ tắm của bé thêm nhẹ nhàng.', L('centella-leaf', 'left', 24, 30, 0.8, 0, 'Thảo dược'), L('water-droplet', 'right', 78, 66, 0.8, 0, 'Giọt dịu nhẹ')),
    ],
    [pt('h1', 26, 34, 'left', 'Tắm gội 2 trong 1'), pt('h2', 74, 54, 'right', 'Không cay mắt bé'), pt('h3', 26, 72, 'left', 'Vegan')],
    'An lành cho bé mỗi ngày',
  ),

  // ── Nhóm 2: thực phẩm và đồ uống nông sản ──
  'arabica-cau-dat-le-plateau': preset(
    [
      step(T1, 'Arabica trồng ở độ cao 1.650 m tại Cầu Đất.', L('arabica-bean', 'top', 30, 24, 1.1, -20), L('arabica-bean', 'left', 22, 56, 0.9, 30)),
      step('Rang specialty', 'Hạt rang specialty giữ hương hoa tự nhiên.', L('arabica-bean', 'right', 74, 30, 1, 10), L('arabica-bean', 'top', 60, 56, 0.8, -40)),
      step(T3, 'Chua thanh, hậu vị cam quýt.', L('arabica-bean', 'right', 76, 52, 1, 25), L('arabica-bean', 'left', 26, 62, 0.8, -15)),
      step(T4, 'Hạt rang specialty, hậu vị trái cây.', L('arabica-bean', 'bottom', 50, 70, 1.1, 5)),
      step(T5, 'Một tách cà phê cho buổi sáng chậm rãi.', L('arabica-bean', 'left', 24, 30, 0.8, 20), L('arabica-bean', 'right', 78, 66, 0.8, -25)),
    ],
    [pt('h1', 26, 32, 'left', 'Arabica Cầu Đất 1.650m', '100%'), pt('h2', 74, 52, 'right', 'Hương hoa'), pt('h3', 26, 70, 'left', 'Hậu vị cam quýt'), pt('h4', 74, 82, 'right', 'Specialty')],
    'Hương hoa, hậu vị cam quýt',
  ),
  'mat-ong-rung-bhnong': preset(
    [
      step(T1, 'Mật ong rừng được lấy từ thiên nhiên.', L('honey-drop', 'top', 30, 22, 1.1), L('honey-drop', 'left', 22, 56, 0.8)),
      step('Rót từng giọt', 'Mật ong rừng tự nhiên, không pha đường.', L('honey-drop', 'right', 74, 30, 1), L('honey-drop', 'top', 60, 58, 0.7)),
      step(T3, 'Giọt mật vàng óng quyện đều.', L('honey-drop', 'right', 76, 50, 1.1), L('honey-drop', 'left', 26, 62, 0.8)),
      step(T4, 'Nguyên chất, không pha đường.', L('honey-drop', 'top', 50, 24, 1.2)),
      step(T5, 'Vị ngọt tự nhiên cho cả nhà.', L('honey-drop', 'left', 24, 30, 0.8), L('honey-drop', 'right', 78, 66, 0.8)),
    ],
    [pt('h1', 26, 34, 'left', 'Mật ong rừng tự nhiên'), pt('h2', 74, 54, 'right', 'Không pha đường'), pt('h3', 26, 72, 'left', 'Nguyên chất')],
    'Vị ngọt tự nhiên từ rừng',
  ),
  'granola-hat-sokfram': preset(
    [
      step(T1, 'Ngũ cốc và các loại hạt được chọn kỹ.', L('granola-clusters', 'top', 30, 24, 1.1, -10), L('granola-clusters', 'left', 22, 56, 0.8, 15)),
      step('Kết dính bằng mật ong', 'Vị ngọt nhẹ đến từ mật ong.', L('honey-drop', 'right', 74, 30, 1), L('granola-clusters', 'top', 60, 56, 0.8, 30)),
      step(T3, 'Hạt giòn hoà quyện trong từng miếng.', L('granola-clusters', 'right', 76, 50, 1, -20), L('honey-drop', 'left', 26, 62, 0.7)),
      step(T4, 'Ăn sáng healthy, ngọt nhẹ từ mật ong.', L('granola-clusters', 'bottom', 50, 70, 1.1)),
      step(T5, 'Bữa sáng nhẹ nhàng cho cả nhà.', L('granola-clusters', 'left', 24, 30, 0.8), L('honey-drop', 'right', 78, 66, 0.7)),
    ],
    [pt('h1', 26, 34, 'left', 'Ngọt nhẹ từ mật ong'), pt('h2', 74, 54, 'right', 'Không đường tinh luyện'), pt('h3', 26, 72, 'left', 'Ăn sáng healthy')],
    'Bữa sáng healthy, ngọt nhẹ',
  ),
  'bot-rau-ma-sokfram': preset(
    [
      step(T1, 'Lá rau má tươi được chọn lựa.', L('centella-leaf', 'top', 30, 24, 1.1, -15), L('centella-leaf', 'left', 22, 56, 0.8, 20)),
      step('Sấy lạnh', 'Sấy lạnh để giữ dưỡng chất.', L('water-droplet', 'right', 74, 30, 0.9), L('centella-leaf', 'top', 60, 56, 0.8, 30)),
      step(T3, 'Xay mịn thành bột rau má nguyên chất.', L('centella-leaf', 'right', 76, 50, 1, 10), L('centella-leaf', 'left', 26, 62, 0.7, -20)),
      step(T4, 'Pha uống tiện lợi, mọi lúc mọi nơi.', L('centella-leaf', 'bottom', 50, 70, 1)),
      step(T5, 'Thức uống xanh cho cả nhà.', L('centella-leaf', 'left', 24, 30, 0.8), L('water-droplet', 'right', 78, 66, 0.7)),
    ],
    [pt('h1', 26, 34, 'left', 'Sấy lạnh giữ dưỡng chất'), pt('h2', 74, 54, 'right', 'Pha uống tiện lợi'), pt('h3', 26, 72, 'left', 'Organic')],
    'Xanh tự nhiên, tiện mỗi ngày',
  ),

  // ── Nhóm 3: chăm sóc nhà cửa sinh học ──
  'nuoc-rua-chen-fuwa3e': preset(
    [
      step(T1, 'Dứa và sả được chọn để làm sạch tự nhiên.', L('pineapple-enzyme', 'top', 30, 24, 1.1, -10), L('lemongrass', 'left', 22, 56, 1, 15)),
      step('Chiết xuất và lên men', 'Dứa lên men enzyme phân giải dầu mỡ.', L('pineapple-enzyme', 'right', 74, 30, 1, 10), L('water-droplet', 'top', 60, 56, 0.8)),
      step(T3, 'Tinh dầu sả khử mùi tanh, kháng khuẩn tự nhiên.', L('lemongrass', 'right', 76, 50, 1, 20), L('pineapple-enzyme', 'left', 26, 62, 0.7)),
      step(T4, 'Sạch dầu mỡ, không hại da tay.', L('water-droplet', 'top', 50, 24, 1.1), L('pineapple-enzyme', 'bottom', 34, 70, 0.7)),
      step(T5, 'Phân huỷ sinh học, an tâm cho gian bếp.', L('lemongrass', 'left', 24, 30, 0.8), L('water-droplet', 'right', 78, 66, 0.8)),
    ],
    [pt('h1', 26, 32, 'left', 'Enzyme dứa lên men', '15%'), pt('h2', 74, 52, 'right', 'Tinh dầu sả'), pt('h3', 26, 70, 'left', 'Nước cất'), pt('h4', 74, 82, 'right', 'Eco')],
    'Sạch dầu mỡ, dịu với da tay',
  ),
  'nuoc-giat-fuwa3e': preset(
    [
      step(T1, 'Thành phần sinh học được chọn cho đồ của bé.', L('pineapple-enzyme', 'top', 30, 24, 1, -10, 'Enzyme'), L('lemongrass', 'left', 22, 56, 0.9, 15, 'Thảo mộc')),
      step('Lên men enzyme', 'Enzyme sinh học làm sạch sâu.', L('pineapple-enzyme', 'right', 74, 30, 1, 10, 'Enzyme'), L('water-droplet', 'top', 60, 56, 0.8)),
      step(T3, 'Hoà quyện nhẹ nhàng, sạch sâu mà dịu.', L('water-droplet', 'right', 76, 50, 1), L('lemongrass', 'left', 26, 62, 0.7, -20, 'Thảo mộc')),
      step(T4, 'Sạch sâu, dịu nhẹ cho đồ em bé.', L('water-droplet', 'top', 50, 24, 1.1)),
      step(T5, 'Quần áo thơm sạch cho cả nhà.', L('lemongrass', 'left', 24, 30, 0.8, 0, 'Thảo mộc'), L('water-droplet', 'right', 78, 66, 0.8)),
    ],
    [pt('h1', 26, 34, 'left', 'Sạch sâu'), pt('h2', 74, 54, 'right', 'Dịu nhẹ cho đồ em bé'), pt('h3', 26, 72, 'left', 'Eco')],
    'Sạch sâu, dịu nhẹ cho cả nhà',
  ),
};
