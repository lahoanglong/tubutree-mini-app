import { expect, type Locator, type Page } from '@playwright/test';
import type {
  MiniBasketTask,
  MiniChoiceItem,
  MiniConveyorArt,
  MiniConveyorBin,
  MiniConveyorItem,
  MiniGameId,
  MiniKitchenSwap,
  MiniMatchCard,
  MiniProductCard,
  MiniStartResponse,
  MiniSubmitResponse,
  MiniTodayGame,
  MiniTodayResponse,
} from '@tubutree/shared-types';
import { gameCopy } from '../../../../packages/app-core/src/game-mini/copy';
import { gameWebCopy } from '../../../../packages/app-core/src/game-mini/web-copy';
import { arcadeCopy } from '../../../../packages/app-core/src/game-mini/arcade-copy';
import { reply, type MockApi } from './mock-api';

/**
 * Dữ liệu và thao tác chung của spec game mini (Đố Xanh, Đúng Thùng, Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc, Căn Bếp Xanh, Ghép Mầm Xanh, Băng Chuyền Xanh)
 * ở Mini App và web: API mock như máy chủ
 * thật khi cờ game.mini.* bật.
 */

export { arcadeCopy, gameCopy, gameWebCopy };

export function miniToday(over: Partial<MiniTodayResponse> = {}): MiniTodayResponse {
  return {
    dayKey: '2026-11-17',
    games: [
      { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 1, rewardedRoundsLeft: 1, playedToday: 0 },
      { game: 'match', items: 6, timeLimitMs: 60_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'origin', items: 5, timeLimitMs: 60_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'basket', items: 1, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
    ],
    rewardEligible: true,
    noRewardReason: null,
    caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
    dailyQuizDoneToday: false,
    ...over,
  };
}

const round = (game: MiniGameId, content: MiniStartResponse['content'], over: Partial<MiniStartResponse> = {}): MiniStartResponse => {
  const now = Date.now();
  return {
    game,
    roundId: `r-${game}`,
    token: null,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
    rewarded: true,
    noRewardReason: null,
    content,
    ...over,
  };
};

export const QUIZ_PRODUCT = { slug: 'nuoc-rua-chen-bo-ket', name: 'Nước rửa chén bồ kết 500ml', imageUrl: null, price: 59_000, inStock: true };

export const QUIZ_ITEMS = [
  { id: 'q1', prompt: 'Vỏ hộp sữa giấy nên bỏ vào thùng nào?', options: ['Tái chế', 'Rác hữu cơ', 'Rác còn lại', 'Đốt'], product: null },
  { id: 'q2', prompt: 'Một cây xanh trưởng thành hấp thụ khí nào?', options: ['CO₂', 'Oxy', 'Nitơ', 'Heli'], product: null },
  { id: 'q3', prompt: 'Bồ kết dùng để làm gì trong nhà?', options: ['Rửa chén, gội đầu', 'Nấu canh', 'Tưới cây', 'Lau kính ô tô'], product: QUIZ_PRODUCT },
];

export const SORT_ITEMS = [
  { id: 's1', label: 'Chai nhựa PET', emoji: '🧴' },
  { id: 's2', label: 'Vỏ chuối', emoji: '🍌' },
  { id: 's3', label: 'Lon nhôm', emoji: '🥫' },
  { id: 's4', label: 'Bã cà phê', emoji: '☕' },
  { id: 's5', label: 'Túi nilon bẩn', emoji: null },
  { id: 's6', label: 'Hộp giấy', emoji: '📦' },
  { id: 's7', label: 'Vỏ trứng', emoji: '🥚' },
  { id: 's8', label: 'Ly giấy tráng nhựa', emoji: '🥤' },
  { id: 's9', label: 'Chai thủy tinh', emoji: '🍾' },
  { id: 's10', label: 'Khăn giấy đã dùng', emoji: null },
];

const SOURCE = 'https://www.moitruong.gov.vn/phan-loai-rac';

export function quizResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'daily_quiz',
    roundId: 'r-daily_quiz',
    correct: 2,
    total: 3,
    durationMs: 9_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 6,
    basePoints: 0,
    water: 6,
    points: 0,
    capped: [],
    totalSeeds: 130,
    checkIn: { done: true, newlyCheckedIn: true, streakDays: 4 },
    review: {
      game: 'daily_quiz',
      items: QUIZ_ITEMS.map((q, i) => ({
        contentId: q.id,
        prompt: q.prompt,
        correct: i !== 1,
        given: i === 1 ? 1 : 0,
        expected: 0,
        explanation: `Giải thích câu ${i + 1}`,
        sourceUrl: SOURCE,
        productSlug: q.product?.slug ?? null,
      })),
    },
    ...over,
  };
}

