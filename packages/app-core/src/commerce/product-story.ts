import {
  parseStoryConfig,
  STORY_LIMITS,
  type AssemblyStep,
  type HudCalloutPoint,
  type IngredientLayerSprite,
  type ProductStoryConfig,
  type StoryAmbient,
  type StoryFrom,
  type StoryImageFrame,
  type StoryScene,
  type VariantArcItem,
} from '@tubutree/shared-types';
import { fillCopy } from '../shop-copy';
import { findStoryPreset } from './story-presets-launch';
import { spriteForIngredient, STORY_SPRITES, type StoryTone } from './story-sprites';

/** Phần của sản phẩm mà dải câu chuyện đọc. `ingredients` và `storyConfig` là cột Json nên nhận `unknown` (dòng cũ có thể là chuỗi, mảng lạ). */
export interface StoryProductInput {
  slug: string;
  name: string;
  brand?: string | null;
  shortDesc?: string | null;
  certifications?: string[] | null;
  ingredients?: unknown;
  variations: readonly ArcVariation[];
  storyConfig?: unknown;
}

/**
 * Khung sân khấu là hình vuông 1:1; xPct/yPct của lớp nguyên liệu và điểm chỉ tính theo khung này. Ảnh sản phẩm nằm trong khung với lề
 * từng này phần trăm mỗi cạnh ở Mini, web và Studio, nên một điểm đặt lên chai ở Studio rơi đúng chỗ đó ở hai app.
 */
export const STORY_PRODUCT_INSET_PCT = 12;
/** Bề rộng một lớp nguyên liệu rơi, tính theo bề rộng khung sân khấu (Mini và web cùng tỷ lệ, không dùng cỡ cố định). */
export const STORY_LAYER_WIDTH_PCT = 24;
export const ARC_ACTIVE = { scale: 1.22, rotateDeg: -6 } as const;
const ARC_AMBIENTS: readonly StoryAmbient[] = ['leaf', 'amber', 'sky', 'sand'];

export const ambientVar = (a: StoryAmbient): string => `var(--color-story-ambient-${a})`;
export const toneVar = (t: StoryTone): string => `var(--color-story-tone-${t})`;

/** Chữ sinh tự động: luôn là text (bỏ `<` `>`), gọn khoảng trắng, cắt theo trần của `parseStoryConfig`. */
const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Phân loại như API trả: `attributes` là bản ghi {khoá: giá trị} hoặc mảng {name, value} của Pancake. Kiểu hẹp đủ để dựng nhãn, không buộc app khai lại kiểu. */
export interface ArcVariation {
  id: string;
  name: string;
  attributes?: unknown;
}

/** Đồng bộ Pancake từng ghi tên phân loại là "[object Object]" (hoặc để trống): gặp tên hỏng thì lấy giá trị thuộc tính, không có thì #số thứ tự. */
function arcLabel(v: ArcVariation, index: number): string {
  const name = clean(v.name, STORY_LIMITS.maxLabel);
  if (name && !name.includes('[object Object]')) return name;
  const attrs = v.attributes;
  const values = (Array.isArray(attrs) ? attrs.map((a) => (typeof a === 'object' && a !== null ? (a as { value?: unknown }).value : undefined)) : typeof attrs === 'object' && attrs !== null ? Object.values(attrs) : [])
    .map((x) => clean(x, STORY_LIMITS.maxLabel))
    .filter(Boolean);
  return clean(values.join(' · '), STORY_LIMITS.maxLabel) || `#${index + 1}`;
}

export function buildArcScene(variations: readonly ArcVariation[], ambients: readonly StoryAmbient[] = ARC_AMBIENTS): StoryScene | null {
  if (variations.length < 2) return null;
  const items: VariantArcItem[] = variations.slice(0, STORY_LIMITS.maxArcItems).map((v, i) => ({
    variationId: v.id,
    label: arcLabel(v, i),
    ambient: ambients[i % ambients.length] ?? 'leaf',
  }));
  return { kind: 'variant_arc', items };
}

interface Ing {
  name: string;
  percentage?: string;
  benefit?: string;
}

/** Cột `ingredients` cũ có thể là chuỗi "A, B", mảng chuỗi, mảng {name, percentage, benefit} hay thứ lạ: luôn ra danh sách sạch, không ném lỗi. */
function normalizeIngredients(raw: unknown): Ing[] {
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out: Ing[] = [];
  for (const it of list) {
    const rec = typeof it === 'object' && it !== null ? (it as Record<string, unknown>) : null;
    const name = clean(rec ? rec.name : it, STORY_LIMITS.maxLabel);
    if (!name) continue;
    const ing: Ing = { name };
    const pct = rec ? rec.percentage : undefined;
    const pctText = typeof pct === 'number' && Number.isFinite(pct) ? String(pct) : clean(pct, STORY_LIMITS.maxLabel);
    if (pctText) ing.percentage = pctText;
    const benefit = rec ? clean(rec.benefit, STORY_LIMITS.maxBody - 1).replace(/[.\s]+$/, '') : '';
    if (benefit) ing.benefit = benefit;
    out.push(ing);
    if (out.length >= STORY_LIMITS.maxHudPoints * 2) break;
  }
  return out;
}

