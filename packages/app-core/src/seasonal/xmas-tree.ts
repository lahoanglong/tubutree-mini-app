import { formatVnNumber as num } from '../number-format';

/**
 * Cây Thông Noel Tự Trang Trí ở thẻ đầu Vườn Xanh (`ChristmasGarden`, Mini App và web) khi `theme.seasonal` là "christmas".
 * Sáu món mở bằng mốc khách đã có (chăm vườn hôm nay, chuỗi điểm danh, số 💧 trong bình, cây đã thu hoạch): không trừ giọt nào, không cộng thưởng,
 * không gọi API, nên kinh tế điểm và giọt giữ nguyên. Món đã mở lưu trên máy (`XMAS_TREE_KEY`); mở lại hay chạm hai lần không đổi gì.
 */
export const ORNAMENTS = ['star', 'lights', 'baubles', 'gifts', 'reindeer', 'wreath'] as const;
export type OrnamentId = (typeof ORNAMENTS)[number];

/** Mốc đọc từ dữ liệu sẵn có của thẻ đầu Vườn Xanh. */
export interface OrnamentProgress {
  streakDays: number;
  activeToday: boolean;
  /** Số 💧 đang có trong bình (chỉ so, không trừ). */
  drops: number;
  harvested: number;
}

const OPEN: Record<OrnamentId, (p: OrnamentProgress) => boolean> = {
  star: () => true,
  lights: (p) => p.activeToday,
  baubles: (p) => p.streakDays >= 3,
  gifts: (p) => p.drops >= 50,
  reindeer: (p) => p.streakDays >= 7,
  wreath: (p) => p.harvested >= 1,
};

export type SlotState = 'on' | 'off' | 'ready' | 'locked';

export const xmasTreeCopy = {
  names: {
    star: 'Ngôi sao đỉnh cây',
    lights: 'Dây đèn ấm',
    baubles: 'Quả châu đỏ',
    gifts: 'Hộp quà xanh',
    reindeer: 'Tuần lộc mini',
    wreath: 'Vòng nguyệt quế',
  },
  hints: {
    star: 'Có sẵn cho mọi khu vườn',
    lights: 'Chăm vườn hôm nay để mở',
    baubles: 'Điểm danh 3 ngày liền để mở',
    gifts: 'Gom đủ 50💧 trong bình để mở',
    reindeer: 'Điểm danh 7 ngày liền để mở',
    wreath: 'Thu hoạch 1 cây để mở',
  },
  decorate: 'Trang trí',
  count: (on: number) => `${num(on)}/${ORNAMENTS.length} món`,
  sheetTitle: 'Trang trí cây thông',
  trayLabel: (on: number) => `Đồ trang trí cây thông, đã treo ${num(on)}/${ORNAMENTS.length}`,
  slotAria: (name: string, state: SlotState, hint: string) =>
    state === 'locked' ? `${name}: chưa mở. ${hint}` : state === 'ready' ? `${name}: đủ điều kiện, chạm để mở` : name,
  unlocked: (name: string) => `Mở được ${name}!`,
  on: (name: string) => `Đã treo ${name}`,
  off: (name: string) => `Đã cất ${name}`,
  treeAria: (on: number) => `Cây thông Noel Xanh, đã treo ${num(on)} món`,
  share: 'Khoe cây',
  shareTitle: 'Khoe cây thông lên Zalo',
  shareCta: 'Gửi qua Zalo',
  shareCtaWeb: 'Chia sẻ thiệp',
  greeting: 'Giáng sinh xanh an lành!',
  cardLine: (name: string, on: number) => `${name} đã treo ${num(on)}/${ORNAMENTS.length} món lên cây thông Noel Xanh`,
  cardInvite: 'Cùng trồng cây ở Vườn Xanh Tubu Tree',
  /** Tên trên thiệp khi hồ sơ chưa có tên. */
  me: 'Mình',
  zaloTitle: (name: string) => `Cây thông Noel Xanh của ${name}`,
  zaloText: (on: number) => `Mình vừa treo ${num(on)}/${ORNAMENTS.length} món lên cây thông ở Vườn Xanh Tubu Tree. Vào trang trí cây của bạn nhé!`,
  copied: 'Đã sao chép liên kết thiệp',
  saved: 'Đã tải ảnh thiệp về máy',
  shareFailed: 'Chưa chia sẻ được, bạn thử lại nhé',
} as const;

/** Món đã mở và món đang treo trên cây. `on` luôn là tập con của `u`. */
export interface TreeState {
  u: OrnamentId[];
  on: OrnamentId[];
}

export const XMAS_TREE_KEY = 'tubu.xmas.tree.v1';
const EMPTY: TreeState = { u: [], on: [] };