export function sortResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'sort',
    roundId: 'r-sort',
    correct: 7,
    total: 10,
    durationMs: 20_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 10,
    basePoints: 0,
    water: 10,
    points: 0,
    capped: [],
    totalSeeds: 140,
    checkIn: null,
    review: {
      game: 'sort',
      items: SORT_ITEMS.map((it, i) => ({
        contentId: it.id,
        label: it.label,
        correct: i < 7,
        given: 'recycle' as const,
        expected: i < 7 ? ('recycle' as const) : ('other' as const),
        explanation: `Vì sao món ${i + 1}`,
        sourceUrl: SOURCE,
      })),
    },
    ...over,
  };
}

const SOURCE_B = 'https://www.vinmec.com/vie/bai-viet/nguyen-lieu-tu-nhien';

/** Ghép Cặp: 12 thẻ đã xáo; `MATCH_PAIRS` là đáp án đúng [nguyên liệu, công dụng] theo mã thẻ (máy chủ giữ, spec dùng để chơi). */
export const MATCH_CARDS: MiniMatchCard[] = [
  { cardId: 'c01', label: 'Bồ kết', side: 'ingredient' },
  { cardId: 'c02', label: 'Khử mùi tủ lạnh', side: 'use' },
  { cardId: 'c03', label: 'Giấm gạo', side: 'ingredient' },
  { cardId: 'c04', label: 'Gội đầu, làm sạch tóc', side: 'use' },
  { cardId: 'c05', label: 'Vỏ bưởi', side: 'ingredient' },
  { cardId: 'c06', label: 'Phủ bọc thực phẩm thay màng bọc nhựa', side: 'use' },
  { cardId: 'c07', label: 'Baking soda', side: 'ingredient' },
  { cardId: 'c08', label: 'Tẩy cặn vôi trong ấm đun nước', side: 'use' },
  { cardId: 'c09', label: 'Sáp ong', side: 'ingredient' },
  { cardId: 'c10', label: 'Rửa chén thay mút nhựa', side: 'use' },
  { cardId: 'c11', label: 'Xơ mướp', side: 'ingredient' },
  { cardId: 'c12', label: 'Tinh dầu đuổi muỗi, thơm nhà', side: 'use' },
];
export const MATCH_PAIRS: [string, string][] = [
  ['c01', 'c04'],
  ['c03', 'c08'],
  ['c05', 'c12'],
  ['c07', 'c02'],
  ['c09', 'c06'],
  ['c11', 'c10'],
];
const label = (id: string) => MATCH_CARDS.find((c) => c.cardId === id)!.label;

export function matchResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'match',
    roundId: 'r-match',
    correct: 5,
    total: 6,
    durationMs: 30_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 8,
    basePoints: 0,
    water: 8,
    points: 0,
    capped: [],
    totalSeeds: 150,
    checkIn: null,
    review: {
      game: 'match',
      items: MATCH_PAIRS.map(([a, b], i) => ({
        contentId: `m${i + 1}`,
        correct: i !== 2,
        ingredient: label(a),
        use: label(b),
        explanation: `Dòng khoa học của cặp ${i + 1}`,
        sourceUrl: SOURCE_B,
        productSlug: i === 0 ? 'dau-goi-bo-ket' : i === 4 ? 'giay-sap-ong-boc-thuc-pham' : null,
      })),
    },
    ...over,
  };
}

export const ORIGIN_PRODUCT: MiniProductCard = { slug: 'mat-ong-hoa-ca-phe', name: 'Mật ong hoa cà phê 500ml', imageUrl: null, price: 189_000, inStock: true };

export const ORIGIN_ITEMS: MiniChoiceItem[] = [
  { id: 'o1', prompt: 'Chè Shan tuyết cổ thụ', options: ['Hà Giang', 'Cà Mau', 'Bến Tre', 'Đà Lạt'], product: null },
  { id: 'o2', prompt: 'Cà phê Robusta', options: ['Sa Pa', 'Buôn Ma Thuột', 'Hạ Long', 'Huế'], product: null },
  { id: 'o3', prompt: 'Nước mắm truyền thống', options: ['Mộc Châu', 'Lạng Sơn', 'Phú Quốc', 'Điện Biên'], product: null },
  { id: 'o4', prompt: 'Quế', options: ['Cần Thơ', 'Bạc Liêu', 'Vinh', 'Văn Yên'], product: null },
  { id: 'o5', prompt: 'Mật ong hoa cà phê', options: ['Đắk Lắk', 'Hà Nội', 'Huế', 'Hạ Long'], product: ORIGIN_PRODUCT },
];