const LAYER_SLOTS: readonly { x: number; y: number; from: StoryFrom; rot: number }[] = [
  { x: 30, y: 24, from: 'top', rot: -15 },
  { x: 22, y: 56, from: 'left', rot: 20 },
  { x: 74, y: 30, from: 'right', rot: 10 },
  { x: 60, y: 58, from: 'top', rot: -30 },
  { x: 76, y: 50, from: 'right', rot: 25 },
];
const HUD_SLOTS: readonly { x: number; y: number; side: 'left' | 'right' }[] = [
  { x: 26, y: 30, side: 'left' },
  { x: 74, y: 46, side: 'right' },
  { x: 26, y: 62, side: 'left' },
  { x: 74, y: 78, side: 'right' },
];

function layerFor(ing: Ing, n: number, slot: number): IngredientLayerSprite {
  const s = LAYER_SLOTS[slot % LAYER_SLOTS.length]!;
  const spriteId = spriteForIngredient(ing.name);
  return { id: `d${n}-${slot}`, spriteId, label: clean(ing.name, STORY_LIMITS.maxLabel) || (STORY_SPRITES[spriteId]?.label ?? spriteId), from: s.from, xPct: s.x, yPct: s.y, scale: 1, rotateDeg: s.rot };
}

/** Kịch bản tự sinh từ dữ liệu có thật của sản phẩm; không thành phần dùng được và dưới 2 biến thể thì không có gì để kể (null). */
export function buildDefaultStoryConfig(p: StoryProductInput): ProductStoryConfig | null {
  const ings = normalizeIngredients(p.ingredients);
  const scenes: StoryScene[] = [];
  const arc = buildArcScene(p.variations);
  if (arc) scenes.push(arc);
  if (ings.length > 0) {
    const names = ings.map((i) => i.name);
    const name = clean(p.name, STORY_LIMITS.maxLabel);
    const brand = clean(p.brand, STORY_LIMITS.maxLabel);
    const first = names.slice(0, 3).join(', ');
    const benefit = ings.find((i) => i.benefit)?.benefit;
    const steps: AssemblyStep[] = [
      { title: fillCopy('story.stepTitle1'), body: clean(fillCopy('story.def1', { a: first }), STORY_LIMITS.maxBody), layers: ings.slice(0, 2).map((g, i) => layerFor(g, 1, i)) },
      { title: fillCopy('story.stepTitle2'), body: clean(fillCopy('story.def2', { a: names[1] ?? names[0]! }), STORY_LIMITS.maxBody), layers: ings.slice(1, 3).concat(ings.length < 2 ? ings.slice(0, 1) : []).map((g, i) => layerFor(g, 2, i + 2)) },
      { title: fillCopy('story.stepTitle3'), body: clean(fillCopy('story.def3', { name }), STORY_LIMITS.maxBody), layers: ings.slice(0, 3).map((g, i) => layerFor(g, 3, i + 1)) },
    ];
    if (benefit) steps.push({ title: fillCopy('story.stepTitle4'), body: clean(fillCopy('story.def4', { a: benefit }), STORY_LIMITS.maxBody), layers: ings.slice(0, 2).map((g, i) => layerFor(g, 4, i)) });
    steps.push({ title: fillCopy('story.stepTitle5'), body: clean(fillCopy('story.def5', { brand, name }), STORY_LIMITS.maxBody), layers: ings.slice(0, 2).map((g, i) => layerFor(g, 5, i + 3)) });
    scenes.push({ kind: 'ingredient_assembly', steps: steps.slice(0, STORY_LIMITS.maxSteps) });
    const points: HudCalloutPoint[] = ings.slice(0, STORY_LIMITS.maxHudPoints).map((g, i) => {
      const slot = HUD_SLOTS[i]!;
      const pt: HudCalloutPoint = { id: `d${i + 1}`, xPct: slot.x, yPct: slot.y, label: g.name, side: slot.side };
      if (g.percentage) {
        pt.value = g.percentage;
        if (/^\d+(\.\d+)?%$/.test(g.percentage)) pt.barPct = Math.min(100, Number.parseFloat(g.percentage));
      }
      return pt;
    });
    scenes.push({ kind: 'hud_callouts', points, closing: fillCopy('story.closing') });
  }
  return scenes.length === 0 ? null : { version: 1, enabled: true, scenes };
}

/**
 * Vòng cung là bộ chọn phân loại nên phải khớp biến thể đang bán: giữ bản đã lưu khi nó liệt kê đúng các biến thể thật (giữ chữ
 * và màu admin đặt); lệch (đã xoá, thêm mới, thiếu variationId) thì dựng lại từ biến thể thật; dưới 2 biến thể thì bỏ cảnh.
 * Hết cảnh thì null để trang không vẽ khung rỗng.
 */
