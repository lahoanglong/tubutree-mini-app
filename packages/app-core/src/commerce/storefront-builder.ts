import { fillTemplate } from '../copy-template';
import { SECTION_BUDGET, SHOP_MAX_SECTIONS } from './collection-view';
import { planShopSections } from './shop-page';
import { moveInList, type MoveDirection } from '../storefront-order';

export type { MoveDirection } from '../storefront-order';

/** Bốn kiểu khối của màn dựng: ba bố cục của bộ sưu tập thường, cộng Combo (`kind`). */
export type SectionStyle = 'CAROUSEL' | 'GRID' | 'STACK' | 'COMBO';
export const SECTION_STYLES: readonly SectionStyle[] = ['CAROUSEL', 'GRID', 'STACK', 'COMBO'];

export const LAYOUT_LABEL = { CAROUSEL: 'Kệ ngang', GRID: 'Lưới', STACK: 'Danh sách' } as const;
export const KIND_LABEL = { NORMAL: 'Thường', COMBO: 'Combo' } as const;
export const STYLE_LABEL: Record<SectionStyle, string> = { ...LAYOUT_LABEL, COMBO: KIND_LABEL.COMBO };
export const STYLE_HINT: Record<SectionStyle, string> = {
  CAROUSEL: '4–10 món, lướt ngang',
  GRID: '4–6 món, nổi bật',
  STACK: '3–5 món kèm lý do',
  COMBO: '2–5 món, giảm giá cả bộ',
};

/** Trần mặc định của `storefront.max_combo_pct` bên API; máy chủ vẫn là nơi kẹp thật, màn chỉ kẹp sớm. */
export const COMBO_PCT_DEFAULT_MAX = 30;
export const COMBO_PCT_NEW_DEFAULT = 10;
export const COMBO_MIN_ITEMS = 2;
export const COMBO_MAX_ITEMS = 5;

/** Số nguyên trong [0, max]; giá trị không hữu hạn là 0 (không giảm). */
export function clampComboPct(pct: number, max: number = COMBO_PCT_DEFAULT_MAX): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(Math.max(Math.round(pct), 0), max);
}

/** Ô nhập %: chỉ số nguyên 1–3 chữ số, >0; quá trần thì kẹp. Còn lại null (Lưu bị tắt). */
export function parseComboPct(text: string, max: number = COMBO_PCT_DEFAULT_MAX): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? clampComboPct(n, max) : null;
}

export interface BuilderItem {
  isHidden?: boolean;
  hiddenReason?: string | null;
  product: { id: string; thumbnail?: string | null };
}
export interface BuilderCollection {
  id: string;
  title: string;
  kind: string;
  layout: string;
  comboDiscountPct?: number | null;
  items: BuilderItem[];
}

/** Món khách không thấy: CTV ẩn hoặc API ghi lý do (ngừng bán, chưa duyệt...). */
export function isCustomerVisible(it: { isHidden?: boolean; hiddenReason?: string | null }): boolean {
  return !it.isHidden && !it.hiddenReason;
}

const LAYOUTS = ['CAROUSEL', 'GRID', 'STACK'] as const;
export function sectionStyleOf(c: { kind: string; layout: string }): SectionStyle {
  if (c.kind === 'COMBO') return 'COMBO';
  return (LAYOUTS as readonly string[]).includes(c.layout) ? (c.layout as SectionStyle) : 'GRID';
}

/** Bản khối như khách thấy: chỉ giữ món khách thấy. */
export function visibleCollection<C extends { items: { isHidden?: boolean; hiddenReason?: string | null }[] }>(c: C): C {
  return { ...c, items: c.items.filter(isCustomerVisible) };
}

export interface SectionCardView {
  id: string;
  title: string;
  style: SectionStyle;
  styleLabel: string;
  total: number;
  countText: string;
  thumbs: string[];
  warnings: string[];
  tabOnly: boolean;
  spoken: string;
}

const MAX_THUMBS = 5;
const MIN_ITEMS: Record<Exclude<SectionStyle, 'COMBO'>, number> = { CAROUSEL: 2, GRID: 2, STACK: 1 };
const BUDGET: Record<Exclude<SectionStyle, 'COMBO'>, number> = { CAROUSEL: SECTION_BUDGET.rail, GRID: SECTION_BUDGET.grid, STACK: SECTION_BUDGET.line };