export function originResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'origin',
    roundId: 'r-origin',
    correct: 4,
    total: 5,
    durationMs: 25_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 8,
    basePoints: 0,
    water: 8,
    points: 0,
    capped: [],
    totalSeeds: 150,
    checkIn: null,
    review: {
      game: 'origin',
      items: ORIGIN_ITEMS.map((it, i) => ({
        contentId: it.id,
        prompt: it.prompt,
        correct: i !== 3,
        given: i === 3 ? 0 : i,
        expected: i,
        explanation: `Vùng của ${it.prompt}`,
        sourceUrl: SOURCE_B,
        productSlug: it.product?.slug ?? null,
      })),
    },
    ...over,
  };
}

const p = (slug: string, name: string, price: number): MiniProductCard => ({ slug, name, imageUrl: null, price, inStock: true });
export const BASKET_TASK: MiniBasketTask = {
  id: 'b1',
  task: 'Rửa chén bát cho cả nhà mà không dùng hoá chất mạnh',
  products: [
    p('nen-thom-sap-dau-nanh', 'Nến thơm sáp đậu nành', 129_000),
    p('nuoc-rua-chen-bo-ket', 'Nước rửa chén bồ kết 500ml', 59_000),
    p('binh-giu-nhiet-inox', 'Bình giữ nhiệt inox 500ml', 210_000),
    p('xo-muop-rua-chen', 'Xơ mướp rửa chén (2 miếng)', 25_000),
    p('tui-vai-canvas', 'Túi vải canvas đi chợ', 89_000),
    p('khan-lau-soi-tre', 'Khăn lau sợi tre', 45_000),
  ],
};
export const BASKET_SET = ['nuoc-rua-chen-bo-ket', 'xo-muop-rua-chen', 'khan-lau-soi-tre'];
/** Món của bộ đúng hết hàng ở danh mục lúc thêm giỏ (thẻ trong đề vẫn ghi còn hàng: nội dung ván chụp lúc bắt đầu). */
export const BASKET_SOLD_OUT = 'xo-muop-rua-chen';

export function basketResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'basket',
    roundId: 'r-basket',
    correct: 0,
    total: 1,
    durationMs: 15_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 2,
    basePoints: 0,
    water: 2,
    points: 0,
    capped: [],
    totalSeeds: 150,
    checkIn: null,
    review: {
      game: 'basket',
      items: [
        {
          contentId: 'b1',
          correct: false,
          explanation: 'Bồ kết tạo bọt dịu, xơ mướp và khăn sợi tre thay mút nhựa.',
          sourceUrl: SOURCE_B,
          correctSlugs: BASKET_SET,
          picks: [
            { slug: 'nuoc-rua-chen-bo-ket', correct: true, reason: null },
            { slug: 'xo-muop-rua-chen', correct: true, reason: null },
            { slug: 'tui-vai-canvas', correct: false, reason: 'Túi vải dùng đi chợ, không dùng rửa chén.' },
          ],
        },
      ],
    },
    ...over,
  };
}

/** Dòng "Chơi hôm nay" của Căn Bếp Xanh: không nằm trong `miniToday()` mặc định (cờ riêng, mặc định tắt), spec của game tự thêm. */
export const KITCHEN_TODAY_ROW: MiniTodayGame = { game: 'kitchen_swap', items: 3, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 };

const kitchenOption = (slug: string, name: string, price: number, fact: string) => ({ product: p(slug, name, price), fact });

