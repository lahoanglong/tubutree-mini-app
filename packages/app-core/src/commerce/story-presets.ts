import type { AssemblyStep, HudCalloutPoint, IngredientLayerSprite, ProductStoryConfig, StoryFrom } from '@tubutree/shared-types';
import { STORY_SPRITES } from './story-sprites';

/**
 * Kịch bản mẫu cho 10 sản phẩm dữ liệu mẫu (3 nhóm: chăm sóc cá nhân và mẹ bé, thực phẩm và đồ uống, chăm sóc nhà cửa).
 * `findStoryPreset` bỏ hậu tố băm Pancake nên slug PROD có thể khớp các khoá này; vì vậy chữ ở đây chỉ nêu tên sản phẩm, tên thành phần và quy cách
 * ghi trong dữ liệu mẫu. Không có con số %, chứng nhận, công dụng, nhãn an toàn hay "tự nhiên": `story-presets.spec.ts` chạy `copy-claims-guard.ts`
 * trên từng dòng chữ. Muốn thêm câu mới thì phải có nguồn; câu cần giấy tờ không được chép từ mô tả của chủ nhãn.
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

function pt(id: string, xPct: number, yPct: number, side: 'left' | 'right', label: string): HudCalloutPoint {
  return { id, xPct, yPct, label, side };
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

export const STORY_PRESETS: Record<string, ProductStoryConfig> = {
  // ── Nhóm 1: chăm sóc cá nhân và mẹ bé ──
  'dau-goi-buoi-po-lang': preset(
    [
      step('Nguyên liệu chính', 'Tinh dầu bưởi, bồ kết và hương nhu trong cùng một chai dầu gội.', L('pomelo-peel', 'top', 28, 22, 1.1, -20), L('gleditsia-pod', 'left', 20, 52, 1, 15)),
      step('Tinh dầu bưởi', 'Tinh dầu bưởi đứng đầu danh sách thành phần.', L('pomelo-slice', 'right', 74, 28, 1.1, 10), L('water-droplet', 'top', 64, 56, 0.8)),
      step('Bồ kết và hương nhu', 'Bồ kết và hương nhu đi cùng tinh dầu bưởi.', L('ocimum-leaf', 'right', 76, 52, 1, 25), L('gleditsia-pod', 'left', 24, 60, 0.9, -10)),
      step('Dầu gội thảo dược', 'Dầu gội thảo dược của Pơ Lang.', L('water-droplet', 'top', 50, 24, 1), L('pomelo-peel', 'bottom', 34, 70, 0.8, 40)),
      step('Dùng hằng ngày', 'Một chai dầu gội cho thói quen gội hằng ngày.', L('ocimum-leaf', 'left', 22, 30, 0.9, -30), L('pomelo-slice', 'right', 78, 66, 0.9, 20)),
    ],
    [pt('h1', 26, 30, 'left', 'Tinh dầu bưởi'), pt('h2', 74, 46, 'right', 'Bồ kết'), pt('h3', 26, 66, 'left', 'Hương nhu')],
    'Dầu gội thảo dược Pơ Lang',
  ),
  'serum-duong-am-visante': preset(
    [
      step('Nguyên liệu chính', 'Rau má, hyaluronic acid và lô hội có trong công thức serum.', L('centella-leaf', 'top', 30, 24, 1.1, -15), L('centella-leaf', 'left', 22, 56, 0.8, 20)),
      step('Chiết xuất rau má', 'Chiết xuất rau má đứng đầu danh sách thành phần.', L('centella-leaf', 'right', 74, 30, 1, 10), L('water-droplet', 'top', 60, 56, 0.8)),
      step('Hyaluronic Acid', 'Hyaluronic Acid và chiết xuất lô hội đi cùng.', L('water-droplet', 'right', 76, 50, 1), L('water-droplet', 'left', 26, 58, 0.7)),
      step('Serum dưỡng ẩm', 'Serum dưỡng ẩm Visante, có chai 30ml và 50ml.', L('water-droplet', 'top', 50, 22, 1.1), L('centella-leaf', 'bottom', 66, 72, 0.7, -30)),
      step('Một bước chăm da', 'Một bước dưỡng ẩm trong thói quen chăm da.', L('centella-leaf', 'left', 24, 30, 0.9), L('water-droplet', 'right', 78, 64, 0.8)),
    ],
    [pt('h1', 26, 30, 'left', 'Chiết xuất rau má'), pt('h2', 74, 46, 'right', 'Hyaluronic Acid'), pt('h3', 26, 66, 'left', 'Chiết xuất lô hội')],
    'Serum dưỡng ẩm Visante',
  ),
  'kem-duong-ba-bau-visante': preset(
    [
      step('Nguyên liệu chính', 'Bơ hạt mỡ và dầu jojoba có trong công thức kem.', L('shea-butter', 'top', 30, 26, 1.1, -10), L('oil-drop', 'left', 22, 56, 0.9)),
      step('Bơ hạt mỡ', 'Bơ hạt mỡ (shea) đứng đầu danh sách thành phần.', L('shea-butter', 'right', 74, 30, 1, 15), L('oil-drop', 'top', 62, 58, 0.8)),
      step('Dầu jojoba', 'Dầu jojoba đi cùng bơ hạt mỡ.', L('oil-drop', 'right', 76, 50, 1), L('shea-butter', 'left', 26, 60, 0.8, -20)),
      step('Kem dưỡng cho mẹ bầu', 'Kem dưỡng Visante dành cho mẹ bầu, hũ 100ml.', L('shea-butter', 'bottom', 50, 70, 1), L('oil-drop', 'top', 40, 24, 0.8)),
      step('Dùng hằng ngày', 'Một sản phẩm dưỡng da cho mẹ trong thai kỳ.', L('shea-butter', 'left', 24, 32, 0.8), L('oil-drop', 'right', 78, 66, 0.8)),
    ],
    [pt('h1', 26, 32, 'left', 'Bơ hạt mỡ (Shea)'), pt('h2', 74, 52, 'right', 'Dầu jojoba'), pt('h3', 26, 70, 'left', 'Hũ 100ml')],
    'Kem dưỡng cho mẹ bầu Visante',
  ),
  'nuoc-tam-goi-be-cobote': preset(
    [
      step('Nguyên liệu chính', 'Thảo dược trong nước tắm gội dành cho bé.', L('ocimum-leaf', 'top', 30, 24, 1, -15, 'Thảo dược'), L('centella-leaf', 'left', 22, 56, 0.8, 20, 'Thảo dược')),
      step('Tắm và gội', 'Một sản phẩm dùng cho cả tắm và gội.', L('water-droplet', 'right', 74, 30, 1, 0, 'Giọt nước'), L('water-droplet', 'top', 60, 58, 0.7, 0, 'Giọt nước')),
      step('Hai trong một', 'Tắm gội 2 trong 1 trong một chai.', L('ocimum-leaf', 'right', 76, 50, 0.9, 20, 'Thảo dược'), L('water-droplet', 'left', 26, 60, 0.8, 0, 'Giọt nước')),
      step('Chai 250ml', 'Chai 250ml của Cobote.', L('water-droplet', 'top', 50, 24, 1.1, 0, 'Giọt nước')),
      step('Giờ tắm của bé', 'Dành cho giờ tắm của bé.', L('centella-leaf', 'left', 24, 30, 0.8, 0, 'Thảo dược'), L('water-droplet', 'right', 78, 66, 0.8, 0, 'Giọt nước')),
    ],
    [pt('h1', 26, 34, 'left', 'Thảo dược'), pt('h2', 74, 54, 'right', 'Tắm gội 2 trong 1'), pt('h3', 26, 72, 'left', 'Chai 250ml')],
    'Nước tắm gội thảo dược cho bé',
  ),

  // ── Nhóm 2: thực phẩm và đồ uống nông sản ──
  'arabica-cau-dat-le-plateau': preset(
    [
      step('Arabica Cầu Đất', 'Cà phê Arabica Cầu Đất của Le Plateau.', L('arabica-bean', 'top', 30, 24, 1.1, -20), L('arabica-bean', 'left', 22, 56, 0.9, 30)),
      step('Hạt rang', 'Hạt cà phê được rang sẵn.', L('arabica-bean', 'right', 74, 30, 1, 10), L('arabica-bean', 'top', 60, 56, 0.8, -40)),
      step('Vị chua thanh', 'Vị chua thanh khi pha.', L('arabica-bean', 'right', 76, 52, 1, 25), L('arabica-bean', 'left', 26, 62, 0.8, -15)),
      step('Hậu vị trái cây', 'Hậu vị trái cây sau ngụm đầu tiên.', L('arabica-bean', 'bottom', 50, 70, 1.1, 5)),
      step('Nguyên hạt hoặc xay', 'Chọn nguyên hạt hoặc xay pha phin, gói 250g.', L('arabica-bean', 'left', 24, 30, 0.8, 20), L('arabica-bean', 'right', 78, 66, 0.8, -25)),
    ],
    [pt('h1', 26, 32, 'left', 'Arabica Cầu Đất'), pt('h2', 74, 52, 'right', 'Hạt rang'), pt('h3', 26, 70, 'left', 'Vị chua thanh'), pt('h4', 74, 82, 'right', 'Hậu vị trái cây')],
    'Arabica Cầu Đất, hậu vị trái cây',
  ),
  'mat-ong-rung-bhnong': preset(
    [
      step('Mật ong rừng', 'Sản phẩm mật ong rừng của BH.Nong.', L('honey-drop', 'top', 30, 22, 1.1), L('honey-drop', 'left', 22, 56, 0.8)),
      step('Rót từng giọt', 'Rót từng giọt mật ong.', L('honey-drop', 'right', 74, 30, 1), L('honey-drop', 'top', 60, 58, 0.7)),
      step('Trong bữa ăn', 'Một chai mật ong cho bữa ăn trong nhà.', L('honey-drop', 'right', 76, 50, 1.1), L('honey-drop', 'left', 26, 62, 0.8)),
      step('Chai 500ml', 'Quy cách chai 500ml.', L('honey-drop', 'top', 50, 24, 1.2)),
      step('Nguyên chất', 'Tên sản phẩm ghi mật ong rừng nguyên chất.', L('honey-drop', 'left', 24, 30, 0.8), L('honey-drop', 'right', 78, 66, 0.8)),
    ],
    [pt('h1', 26, 34, 'left', 'Mật ong rừng'), pt('h2', 74, 54, 'right', 'Nguyên chất'), pt('h3', 26, 72, 'left', 'Chai 500ml')],
    'Mật ong rừng BH.Nong',
  ),
  'granola-hat-sokfram': preset(
    [
      step('Ngũ cốc và hạt', 'Granola làm từ ngũ cốc và hạt.', L('granola-clusters', 'top', 30, 24, 1.1, -10), L('granola-clusters', 'left', 22, 56, 0.8, 15)),
      step('Từng cụm granola', 'Granola ở dạng cụm nhỏ.', L('granola-clusters', 'right', 74, 30, 1, -5), L('granola-clusters', 'top', 60, 56, 0.8, 30)),
      step('Bữa sáng', 'Granola dùng cho bữa sáng.', L('granola-clusters', 'right', 76, 50, 1, -20), L('granola-clusters', 'left', 26, 62, 0.7)),
      step('Quy cách 400g', 'Gói 400g.', L('granola-clusters', 'bottom', 50, 70, 1.1)),
      step('Sokfarm', 'Granola ngũ cốc hạt của Sokfarm.', L('granola-clusters', 'left', 24, 30, 0.8), L('granola-clusters', 'right', 78, 66, 0.7)),
    ],
    [pt('h1', 26, 34, 'left', 'Ngũ cốc'), pt('h2', 74, 54, 'right', 'Hạt'), pt('h3', 26, 72, 'left', 'Gói 400g')],
    'Granola ngũ cốc hạt Sokfarm',
  ),
  'bot-rau-ma-sokfram': preset(
    [
      step('Lá rau má', 'Nguyên liệu của sản phẩm là rau má.', L('centella-leaf', 'top', 30, 24, 1.1, -15), L('centella-leaf', 'left', 22, 56, 0.8, 20)),
      step('Sấy lạnh', 'Bột rau má được sấy lạnh.', L('water-droplet', 'right', 74, 30, 0.9), L('centella-leaf', 'top', 60, 56, 0.8, 30)),
      step('Dạng bột', 'Dạng bột để pha uống.', L('centella-leaf', 'right', 76, 50, 1, 10), L('centella-leaf', 'left', 26, 62, 0.7, -20)),
      step('Quy cách 150g', 'Gói 150g.', L('centella-leaf', 'bottom', 50, 70, 1)),
      step('Sokfarm', 'Bột rau má nguyên chất của Sokfarm.', L('centella-leaf', 'left', 24, 30, 0.8), L('water-droplet', 'right', 78, 66, 0.7)),
    ],
    [pt('h1', 26, 34, 'left', 'Rau má'), pt('h2', 74, 54, 'right', 'Sấy lạnh'), pt('h3', 26, 72, 'left', 'Pha uống')],
    'Bột rau má Sokfarm',
  ),

  // ── Nhóm 3: chăm sóc nhà cửa sinh học ──
  'nuoc-rua-chen-fuwa3e': preset(
    [
      step('Dứa và sả', 'Enzyme dứa lên men và tinh dầu sả có trong công thức.', L('pineapple-enzyme', 'top', 30, 24, 1.1, -10), L('lemongrass', 'left', 22, 56, 1, 15)),
      step('Enzyme dứa lên men', 'Nước rửa chén dùng enzyme từ dứa lên men.', L('pineapple-enzyme', 'right', 74, 30, 1, 10), L('water-droplet', 'top', 60, 56, 0.8)),
      step('Tinh dầu sả', 'Tinh dầu sả và nước cất cùng có trong công thức.', L('lemongrass', 'right', 76, 50, 1, 20), L('pineapple-enzyme', 'left', 26, 62, 0.7)),
      step('Nước rửa chén sinh học', 'Nước rửa chén sinh học, chai 1L hoặc can 5L.', L('water-droplet', 'top', 50, 24, 1.1), L('pineapple-enzyme', 'bottom', 34, 70, 0.7)),
      step('Cho gian bếp', 'Một sản phẩm cho gian bếp.', L('lemongrass', 'left', 24, 30, 0.8), L('water-droplet', 'right', 78, 66, 0.8)),
    ],
    [pt('h1', 26, 32, 'left', 'Enzyme dứa lên men'), pt('h2', 74, 52, 'right', 'Tinh dầu sả'), pt('h3', 26, 70, 'left', 'Nước cất')],
    'Nước rửa chén sinh học Fuwa3e',
  ),
  'nuoc-giat-fuwa3e': preset(
    [
      step('Dòng Fuwa3e', 'Nước giặt sinh học thuộc dòng Fuwa3e.', L('water-droplet', 'top', 30, 24, 1.1, -10), L('water-droplet', 'left', 22, 56, 0.8, 15)),
      step('Dạng nước', 'Nước giặt dạng lỏng.', L('water-droplet', 'right', 74, 30, 1, 10), L('water-droplet', 'top', 60, 56, 0.8)),
      step('Quy cách 2L', 'Chai 2 lít.', L('water-droplet', 'right', 76, 50, 1), L('water-droplet', 'left', 26, 62, 0.7, -20)),
      step('Cho cả nhà', 'Dùng cho quần áo trong nhà.', L('water-droplet', 'top', 50, 24, 1.1)),
      step('Giặt hằng ngày', 'Một sản phẩm cho việc giặt hằng ngày.', L('water-droplet', 'left', 24, 30, 0.8), L('water-droplet', 'right', 78, 66, 0.8)),
    ],
    [pt('h1', 26, 34, 'left', 'Nước giặt sinh học'), pt('h2', 74, 54, 'right', 'Quy cách 2L'), pt('h3', 26, 72, 'left', 'Fuwa3e')],
    'Nước giặt sinh học Fuwa3e',
  ),
};