function warningsOf(style: SectionStyle, visible: BuilderItem[]): string[] {
  const n = visible.length;
  if (n === 0) return ['Chưa có món nào khách thấy được.'];
  if (style === 'COMBO') {
    const out: string[] = [];
    if (new Set(visible.map((i) => i.product.id)).size < COMBO_MIN_ITEMS) out.push('Combo cần ít nhất 2 món khác nhau, khách chưa thấy ưu đãi.');
    if (n > COMBO_MAX_ITEMS) out.push('Combo nên có 2–5 món.');
    return out;
  }
  const out: string[] = [];
  if (n < MIN_ITEMS[style]) out.push(`Thêm ít nhất ${MIN_ITEMS[style] - n} món nữa.`);
  const budget = BUDGET[style];
  if (n > budget) out.push(`Khách thấy ${budget}/${n} món ở tab Shop; ${n - budget} món còn lại ở tab Sản phẩm.`);
  return out;
}

/** Thẻ một khối ở màn chính: chữ, ảnh và cảnh báo tính trên đúng phần khách thấy. Bộ rỗng không chiếm chỗ trong trần 6 khối (như `planShopSections`). */
export function sectionCardView(c: BuilderCollection, all: readonly BuilderCollection[]): SectionCardView {
  const style = sectionStyleOf(c);
  const visible = c.items.filter(isCustomerVisible);
  const total = visible.length;
  const styleLabel = STYLE_LABEL[style];
  const pct = c.comboDiscountPct;
  const head = style === 'COMBO' && typeof pct === 'number' && pct > 0 ? `${styleLabel} -${pct}%` : styleLabel;
  const warnings = warningsOf(style, visible);
  const extra = planShopSections(all.map(visibleCollection)).extra;
  return {
    id: c.id,
    title: c.title,
    style,
    styleLabel,
    total,
    countText: `${head} · ${total} món`,
    thumbs: visible.map((i) => i.product.thumbnail ?? '').filter(Boolean).slice(0, MAX_THUMBS),
    warnings,
    tabOnly: extra.some((e) => e.id === c.id),
    spoken: `${c.title}, ${styleLabel}, ${total} món.${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
  };
}

export function overflowSectionsNotice(all: readonly BuilderCollection[]): string | null {
  if (planShopSections(all.map(visibleCollection)).extra.length === 0) return null;
  return `Tab Shop hiện ${SHOP_MAX_SECTIONS} khối đầu; từ khối thứ ${SHOP_MAX_SECTIONS + 1} trở đi chỉ hiện ở tab Danh mục.`;
}

/** Kiểu của khối có sẵn khoá theo `kind`: `UpdateCollectionDto` của API chưa nhận `kind`, nên Thường ↔ Combo chỉ chọn lúc tạo. */
export function styleOptions(existing: { kind: string } | null): { style: SectionStyle; disabled: boolean }[] {
  return SECTION_STYLES.map((style) => ({
    style,
    disabled: existing ? (existing.kind === 'COMBO') !== (style === 'COMBO') : false,
  }));
}

export function styleLockNote(kind: string): string | null {
  if (kind === 'NORMAL') return 'Kiểu Combo chọn lúc tạo khối.';
  if (kind === 'COMBO') return 'Khối Combo giữ kiểu Combo; bạn chỉnh được mức giảm.';
  return null;
}

/** Body tạo khối cho `POST /storefront/me/collections`. Combo mang `%` đã kẹp; máy chủ kẹp lại theo `storefront.max_combo_pct`. */
export function newSectionDto(i: { style: SectionStyle; title: string; comboPct?: number | null }): {
  title: string;
  kind: 'NORMAL' | 'COMBO';
  layout: 'GRID' | 'CAROUSEL' | 'STACK';
  comboDiscountPct?: number;
} {
  const title = i.title.trim();
  if (i.style === 'COMBO') return { title, kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: clampComboPct(i.comboPct ?? COMBO_PCT_NEW_DEFAULT) };
  return { title, kind: 'NORMAL', layout: i.style };
}

const SUGGESTED: Record<SectionStyle, string> = {
  CAROUSEL: 'Món mình hay dùng',
  GRID: 'Gợi ý của mình',
  STACK: 'Ba món mình chọn',
  COMBO: 'Combo tiết kiệm',
};
export function suggestedSectionTitle(style: SectionStyle): string {
  return SUGGESTED[style];
}

export function moveButtonLabel(dir: MoveDirection, name: string, scope: 'item' | 'section' = 'item'): string {
  return `Đưa ${scope === 'section' ? 'khối ' : ''}${name} ${dir === 'up' ? 'lên' : 'xuống'}`;
}

/** Vì sao nút ↑↓ không dời được: ở rìa danh sách ("edge", kể cả id lạ) hay bị món ghim chặn ("pin"); dời được thì null. */
export function moveBlockReason<T extends { id: string }>(
  list: readonly T[],
  id: string,
  dir: MoveDirection,
  sameGroup?: (a: T, b: T) => boolean,
): 'edge' | 'pin' | null {
  if (moveInList(list, id, dir, sameGroup)) return null;
  const from = list.findIndex((r) => r.id === id);
  const to = dir === 'up' ? from - 1 : from + 1;
  return from < 0 || to < 0 || to >= list.length ? 'edge' : 'pin';
}

/** `index` tính từ 0, SAU khi dời. */
export function moveAnnouncement(i: { name: string; dir: MoveDirection; index: number; total: number }): string {
  return `Đã đưa ${i.name} ${i.dir === 'up' ? 'lên' : 'xuống'} vị trí ${i.index + 1}/${i.total}`;
}

export function moveBlockedAnnouncement(i: { name: string; dir: MoveDirection; reason: 'edge' | 'pin' }): string {
  if (i.reason === 'pin') return 'Món ghim luôn nằm trên món thường.';
  return `${i.name} đã ở ${i.dir === 'up' ? 'đầu' : 'cuối'} danh sách`;
}

export interface QuestStripInput {
  quests: { title: string; goal: number; progress: number; done: boolean; claimed: boolean; rewardPoints: number }[];
  totalEarnedPoints: number;
}

/** Một dòng cho dải Hành trình: thưởng đang chờ thì nói thưởng, không thì việc kế tiếp, nhận hết thì tổng điểm. */
export function questStripView(q: QuestStripInput, formatPoints: (n: number) => string): { text: string; spoken: string; hasReward: boolean } {
  const open = BUILDER_COPY.questOpen;
  const ready = q.quests.filter((x) => x.done && !x.claimed);
  if (ready.length > 0) {
    const points = formatPoints(ready.reduce((s, x) => s + x.rewardPoints, 0));
    return { text: `${ready.length} phần thưởng đang chờ · ${points}`, spoken: `${ready.length} phần thưởng đang chờ, ${points}. Mở ${open}.`, hasReward: true };
  }
  const next = q.quests.find((x) => !x.done);
  if (next) {
    return { text: `${next.title} · ${next.progress}/${next.goal}`, spoken: `${next.title}, ${next.progress} trên ${next.goal}. Mở ${open}.`, hasReward: false };
  }
  const total = formatPoints(q.totalEarnedPoints);
  return { text: `Đã nhận ${total}`, spoken: `Đã nhận ${total}. Mở ${open}.`, hasReward: false };
}

/** Chữ màn dựng gian hàng dùng chung hai app (builder-only nên không nằm trong SHOP_COPY). */
export const BUILDER_COPY = {
  sections: 'Bố cục gian hàng',
  sort: 'Sắp xếp',
  sortDone: 'Xong',
  addSection: 'Thêm khối',
  viewAsGuest: 'Xem như khách',
  styleLabel: 'Kiểu hiển thị',
  preview: 'Khách sẽ thấy',
  comboPct: 'Giảm khi mua cả bộ',
  comboPctSave: 'Lưu mức giảm',
  comboPctHint: 'Tối đa 30%',
  comboPctClamped: 'Mức giảm tối đa hiện là {n}%.',
  comboPctSaved: 'Đã lưu mức giảm {n}%.',
  layoutSaved: 'Đã đổi kiểu hiển thị.',
  back: 'Gian hàng của tôi',
  empty: 'Chưa có khối nào. Thêm khối đầu tiên để khách có gì xem.',
  itemsHeading: 'Sản phẩm trong khối',
  renameSection: 'Đổi tên khối',
  deleteSection: 'Xoá khối',
  createAndAdd: 'Tạo và thêm món',
  sectionName: 'Tên khối',
  stats30: 'Thống kê 30 ngày',
  statsByProduct: 'Theo sản phẩm',
  questOpen: 'Hành trình gian hàng',
  tabOnly: 'Chỉ hiện ở tab Danh mục',
} as const;

/** Điền chỗ trống `{n}` của `BUILDER_COPY`; thiếu biến thì ném lỗi như `fillCopy`. */
export function builderCopy(key: keyof typeof BUILDER_COPY, vars: Record<string, string | number> = {}): string {
  return fillTemplate(BUILDER_COPY[key], vars, key);
}