/** Ván Căn Bếp Xanh: 3 góc theo thứ tự cố định của máy chủ, lựa chọn đã xáo (đáp án ở vị trí 1, 0, 2). */
export const KITCHEN_SWAPS: MiniKitchenSwap[] = [
  {
    id: 'gm-kitchen-duong-tui-nilon',
    corner: 'table',
    item: 'Đường đựng trong túi nilon, mở ra là bỏ túi',
    emoji: '🍬',
    hidden: 'Túi nilon còn dính đường phải rửa sạch mới tái chế được.',
    options: [
      kitchenOption('nuoc-tuong-mat-hoa-dua-sokfarm-cham-034cc1', 'Nước tương mật hoa dừa Sokfarm (chấm)', 65_000, 'Nước tương mật hoa dừa, loại dùng để chấm.'),
      kitchenOption('duong-hoa-dua-sokfarm-hu-thuy-tinh-150g-b67af3', 'Đường hoa dừa Sokfarm hũ thuỷ tinh 150g', 79_000, 'Đường hoa dừa đựng trong hũ thuỷ tinh 150g.'),
      kitchenOption('granola-mix-nuts-tui-tien-loi-bh-nong-3b8792', 'Granola Mix Nuts túi tiện lợi', 55_000, 'Granola trộn hạt, đóng túi tiện lợi.'),
    ],
  },
  {
    id: 'gm-kitchen-chai-nuoc-rua-chen',
    corner: 'kitchen',
    item: 'Chai nước rửa chén 500 ml, hết là mua chai mới',
    emoji: '🧴',
    hidden: 'Mỗi lần mua chai mới là thêm một vỏ chai nhựa phải bỏ đi.',
    options: [
      kitchenOption('refill-nuoc-rua-chen-fuwa3e-10l-69f244', 'Refill nước rửa chén Fuwa3e 10L', 690_000, 'Can 10L nước rửa chén, rót lại vào chai cũ. Bao bì ghi eco-enzyme lên men từ vỏ dứa.'),
      kitchenOption('refill-lau-da-nang-fuwa3e-10l-a08433', 'Refill nước lau đa năng Fuwa3e 10L', 690_000, 'Can 10L nước lau đa năng. Bao bì ghi eco-enzyme lên men từ vỏ dứa.'),
      kitchenOption('refill-nuoc-giat-cam-fuwa3e-10l-dc4433', 'Refill nước giặt hương Cam Fuwa3e 10L', 790_000, 'Can 10L nước giặt quần áo hương Cam. Bao bì ghi eco-enzyme lên men từ vỏ dứa.'),
    ],
  },
  {
    id: 'gm-kitchen-lo-rua-tay-mini',
    corner: 'bag',
    item: 'Lọ nước rửa tay mini mua lẻ, vài hôm lại mua lọ mới',
    emoji: '👜',
    hidden: 'Lọ nhỏ nhanh hết, mỗi lọ là thêm một vỏ nhựa nhỏ.',
    options: [
      kitchenOption('xit-thom-huong-xuan-fuwa3e-300ml-ff93d6', 'Xịt thơm hương Xuân Fuwa3e 300ml', 99_000, 'Xịt thơm hương Xuân, chai 300ml.'),
      kitchenOption('lau-noi-that-o-to-fuwa3e-300ml-b202d9', 'Lau nội thất ô tô Fuwa3e 300ml', 99_000, 'Nước lau nội thất ô tô, chai 300ml.'),
      kitchenOption('nuoc-rua-tay-dang-gel-fuwa3e-300ml-37dfc0', 'Nước rửa tay dạng gel Fuwa3e 300ml', 89_000, 'Nước rửa tay dạng gel hương Quýt, chai 300ml. Bao bì ghi eco-enzyme lên men từ vỏ dứa.'),
    ],
  },
];
/** Sản phẩm đúng việc của từng góc, theo thứ tự ván: đúng 3 sản phẩm màn kết quả hiện để thêm giỏ dùng thử. */
export const KITCHEN_SET = ['duong-hoa-dua-sokfarm-hu-thuy-tinh-150g-b67af3', 'refill-nuoc-rua-chen-fuwa3e-10l-69f244', 'nuoc-rua-tay-dang-gel-fuwa3e-300ml-37dfc0'];
/** Khách đổi đúng góc 1 và 3, đổi nhầm góc 2 sang can nước lau đa năng. */
export const KITCHEN_PICKS = ['duong-hoa-dua-sokfarm-hu-thuy-tinh-150g-b67af3', 'refill-lau-da-nang-fuwa3e-10l-a08433', 'nuoc-rua-tay-dang-gel-fuwa3e-300ml-37dfc0'];
const KITCHEN_SOURCE = 'https://cdn.thuvienphapluat.vn/uploads/danluatfile/2023/11/08/cong-van-9368-btnmt-kson-2023-ve-phan-loai-chat-thai-ran-sinh-hoat.pdf';

