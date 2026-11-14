import { baseSlug, FUWA3E_SKUS, parseStoryConfig, type AssemblyStep, type FuwaRow, type HudCalloutPoint, type IngredientLayerSprite, type ProductStoryConfig, type StoryFrom } from '@tubutree/shared-types';
import { STORY_PRESETS } from './story-presets';

export { baseSlug, FUWA3E_SKUS, type FuwaRow };

/**
 * Kịch bản đợt đầu cho năm sản phẩm thật trên PROD (Sokfarm, BH.NONG, PƠ LANG, Fuwa3e, DURICA). Khoá theo slug gốc: slug PROD có thêm
 * hậu tố băm sáu ký tự (`duong-hoa-dua-sokfarm-d6c685`), `findStoryPreset` bỏ hậu tố đó rồi mới tra.
 *
 * Nguồn sự thật duy nhất là chữ in trên bao bì và tên sản phẩm trong catalog PROD (docs/product-story-Rollout-Plan.md mục 4); giọng văn thì ấm và gần gũi, không chép
 * kiểu hồ sơ ("Bao bì ghi..."). Mỗi sự thật chỉ nói một lần trong phần thân chương, tiêu đề chương là lời dẫn, điểm nhấn (chip dưới ảnh) là nhãn ngắn. Cố ý KHÔNG có
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

/** Ba cỡ nước rửa chén Fuwa3e dùng chung câu chuyện: chỉ chương cuối (cỡ) và nhãn quy cách đổi theo cỡ. */
function dishwashPreset(sizeTitle: string, sizeBody: string, sizeChip: string): ProductStoryConfig {
  return preset(
    [
      step('Món quà của trái dứa', 'Enzyme từ vỏ dứa lên men đồng hành cùng bạn sau mỗi bữa cơm gia đình.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15)),
      step('Thoang thoảng hương dứa', 'Hương dứa nhẹ nhàng ở lại bên bồn rửa sau mỗi bữa ăn.', L('pineapple-enzyme', 'Hương dứa', 'right', 74, 30, 0.9, 10)),
      step(sizeTitle, sizeBody),
    ],
    [pt('h1', 26, 34, 'left', 'Enzyme vỏ dứa lên men'), pt('h2', 74, 52, 'right', 'Hương dứa'), pt('h3', 26, 72, 'left', sizeChip)],
    'Bữa cơm xong, bồn rửa cũng nhẹ lòng',
  );
}

/**
 * Mỗi mục: slug gốc (không hậu tố) → kịch bản. Thứ tự theo Rollout Plan mục 4. Chỉ đặt lớp hình ở bước có sprite thật sự khớp nguyên liệu
 * (giọt mật, giọt dầu, lát dứa, hạt cà phê, hạt granola); bước chưa có hình phù hợp để trống thay vì gắn nhãn lên hình khác vật.
 * Cả năm kịch bản bật sẵn (`enabled: true`); admin tắt từng sản phẩm bằng ô "Bật câu chuyện sản phẩm" trong Story Studio rồi Lưu.
 */
export const LAUNCH_STORY_PRESETS: Record<string, ProductStoryConfig> = {
  'duong-hoa-dua-sokfarm': preset(
    [
      step('Ngọt dịu từ hoa dừa', 'Một thìa đường mang theo hương dừa, như buổi sáng bên hiên nhà.', L('honey-drop', 'Mật hoa dừa', 'top', 30, 24, 1.1, -15)),
      step('Chậm rãi từng công đoạn', 'Chế biến ở nhiệt độ thấp, từ tốn như cách bạn chăm chút bữa cơm gia đình.'),
      step('Giữ vẻ mộc mạc', 'Không qua tinh luyện, để vị ngọt giữ nguyên dáng vẻ ban đầu.'),
    ],
    [pt('h1', 26, 30, 'left', '100% nguyên chất'), pt('h2', 74, 46, 'right', 'Thơm hương dừa'), pt('h3', 26, 64, 'left', 'Chế biến nhiệt độ thấp'), pt('h4', 74, 80, 'right', 'Không qua tinh luyện')],
    'Vị ngọt dịu cho căn bếp nhà bạn',
  ),
  'banh-mam-hat-yen-mach-bh-nong': preset(
    [
      step('Khởi đầu từ gạo lứt mầm', 'Gạo lứt mầm làm nên phần thân bánh, mộc mạc cho bữa ăn nhẹ của bạn.'),
      step('Thêm một người bạn', 'Hạt yến mạch góp mặt cùng gạo lứt mầm, thêm vui cho buổi trà chiều.', L('granola-clusters', 'Hạt yến mạch', 'right', 74, 30, 1.1, 10)),
      step('Từng lớp mỏng tỉ mỉ', 'Công nghệ 1000 lớp xếp chồng những lớp bánh mỏng, để mỗi miếng cắn thêm thú vị.'),
    ],
    [pt('h1', 26, 34, 'left', 'Gạo lứt mầm'), pt('h2', 74, 52, 'right', 'Hạt yến mạch'), pt('h3', 26, 72, 'left', 'Công nghệ 1000 lớp')],
    'Bữa nhẹ cho một ngày thong thả',
  ),
  'dau-rua-mat-po-lang-100ml-55ml': preset(
    [
      step('Khởi đầu buổi sáng', 'Dầu bơ mở đầu cho thói quen rửa mặt mỗi sáng của bạn.', L('oil-drop', 'Dầu bơ', 'top', 30, 24, 1.1, -15)),
      step('Thêm một người bạn', 'Dầu hạt chanh dây góp mặt cùng dầu bơ trong cùng một chai nhỏ gọn.', L('oil-drop', 'Dầu hạt chanh dây', 'right', 74, 30, 0.9, 10)),
      step('Điểm nhấn cuối cùng', 'Và vitamin E, để chai dầu rửa mặt thêm trọn vẹn.'),
    ],
    [pt('h1', 26, 34, 'left', 'Dầu bơ'), pt('h2', 74, 52, 'right', 'Dầu hạt chanh dây'), pt('h3', 26, 72, 'left', 'Vitamin E')],
    'Một chai nhỏ cho mỗi sáng của bạn',
  ),
  'dau-goi-thao-duoc-po-lang-300g': preset(
    [
      step('Ấm áp gừng bưởi', 'Một phiên bản mang hương gừng bưởi cho giờ gội đầu thư thả.', L('pomelo-peel', 'Vỏ bưởi', 'top', 30, 24, 1.1, -15)),
      step('Dịu mát bạc hà', 'Phiên bản còn lại thoang thoảng hương bạc hà cho ngày dài của bạn.', L('ocimum-leaf', 'Lá bạc hà', 'right', 74, 30, 0.95, 10)),
      step('Gọn trong tay', 'Chai 300g vừa gọn cho kệ nhà tắm của bạn.'),
    ],
    [pt('h1', 26, 34, 'left', 'Thảo dược Pơ Lang'), pt('h2', 74, 52, 'right', 'Bạc hà · Gừng bưởi'), pt('h3', 26, 72, 'left', 'Chai 300g')],
    'Giờ gội đầu thư thả mỗi ngày',
  ),
  'nuoc-rua-chen-fuwa3e-3-8l': dishwashPreset('Can lớn cho nhà đông người', 'Can 3,8L dành cho những căn bếp dùng nhiều mỗi ngày.', 'Can 3,8L'),
  'nuoc-rua-chen-fuwa3e-500ml': dishwashPreset('Chai vừa tay', 'Chai 500ml cho bồn rửa hằng ngày của bạn.', 'Chai 500ml'),
  'nuoc-rua-chen-fuwa3e-100ml': dishwashPreset('Gọn để mang theo', 'Chai 100ml nhỏ gọn, mang theo khi bạn cần.', 'Chai 100ml'),
  'ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi': preset(
    [
      step('Một tách cho buổi sáng', 'Buổi sáng của bạn bắt đầu từ một tách cà phê.', L('arabica-bean', 'Cà phê', 'top', 30, 24, 1.1, -15)),
      step('Gặp gỡ sầu riêng', 'Cà phê hoà cùng sầu riêng, thơm béo như một món quà nhỏ cho chính bạn.'),
      step('Mười gói, mười lần nghỉ chân', 'Mỗi hộp có mười gói, để bạn pha bất cứ lúc nào muốn dừng lại một chút.'),
    ],
    [pt('h1', 26, 34, 'left', 'Cà phê'), pt('h2', 74, 52, 'right', 'Sầu riêng'), pt('h3', 26, 72, 'left', 'Hộp 10 gói')],
    'Một tách thơm béo cho khoảnh khắc nghỉ ngơi',
  ),
};

const SCENT_SPRITE: Record<string, readonly [spriteId: string, label: string]> = { 'Sả chanh': ['lemongrass', 'Sả chanh'], Nhu: ['ocimum-leaf', 'Hương nhu'] };
const SLOTS_3 = [[26, 34, 'left'], [74, 52, 'right'], [26, 72, 'left']] as const;
const SLOTS_4 = [[26, 30, 'left'], [74, 46, 'right'], [26, 64, 'left'], [74, 80, 'right']] as const;
const points = (labels: readonly string[]): HudCalloutPoint[] => {
  const slots = labels.length > 3 ? SLOTS_4 : SLOTS_3;
  return labels.map((label, i) => pt(`h${i + 1}`, slots[i]![0], slots[i]![1], slots[i]![2], label));
};
function fuwaPreset([type, size, tier, scent]: FuwaRow): ProductStoryConfig {
  const scentSprite = scent ? SCENT_SPRITE[scent] : undefined;
  const hương = scent ? `Hương ${scent.toLowerCase()}` : null;
  return preset(
    [
      tier === 2
        ? step('Món quà của trái dứa', 'Enzyme lên men từ vỏ dứa đồng hành cùng bạn trong từng lần dọn dẹp.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15))
        : tier === 1
          ? step('Một dòng quen thuộc', 'Fuwa3e Enzyme Cleaner đồng hành cùng những việc nhà thường ngày của bạn.')
          : step('Từ thương hiệu Fuwa3e', 'Sản phẩm của thương hiệu Fuwa3e, dành cho căn nhà của bạn.'),
      hương
        ? step('Thêm một làn hương', `${hương} dịu nhẹ lan trong căn nhà của bạn.`, ...(scentSprite ? [L(scentSprite[0], scentSprite[1], 'right', 74, 30, 0.95, 10)] : []))
        : step('Cho việc nhà thường ngày', `${type}, một người bạn quen thuộc của gia đình.`),
      step('Vừa đủ cho nhà bạn', 'Chọn đúng lượng cho nhịp dùng hằng ngày của gia đình bạn.', ...(tier !== 2 && !scentSprite ? [L('water-droplet', 'Giọt nước', 'right', 74, 30, 0.9, 10)] : [])),
    ],
    points([tier === 2 ? 'Enzyme từ vỏ dứa' : tier === 1 ? 'Enzyme Cleaner' : 'Thương hiệu Fuwa3e', type, ...(hương ? [hương] : []), `Quy cách ${size}`]),
    'Fuwa3e, thêm gọn gàng cho căn nhà bạn',
  );
}

function pinebooPreset(type: string, size: string, fact: string, ...extra: IngredientLayerSprite[]): ProductStoryConfig {
  return preset(
    [
      step('Khởi đầu từ trái dứa', 'Eco-enzyme lên men từ vỏ dứa đồng hành cùng bé trong những thói quen nhỏ.', L('pineapple-enzyme', 'Vỏ dứa', 'top', 30, 24, 1.1, -15)),
      step('Dành cho bé', fact, ...extra),
      step('Vừa đủ cho nhà có bé', 'Chọn đúng lượng cho nhịp dùng hằng ngày của gia đình bạn.'),
    ],
    points(['Eco-enzyme', type, `Quy cách ${size}`]),
    'Pineboo cùng bé lớn lên mỗi ngày',
  );
}

export const CATALOG_STORY_PRESETS: Record<string, ProductStoryConfig> = {
  'xit-tram-cho-be-pineboo-150ml': pinebooPreset('Xịt tràm cho bé', '150ml', 'Dạng bình xịt, gọn gàng trong túi đồ của bé.', L('cajeput-leaf', 'Tràm', 'right', 74, 30, 0.95, 10)),
  'bot-rua-tay-cho-be-pineboo-300ml': pinebooPreset('Bọt rửa tay cho bé', '300ml', 'Dạng bọt, để giờ rửa tay của bé thêm vui.'),
  'bot-tam-goi-cho-be-pineboo-500ml': pinebooPreset('Bọt tắm gội cho bé', '500ml', 'Một chai bọt từ ngô, tắm và gội trong một lần.'),
  'nuoc-giat-cho-be-pineboo-2-1l': pinebooPreset('Nước giặt sinh học cho bé', '2,1L', 'Nước giặt sinh học dành cho đồ của bé.'),
  'nuoc-giat-cho-be-pineboo-500ml': pinebooPreset('Nước giặt sinh học cho bé', '500ml', 'Nước giặt sinh học dành cho đồ của bé.'),
  'bot-rua-binh-sua-cho-be-pineboo-500ml': pinebooPreset('Bọt rửa bình sữa cho bé', '500ml', 'Dạng bọt tạo từ bột ngô, cho những chiếc bình sữa của bé.'),
  ...Object.fromEntries(Object.entries(FUWA3E_SKUS).map(([slug, row]) => [slug, fuwaPreset(row)])),
};

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

/** Tuyên bố cần giấy tờ hoặc số liệu không có trong dữ liệu PROD: không được xuất hiện trong chữ kịch bản đợt đầu. */
export const STORY_BANNED_CLAIMS =
  /trà vinh|bến tre|quảng nam|đắk lắk|đắc lắc|thanh hoá|thanh hóa|tây nguyên|hữu cơ|organic|low ?gi|vegan|thuần chay|diệt khuẩn|kháng khuẩn|calo|protein|canxi|chất xơ|lành tính|an toàn|không hoá chất|không hóa chất|chữa|điều trị|mọc tóc|giảm |tốt nhất|số 1|số một|thượng hạng|tự nhiên 100|sấy thăng hoa|thăng hoa|đài loan|việt nam|nhập khẩu|xuất xứ|chứng nhận|tiêu chuẩn|sản xuất|thực vật|nguyên liệu|tinh khiết|không đường|không chất bảo quản|thanh lọc|detox|trẻ hoá|trẻ hóa|làm trắng|khử mùi|dưỡng ẩm|da |tóc/i;

/** Con số duy nhất được in trên bao bì hay có trong tên sản phẩm đợt đầu: 100% / 100ml, 300g, 500ml, 1000 lớp, can 3,8L, hộp 10 gói. */
const STORY_ALLOWED_NUMBERS = new Set(['100', '300', '500', '1000', '3', '8', '10']);
const STORY_LEAKED_VALUE = /\[object Object\]|\bundefined\b|\bnull\b|\bNaN\b/i;

function storyTextLines(cfg: ProductStoryConfig): string[] {
  return cfg.scenes.flatMap((sc) => {
    if (sc.kind === 'ingredient_assembly') return sc.steps.flatMap((st) => [st.title, st.body, ...st.layers.map((l) => l.label)]);
    if (sc.kind === 'hud_callouts') return [sc.closing, ...sc.points.map((p) => p.label), ...sc.points.flatMap((p) => (p.value ? [p.value] : []))];
    if (sc.kind === 'variant_arc') return sc.items.map((i) => i.label);
    return [];
  });
}

/**
 * Bộ kiểm cuối cho một kịch bản sắp ghi lên PROD (seed bản nháp): cấu hình hợp lệ, chữ không có từ cấm, không lọt `[object Object]` hay `undefined`, và con số chỉ
 * gồm số in trên bao bì. Rỗng là sạch. Nhãn vòng cung đọc từ tên phân loại thật nên chỉ bị chặn chữ lọt giá trị, không bị chặn từ cấm hay con số (tên phân loại do nhãn hàng đặt).
 */
export function storyDraftProblems(cfg: ProductStoryConfig): string[] {
  const parsed = parseStoryConfig(cfg);
  if (!parsed.ok) return [`cấu hình không hợp lệ: ${parsed.error}`];
  const problems: string[] = [];
  for (const sc of cfg.scenes) {
    if (sc.kind === 'variant_arc') {
      for (const item of sc.items) if (STORY_LEAKED_VALUE.test(item.label)) problems.push(`"${item.label}": tên mục vòng cung lộ giá trị lỗi`);
    }
  }
  const authored = storyTextLines({ ...cfg, scenes: cfg.scenes.filter((sc) => sc.kind !== 'variant_arc') });
  for (const line of authored) {
    if (STORY_LEAKED_VALUE.test(line)) problems.push(`"${line}": lộ giá trị lỗi`);
    const banned = STORY_BANNED_CLAIMS.exec(line);
    if (banned) problems.push(`"${line}": từ cấm "${banned[0]}"`);
    for (const n of line.match(/\d+/g) ?? []) if (!STORY_ALLOWED_NUMBERS.has(n)) problems.push(`"${line}": số ${n} không có trên bao bì`);
  }
  return problems;
}