type TreeStorage = Pick<Storage, 'getItem' | 'setItem'>;
const pick = (v: unknown): OrnamentId[] => (Array.isArray(v) ? ORNAMENTS.filter((id) => v.includes(id)) : []);
const add = (list: readonly OrnamentId[], id: OrnamentId) => ORNAMENTS.filter((o) => o === id || list.includes(o));

/** Dữ liệu hỏng, khoá lạ hay bộ nhớ bị chặn: cây trống, không ném. */
export function readTreeState(storage: TreeStorage | null): TreeState {
  try {
    const raw = JSON.parse(storage?.getItem(XMAS_TREE_KEY) ?? 'null') as Partial<TreeState> | null;
    const u = pick(raw?.u);
    return { u, on: pick(raw?.on).filter((id) => u.includes(id)) };
  } catch {
    return EMPTY;
  }
}

export function writeTreeState(storage: TreeStorage | null, s: TreeState): void {
  try {
    storage?.setItem(XMAS_TREE_KEY, JSON.stringify(s));
  } catch {
    /* chế độ riêng tư: cây chỉ giữ trong phiên */
  }
}

export function slotState(s: TreeState, id: OrnamentId, p: OrnamentProgress): SlotState {
  if (s.u.includes(id)) return s.on.includes(id) ? 'on' : 'off';
  return OPEN[id](p) ? 'ready' : 'locked';
}

export type TapEvent = 'unlocked' | 'on' | 'off' | 'locked';

/**
 * Một chạm vào ô của khay: món đủ điều kiện thì mở và treo luôn; món đã mở thì treo/cất; món chưa đủ điều kiện thì không đổi gì (app hiện lời nhắc).
 * Trả lại đúng `s` khi không có gì đổi, nên chạm lặp hay lời gọi trùng không ghi bộ nhớ thêm lần nào.
 */
export function tapOrnament(s: TreeState, id: OrnamentId, p: OrnamentProgress): { next: TreeState; event: TapEvent } {
  const state = ORNAMENTS.includes(id) ? slotState(s, id, p) : 'locked';
  if (state === 'locked') return { next: s, event: 'locked' };
  if (state === 'ready') return { next: { u: add(s.u, id), on: add(s.on, id) }, event: 'unlocked' };
  return state === 'off' ? { next: { u: s.u, on: add(s.on, id) }, event: 'on' } : { next: { u: s.u, on: s.on.filter((o) => o !== id) }, event: 'off' };
}

export function tapMessage(event: TapEvent, id: OrnamentId): string {
  return event === 'locked' ? xmasTreeCopy.hints[id] : xmasTreeCopy[event](xmasTreeCopy.names[id]);
}

/**
 * Hình từng món trên cây, khung `XMAS_GARDEN_VIEWBOX` (rộng hơn khung cây Trang chủ để tuần lộc và hộp quà đứng hai bên chậu). Ngôi sao, đèn,
 * quả châu dùng lại toạ độ của `TREE_ART`. `tray` là khung cắt của biểu tượng ở khay: cùng hình trên cây, khỏi vẽ hai lần.
 */
export const XMAS_GARDEN_VIEWBOX = '-22 0 140 120';
export const ORNAMENT_ART = {
  reindeer: {
    body: 'M-15 106q0-5 8-5h10q6 0 6 5t-6 5H-7q-8 0-8-5z',
    legs: 'M-11 110v9M-7 110v9M1 110v9M5 110v9M4 103l4-7',
    antlers: 'M8 92l-2-6m0 3l-3-2m7 5l2-6m0 3l3-2',
    head: [9, 95, 3.2],
    nose: [12, 96, 1.3],
  },
  /** Hai hộp quà bên phải chậu: [x, y, cỡ] của khung `GIFT_VIEWBOX`. */
  gifts: [
    [80, 98, 20],
    [98, 106, 13],
  ],
  wreath: { ring: [47, 57, 6], bow: 'M47 63l-4 4h3l1-2 1 2h3z' },
  /** Khung cắt của biểu tượng ở khay; `null`: món rải khắp cây (đèn, quả châu) nên khay vẽ biểu tượng riêng `icons` trong khung 16 × 16. */
  tray: {
    star: '40 1 16 16',
    lights: null,
    baubles: null,
    gifts: '78 94 36 36',
    reindeer: '-18 84 34 36',
    wreath: '37 47 20 20',
  },
  icons: {
    lights: { wire: 'M1 4q7 8 14 0', dots: [[4, 7.4], [8, 8.4], [12, 7.4]] },
    baubles: { cap: 'M6.5 3h3v2.5h-3z', ball: [8, 10, 5] },
  },
} as const satisfies { tray: Record<OrnamentId, string | null> } & Record<string, unknown>;