export function kitchenResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'kitchen_swap',
    roundId: 'r-kitchen_swap',
    correct: 2,
    total: 3,
    durationMs: 20_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 6,
    basePoints: 0,
    water: 6,
    points: 0,
    capped: [],
    totalSeeds: 150,
    checkIn: null,
    review: {
      game: 'kitchen_swap',
      items: KITCHEN_SWAPS.map((sw, i) => ({
        contentId: sw.id,
        correct: KITCHEN_PICKS[i] === KITCHEN_SET[i],
        corner: sw.corner,
        item: sw.item,
        given: KITCHEN_PICKS[i]!,
        expected: KITCHEN_SET[i]!,
        explanation: 'Rót can lớn vào chai cũ thì chai được dùng tiếp, bớt vỏ nhựa mới.',
        sourceUrl: KITCHEN_SOURCE,
      })),
    },
    ...over,
  };
}

/** Hai game thao tác ở "Chơi hôm nay" (máy chủ bật `game.mini.eco_merge_enabled`, `game.mini.green_conveyor_enabled`). */
export const ARCADE_TODAY_ROWS: MiniTodayGame[] = [
  { game: 'eco_merge', items: 8, timeLimitMs: 180_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
  { game: 'green_conveyor', items: 24, timeLimitMs: 30_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
];

export const MERGE_SEED = 20_261_128;

const CONVEYOR_KINDS: Record<MiniConveyorBin, [string, MiniConveyorArt][]> = {
  recycle: [['Chai nhựa', 'pet_bottle'], ['Lon nhôm', 'can'], ['Hộp giấy', 'carton']],
  organic: [['Vỏ chuối', 'banana_peel'], ['Bã cà phê', 'coffee_grounds'], ['Vỏ trứng', 'eggshell']],
  refill: [['Vỏ chai nước rửa chén', 'refill_pump'], ['Can nước giặt', 'refill_jug'], ['Bình xịt lau kính', 'refill_spray']],
};
const CONVEYOR_BINS: MiniConveyorBin[] = ['recycle', 'organic', 'refill'];

/** 24 món như máy chủ phát: mỗi thùng 8 món xen kẽ Tái chế, Hữu cơ, Refill; món thứ 6, 12, 18 là món vàng. */
export const CONVEYOR_ITEMS: MiniConveyorItem[] = Array.from({ length: 24 }, (_, i) => {
  const bin = CONVEYOR_BINS[i % 3]!;
  const [label, art] = CONVEYOR_KINDS[bin][Math.floor(i / 3) % 3]!;
  return { id: `${art}-${i}`, label, art, bin, golden: i === 5 || i === 11 || i === 17 };
});

const arcadeBase = (): Pick<MiniSubmitResponse, 'rewarded' | 'noRewardReason' | 'capped' | 'totalSeeds' | 'checkIn'> => ({
  rewarded: true,
  noRewardReason: null,
  capped: [],
  totalSeeds: 140,
  checkIn: null,
});

/** Ghép Mầm Xanh: máy chủ chơi lại chuỗi vuốt, tới Hoa xanh (bậc 5/8) thì 4 + 5 = 9 💧, chưa đủ 80% để có điểm. */
export function mergeResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    ...arcadeBase(),
    game: 'eco_merge',
    roundId: 'r-eco_merge',
    correct: 5,
    total: 8,
    durationMs: 60_000,
    baseWater: 9,
    basePoints: 0,
    water: 9,
    points: 0,
    review: { game: 'eco_merge', score: 1_284, maxTile: 32, moves: 180, won: false },
    ...over,
  };
}

/** Băng Chuyền Xanh: 22/24 món đúng (trên 80%) nên 10 💧 và 10 Điểm Xanh; món vàng chỉ cộng điểm ván. */
export function conveyorResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    ...arcadeBase(),
    game: 'green_conveyor',
    roundId: 'r-green_conveyor',
    correct: 22,
    total: 24,
    durationMs: 30_000,
    baseWater: 10,
    basePoints: 10,
    water: 10,
    points: 10,
    review: { game: 'green_conveyor', score: 96, bestCombo: 14, golden: 3, missed: 1 },
    ...over,
  };
}

/**
 * Danh mục và giỏ cho màn kết quả đợt B: `GET /products?slugs=` trả thẻ hiện hành (món `BASKET_SOLD_OUT` hết hàng), `POST /cart/items/batch`
 * ghi lại thân lệnh. Trả mảng thân các lần thêm giỏ.
 */