function reconcileArc(config: ProductStoryConfig, variations: readonly ArcVariation[]): ProductStoryConfig | null {
  if (!config.scenes.some((s) => s.kind === 'variant_arc')) return config;
  const fresh = buildArcScene(variations);
  const real = variations.slice(0, STORY_LIMITS.maxArcItems).map((v) => v.id);
  const scenes: StoryScene[] = [];
  for (const sc of config.scenes) {
    if (sc.kind !== 'variant_arc') {
      scenes.push(sc);
      continue;
    }
    if (!fresh) continue;
    const ids = sc.items.map((i) => i.variationId);
    const same = ids.length === real.length && ids.every((id, i) => id === real[i]);
    scenes.push(same ? sc : fresh);
  }
  return scenes.length === 0 ? null : { ...config, scenes };
}

/**
 * Cấu hình dùng để vẽ: đã lưu (hợp lệ) > preset theo slug (mẫu seed hoặc mẫu đợt đầu theo slug gốc; chèn vòng cung từ biến thể thật) > tự sinh từ thành phần.
 * `enabled:false` là admin tắt hẳn. Trả null thì trang chi tiết không vẽ gì thêm.
 */
export function resolveStoryConfig(p: StoryProductInput): ProductStoryConfig | null {
  if (p.storyConfig !== null && p.storyConfig !== undefined) {
    const parsed = parseStoryConfig(p.storyConfig);
    if (parsed.ok) return parsed.value.enabled ? reconcileArc(parsed.value, p.variations) : null;
  }
  const preset = findStoryPreset(p.slug);
  if (preset) {
    if (!preset.enabled) return null;
    const arc = buildArcScene(p.variations);
    return arc ? { ...preset, scenes: [arc, ...preset.scenes] } : preset;
  }
  return buildDefaultStoryConfig(p);
}

export interface StoryStepView {
  num: string;
  title: string;
  body: string;
  layers: IngredientLayerSprite[];
}

/**
 * Khung ảnh sản phẩm: admin chọn thì theo admin; không chọn thì ảnh tách nền (`cutoutUrl`) đặt thẳng lên nền cảnh, còn ảnh gốc của
 * sản phẩm (poster, ảnh chụp có nền) vào thẻ nổi để không lộ cạnh vuông thô.
 */
export function storyImageFrame(config: Pick<ProductStoryConfig, 'cutoutUrl' | 'imageFrame'>): StoryImageFrame {
  return config.imageFrame ?? (config.cutoutUrl ? 'cutout' : 'floating-card');
}

export interface StoryViewModel {
  /** false khi khách chọn giảm chuyển động: hai app vẽ bản tĩnh đủ nội dung bằng `staticLayers`. */
  animated: boolean;
  cutoutUrl: string | null;
  frame: StoryImageFrame;
  arc: VariantArcItem[] | null;
  steps: StoryStepView[];
  hud: { points: HudCalloutPoint[]; closing: string } | null;
  staticLayers: IngredientLayerSprite[];
}

export function storyView(config: ProductStoryConfig, opts: { reducedMotion: boolean }): StoryViewModel {
  let arc: VariantArcItem[] | null = null;
  let steps: StoryStepView[] = [];
  let hud: StoryViewModel['hud'] = null;
  for (const s of config.scenes) {
    if (s.kind === 'variant_arc') arc = s.items.length > 0 ? s.items : null;
    else if (s.kind === 'ingredient_assembly') steps = s.steps.map((st, i) => ({ num: String(i + 1).padStart(2, '0'), title: st.title, body: st.body, layers: st.layers }));
    else hud = { points: s.points, closing: s.closing };
  }
  const animated = !opts.reducedMotion;
  const seen = new Set<string>();
  const staticLayers = animated ? [] : steps.flatMap((s) => s.layers).filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
  return { animated, cutoutUrl: config.cutoutUrl ?? null, frame: storyImageFrame(config), arc, steps, hud, staticLayers };
}

/** Lớp nguyên liệu đã "rơi vào" tới bước đang xem (tích luỹ); chỉ số ngoài khoảng được kẹp. */
export function layersUpTo(steps: readonly StoryStepView[], active: number): IngredientLayerSprite[] {
  if (steps.length === 0) return [];
  const last = Math.min(steps.length - 1, Math.max(0, Math.trunc(active) || 0));
  return steps.slice(0, last + 1).flatMap((s) => s.layers);
}

/** Vị trí một mục trên vòng cung biến thể; `offset` tính theo số ô lệch so với mục đang chọn (âm = bên trái). */
export function arcSlot(index: number, active: number, total: number): { scale: number; rotateDeg: number; offset: number; lift: number } {
  const max = Math.max(total - 1, 0);
  const d = Math.min(max, Math.max(-max, index - active));
  if (d === 0) return { ...ARC_ACTIVE, offset: 0, lift: 0 };
  const dist = Math.abs(d);
  return { scale: Math.max(0.6, 1 - 0.12 * dist), rotateDeg: d * 5, offset: d, lift: Math.min(dist, 3) * 8 };
}