export function mockMiniShop(api: MockApi) {
  const cartPosts: { items: { variationId: string; quantity: number }[] }[] = [];
  const names = new Map([...BASKET_TASK.products, ORIGIN_PRODUCT, ...KITCHEN_SWAPS.flatMap((sw) => sw.options.map((o) => o.product))].map((x) => [x.slug, x.name]));
  api.get('/products', (ctx: { call: { query: URLSearchParams } }) => {
    const slugs = (ctx.call.query.get('slugs') ?? '').split(',').filter(Boolean);
    const data = slugs.map((slug) => ({
      id: `p-${slug}`,
      slug,
      brand: 'Tubu Tree',
      name: names.get(slug) ?? (slug === 'dau-goi-bo-ket' ? 'Dầu gội bồ kết 300ml' : 'Giấy sáp ong bọc thực phẩm'),
      thumbnail: null,
      basePrice: 99_000,
      salePrice: null,
      repVariationId: `v-${slug}`,
      isFeatured: false,
      inStock: slug !== BASKET_SOLD_OUT,
    }));
    return { data, total: data.length, page: 1, limit: data.length };
  });
  api.post('/cart/items/batch', (ctx: { call: { body: unknown } }) => {
    cartPosts.push(ctx.call.body as (typeof cartPosts)[number]);
    return { items: [], subtotal: 0 };
  });
  api.allowUnmocked('GET /cart', 'GET /cart/count');
  return { cartPosts };
}

/** Bật game mini: "Chơi hôm nay", bắt đầu và nộp từng game; trả mảng thân các lần nộp để spec kiểm đáp án gửi đi. */
export function mockMiniGames(
  api: MockApi,
  opts: {
    today?: MiniTodayResponse;
    guest?: 'NOT_LOGGED_IN' | 'NOT_REAL_USER';
    quiz?: MiniSubmitResponse;
    sort?: MiniSubmitResponse;
    match?: MiniSubmitResponse;
    origin?: MiniSubmitResponse;
    basket?: MiniSubmitResponse;
    kitchen?: MiniSubmitResponse;
    merge?: MiniSubmitResponse;
    conveyor?: MiniSubmitResponse;
    failFirstSubmit?: boolean;
  } = {},
) {
  const submits: { game: string; body: Record<string, unknown> }[] = [];
  const guest = opts.guest;
  // Chưa đăng nhập (web): ván ký `token`, không lưu. Tài khoản khách theo thiết bị (Mini App): ván có `roundId` nhưng không tính thưởng.
  const startOver = guest ? { ...(guest === 'NOT_LOGGED_IN' ? { roundId: null, token: 'tok.e2e' } : {}), rewarded: false, noRewardReason: guest } : {};
  api.get('/game/mini/today', () => opts.today ?? (guest ? miniToday({ rewardEligible: false, noRewardReason: guest }) : miniToday()));
  // Dòng Sổ tay Xanh dưới "Chơi hôm nay" và ở màn kết quả: để 404 như cờ `game.album_enabled` tắt (mặc định); spec sổ mock riêng (game-album-mocks.ts).
  api.allowUnmocked('GET /game/album');
  api.post('/game/mini/daily_quiz/start', () => round('daily_quiz', { game: 'daily_quiz', items: QUIZ_ITEMS }, startOver));
  api.post('/game/mini/sort/start', () => round('sort', { game: 'sort', bins: ['recycle', 'food', 'other'], items: SORT_ITEMS }, startOver));
  api.post('/game/mini/match/start', () => round('match', { game: 'match', cards: MATCH_CARDS }, startOver));
  api.post('/game/mini/origin/start', () => round('origin', { game: 'origin', items: ORIGIN_ITEMS }, startOver));
  api.post('/game/mini/basket/start', () => round('basket', { game: 'basket', task: BASKET_TASK }, startOver));
  api.post('/game/mini/kitchen_swap/start', () => round('kitchen_swap', { game: 'kitchen_swap', swaps: KITCHEN_SWAPS }, startOver));
  api.post('/game/mini/eco_merge/start', () => round('eco_merge', { game: 'eco_merge', seed: MERGE_SEED, size: 4, goal: 256, maxMoves: 2_000 }, startOver));
  api.post('/game/mini/green_conveyor/start', () =>
    round('green_conveyor', { game: 'green_conveyor', seed: 7, bins: CONVEYOR_BINS, items: CONVEYOR_ITEMS }, startOver),
  );
  const results: Record<string, () => MiniSubmitResponse> = {
    eco_merge: () => opts.merge ?? mergeResult(),
    green_conveyor: () => opts.conveyor ?? conveyorResult(),
    daily_quiz: () => opts.quiz ?? quizResult(),
    sort: () => opts.sort ?? sortResult(),
    match: () => opts.match ?? matchResult(),
    origin: () => opts.origin ?? originResult(),
    basket: () => opts.basket ?? basketResult(),
    kitchen_swap: () => opts.kitchen ?? kitchenResult(),
  };
  let failed = false;
  const submit = (game: MiniGameId) => (ctx: { call: { body: unknown } }) => {
    submits.push({ game, body: ctx.call.body as Record<string, unknown> });
    if (opts.failFirstSubmit && !failed) {
      failed = true;
      return reply(503, { statusCode: 503, message: 'Service Unavailable' });
    }
    const guestResult = guest ? { rewarded: false, noRewardReason: guest, water: 0, points: 0, checkIn: null, ...(guest === 'NOT_LOGGED_IN' ? { roundId: null } : {}) } : {};
    return { ...results[game]!(), ...guestResult };
  };
  for (const game of ['daily_quiz', 'sort', 'match', 'origin', 'basket', 'kitchen_swap', 'eco_merge', 'green_conveyor'] as const) api.post(`/game/mini/${game}/submit`, submit(game));
  return { submits };
}

/** Nút Bắt đầu của màn mở đầu (Mini App giữ trang Vườn Xanh phía sau trong DOM, trang đó cũng có nút "Bắt đầu"). */
export async function startRound(page: Page) {
  await page.getByTestId('mini-intro').getByRole('button', { name: gameCopy('intro.start') }).click();
}

/** Chơi hết 3 câu Đố Xanh bằng chuột/chạm: chọn đáp án A rồi bấm "Câu tiếp"/"Nộp bài". */
export async function playQuiz(page: Page) {
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('mini-quiz-prompt')).toHaveText(QUIZ_ITEMS[i]!.prompt);
    await page.getByTestId('mini-quiz-option-0').click();
    await page.getByRole('button', { name: gameCopy(i === 2 ? 'quiz.finish' : 'quiz.next') }).click();
  }
}

/** Ghép đủ 6 cặp bằng chạm: nguyên liệu rồi công dụng. */
export async function playMatch(page: Page) {
  for (const [a, b] of MATCH_PAIRS) {
    await page.getByTestId(`mini-match-card-${MATCH_CARDS.findIndex((c) => c.cardId === a)}`).click();
    await page.getByTestId(`mini-match-card-${MATCH_CARDS.findIndex((c) => c.cardId === b)}`).click();
  }
}

/** Chơi các lượt Đoán Xuất Xứ còn lại từ lượt `from`: chọn vùng `pick(i)` rồi "Lượt tiếp"/"Nộp bài". */
export async function playOrigin(page: Page, pick: (i: number) => number = (i) => i % 4, from = 0) {
  for (let i = from; i < ORIGIN_ITEMS.length; i++) {
    await expect(page.getByTestId('mini-origin-prompt')).toHaveText(ORIGIN_ITEMS[i]!.prompt);
    await page.getByTestId(`mini-origin-option-${pick(i)}`).click();
    await page.getByRole('button', { name: gameCopy(i === ORIGIN_ITEMS.length - 1 ? 'quiz.finish' : 'origin.next') }).click();
  }
}

export const basketIndex = (slug: string) => BASKET_TASK.products.findIndex((x) => x.slug === slug);

export const sortProgress = (page: Page) => page.getByTestId('mini-status').getByText(/^\d+\/10$/);

/** Bỏ các món còn lại vào thùng Tái chế bằng chạm thẳng thùng, mỗi lần cách nhau hơn khoá chạm đúp 300ms. */
export async function finishSort(page: Page, from: number) {
  for (let i = from; i < 10; i++) {
    await expect(sortProgress(page)).toHaveText(`${i}/10`);
    await page.getByTestId('mini-sort-bin-recycle').click();
    await page.waitForTimeout(350);
  }
}

/** Mini App: lưới game nằm ở tab "Sảnh Game" của /game (tab không ghi lên URL), nên mở trang rồi chạm tab. */
export async function openMiniGameHub(page: Page): Promise<void> {
  await page.goto('/game');
  await page.getByRole('tab', { name: 'Sảnh Game' }).click({ timeout: 15_000 });
}

/**
 * Mọi phần tử bấm được trong `scope` cao ít nhất 44px (vùng chạm tối thiểu). Tên thẻ sản phẩm (`.tubu-tile-link`), tên thẻ Sảnh Game
 * (`.tubu-hub-hit`) và tên thẻ quà (`.tubu-reward-hit`) nhận chạm qua `::after` phủ cả vỏ thẻ, nên đo vỏ thẻ (khối định vị gần nhất) chứ không đo dòng chữ.
 */
export async function expectTargets44(scope: Locator) {
  const small = await scope.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const coversCard = ['tubu-tile-link', 'tubu-hub-hit', 'tubu-reward-hit'].some((c) => el.classList.contains(c));
        const box = (coversCard ? (el.offsetParent as HTMLElement) : el).getBoundingClientRect();
        return { el: (el.getAttribute('data-testid') ?? el.textContent ?? '').trim().slice(0, 40), h: box.height, w: box.width };
      })
      .filter((x) => x.h < 44 || x.w < 44),
  );
  expect(small, 'Phần tử bấm được nhỏ hơn 44px').toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw, 'Trang tràn ngang').toBeLessThanOrEqual(o.cw);
}

/** Vuốt trên `testId` bằng chuột (Pointer Events như ngón tay): từ giữa phần tử dời `dx`, `dy` rồi nhả. */
export async function swipeOn(page: Page, testId: string, dx: number, dy: number) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

const mergeCells = (page: Page) =>
  page.getByTestId('eco-merge-tile').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-cell')}:${e.getAttribute('data-value')}`).sort().join(','));

/** Ghép Mầm Xanh: một phím mũi tên rồi một lần vuốt làm bàn đổi (thử lần lượt 4 hướng tới khi ô dời). */
export async function mergeKeyThenSwipe(page: Page) {
  let start = await mergeCells(page);
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await page.keyboard.press(key);
    if ((await mergeCells(page)) !== start) break;
  }
  await expect.poll(() => mergeCells(page)).not.toBe(start);
  start = await mergeCells(page);
  for (const [dx, dy] of [[-120, 0], [0, -120], [120, 0], [0, 120]] as const) {
    await swipeOn(page, 'eco-merge-grid', dx, dy);
    if ((await mergeCells(page)) !== start) break;
  }
  await expect.poll(() => mergeCells(page)).not.toBe(start);
}

/** Ghép Mầm Xanh: bấm vòng 4 phím mũi tên tới khi hết nước đi và màn kết quả hiện. */
export async function playMergeToEnd(page: Page) {
  const result = page.getByTestId('mini-result');
  const keys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
  for (let i = 0; i < 1_800 && !(await result.isVisible()); i++) {
    await page.keyboard.press(keys[i % 4]!);
    if (i % 25 === 24) await page.waitForTimeout(20);
  }
  await expect(result).toBeVisible({ timeout: 15_000 });
}

const BIN_KEY: Record<string, string> = { recycle: 'ArrowLeft', organic: 'ArrowDown', refill: 'ArrowRight' };
const BIN_SWIPE: Record<string, [number, number]> = { recycle: [-120, 0], organic: [0, 120], refill: [120, 0] };
const WRONG_BIN: Record<string, string> = { recycle: 'organic', organic: 'refill', refill: 'recycle' };

/**
 * Băng Chuyền Xanh trọn ván: đọc thùng của món đầu băng rồi phân loại (món 2 bằng phím, món 3 bằng vuốt, còn lại chạm thùng), cố ý sai một lần
 * sau món thứ 3 và kiểm khung ván rung. `onEighth` chạy khi đã phân loại 8 món (chụp ảnh giữa ván). Trả số món đã phân loại đúng cách và việc đã
 * thấy hệ số x2.
 */
export async function playConveyorRound(page: Page, onEighth: () => Promise<void> = async () => {}) {
  const panel = page.getByTestId('mini-green-conveyor');
  const result = page.getByTestId('mini-result');
  const front = page.locator('[data-testid="conveyor-item"][data-front="true"]');
  let sorted = 0;
  let shook = false;
  let sawCombo = false;
  while (!(await result.isVisible())) {
    const bin = await front.getAttribute('data-bin', { timeout: 1_000 }).catch(() => null);
    if (!bin) continue;
    if (sorted === 3 && !shook) {
      await page.getByTestId(`conveyor-bin-${WRONG_BIN[bin]}`).click();
      await expect(panel).toHaveAttribute('data-shake', /^(a|b)$/);
      shook = true;
      continue;
    }
    if (sorted === 1) await page.keyboard.press(BIN_KEY[bin]!);
    else if (sorted === 2) await swipeOn(page, 'conveyor-belt', ...BIN_SWIPE[bin]!);
    else await page.getByTestId(`conveyor-bin-${bin}`).click();
    sorted++;
    if (!sawCombo) sawCombo = Number(await page.getByTestId('conveyor-combo').getAttribute('data-mult')) >= 2;
    if (sorted === 8) await onEighth();
  }
  return { sorted, shook, sawCombo };
}
