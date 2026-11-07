import type { ProductStoryConfig, StoryAmbient } from '@tubutree/shared-types';
import { storyImageFrame } from './product-story';

/** Màu nền cảnh và màu chữ chính khi vẽ chữ lên cảnh. Khớp token trong design-tokens; `story-ambient-sync.spec.ts` ở Mini giữ hai bên đúng nhau. */
export const STORY_TEXT_RGB: readonly [number, number, number] = [0x1c, 0x1a, 0x16];
export const STORY_AMBIENT_RGB: Record<StoryAmbient, readonly [number, number, number]> = {
  leaf: [0xd6, 0xe6, 0xda],
  amber: [0xff, 0xf4, 0xe0],
  rose: [0xfb, 0xea, 0xe8],
  sky: [0xe8, 0xf0, 0xf7],
  sand: [0xef, 0xeb, 0xe2],
};
/** WCAG 1.4.3: chữ thường cần 4,5:1. */
export const STORY_MIN_CONTRAST = 4.5;

const lum = ([r, g, b]: readonly [number, number, number]): number => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export function contrastRatio(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type CheckState = 'ok' | 'warn' | 'missing';
/** `auto`: nội dung do hệ thống dựng từ dữ liệu sản phẩm (hoặc bản mẫu), admin chưa sửa. `custom`: admin đã tự chỉnh hoặc tự soạn. */
export type CheckSource = 'auto' | 'custom';

export interface CompletenessRow {
  key: string;
  label: string;
  state: CheckState;
  source: CheckSource;
  note: string;
}

export interface ContrastRow {
  ambient: StoryAmbient;
  ratio: number;
  pass: boolean;
}

export type CompletenessVerdict = 'ready' | 'review' | 'blocked';

export interface StoryCompleteness {
  stage: CompletenessRow;
  chapters: CompletenessRow[];
  hud: CompletenessRow;
  contrast: ContrastRow[];
  /** `blocked`: có mục thiếu hoặc chữ không đọc được. `review`: đủ nhưng còn mục cần xem lại. `ready`: không còn gì phải sửa. */
  verdict: CompletenessVerdict;
  /** Số mục cần người xem lại (cảnh báo + thiếu + tương phản trượt). */
  attention: number;
}

export interface CompletenessContext {
  /** Admin chưa lưu cấu hình riêng: mọi mục đang là kịch bản mẫu hoặc tự sinh. */
  unsaved: boolean;
  /** Kịch bản tự sinh/mẫu của sản phẩm, để nhận ra bước đã lưu nhưng chưa ai sửa. */
  baseline?: ProductStoryConfig | null;
  /** Sản phẩm có ít nhất một ảnh để làm sân khấu khi chưa có ảnh tách nền. */
  hasProductImage: boolean;
  /** false khi `cutoutUrl` trỏ tới ảnh sản phẩm đã bị xoá nên Mini App không dựng được ảnh. Bỏ trống coi như dựng được. */
  cutoutResolvable?: boolean;
}

const steps = (c: ProductStoryConfig | null | undefined) => c?.scenes.find((s) => s.kind === 'ingredient_assembly')?.steps ?? [];
const points = (c: ProductStoryConfig | null | undefined) => c?.scenes.find((s) => s.kind === 'hud_callouts');

const sameStep = (a: ReturnType<typeof steps>[number], b: ReturnType<typeof steps>[number] | undefined): boolean =>
  b !== undefined && a.title === b.title && a.body === b.body && a.layers.map((l) => l.id).join() === b.layers.map((l) => l.id).join();

/** Mục có một dòng nội dung và ít nhất một nguyên liệu rơi vào là đủ; thiếu chữ hoặc chưa có nguyên liệu thì cần xem lại. */
function chapterRow(i: number, step: ReturnType<typeof steps>[number], source: CheckSource): CompletenessRow {
  const num = String(i + 1).padStart(2, '0');
  const uploaded = step.layers.filter((l) => l.imageUrl).length;
  const library = step.layers.length - uploaded;
  const parts: string[] = [];
  if (uploaded > 0) parts.push(`${uploaded} ảnh tải lên`);
  if (library > 0) parts.push(`${library} sprite thư viện`);
  const missing: string[] = [];
  if (step.title.trim() === '') missing.push('tiêu đề');
  if (step.body.trim() === '') missing.push('nội dung');
  if (step.layers.length === 0) missing.push('nguyên liệu');
  const state: CheckState = step.title.trim() === '' ? 'missing' : missing.length > 0 ? 'warn' : 'ok';
  const note = missing.length > 0 ? `Thiếu ${missing.join(', ')}` : parts.join(' · ');
  return { key: `step-${num}`, label: `${num} · ${step.title.trim() || 'Chưa có tiêu đề'}`, state, source, note };
}

export function checkStoryCompleteness(config: ProductStoryConfig, ctx: CompletenessContext): StoryCompleteness {
  const baseSteps = steps(ctx.baseline);
  const chapters = steps(config).map((s, i) => chapterRow(i, s, ctx.unsaved || sameStep(s, baseSteps[i]) ? 'auto' : 'custom'));
  if (chapters.length === 0) chapters.push({ key: 'steps', label: 'Các bước nguyên liệu', state: 'warn', source: ctx.unsaved ? 'auto' : 'custom', note: 'Chưa có bước nào' });

  const frame = storyImageFrame(config);
  const stageSource: CheckSource = ctx.unsaved ? 'auto' : 'custom';
  const stage: CompletenessRow = config.cutoutUrl
    ? ctx.cutoutResolvable === false
      ? { key: 'stage', label: 'Ảnh sân khấu', state: 'missing', source: 'custom', note: 'Ảnh tách nền đã chọn không còn trong ảnh sản phẩm; chọn lại hoặc tải ảnh mới' }
      : { key: 'stage', label: 'Ảnh sân khấu', state: 'ok', source: 'custom', note: 'Ảnh tách nền do admin chọn' }
    : ctx.hasProductImage
      ? {
          key: 'stage',
          label: 'Ảnh sân khấu',
          state: frame === 'cutout' ? 'ok' : 'warn',
          source: stageSource,
          note: frame === 'cutout' ? 'Dùng ảnh đầu tiên của sản phẩm, đặt thẳng lên nền cảnh' : 'Dùng ảnh gốc của sản phẩm trong thẻ nổi; nên tải ảnh đã tách nền',
        }
      : { key: 'stage', label: 'Ảnh sân khấu', state: 'missing', source: stageSource, note: 'Sản phẩm chưa có ảnh nào' };

  const hudScene = points(config);
  const pts = hudScene?.kind === 'hud_callouts' ? hudScene : null;
  const hudBase = points(ctx.baseline);
  const hudSame = pts !== null && hudBase?.kind === 'hud_callouts' && JSON.stringify(pts.points) === JSON.stringify(hudBase.points) && pts.closing === hudBase.closing;
  const hudSource: CheckSource = ctx.unsaved || hudSame ? 'auto' : 'custom';
  const hud: CompletenessRow =
    !pts || pts.points.length === 0
      ? { key: 'hud', label: 'Điểm chỉ thành phần', state: 'warn', source: hudSource, note: 'Chưa có điểm chỉ nào' }
      : pts.closing.trim() === ''
        ? { key: 'hud', label: 'Điểm chỉ thành phần', state: 'warn', source: hudSource, note: `${pts.points.length} điểm chỉ, thiếu câu kết` }
        : { key: 'hud', label: 'Điểm chỉ thành phần', state: 'ok', source: hudSource, note: `${pts.points.length} điểm chỉ, có câu kết` };

  const used = new Set<StoryAmbient>(['sand']);
  for (const s of config.scenes) if (s.kind === 'variant_arc') for (const it of s.items) used.add(it.ambient);
  const contrast = [...used].map((ambient): ContrastRow => {
    const ratio = contrastRatio(STORY_TEXT_RGB, STORY_AMBIENT_RGB[ambient]);
    return { ambient, ratio, pass: ratio >= STORY_MIN_CONTRAST };
  });

  const rows = [stage, ...chapters, hud];
  const blocked = rows.some((r) => r.state === 'missing') || contrast.some((c) => !c.pass);
  const attention = rows.filter((r) => r.state !== 'ok').length + contrast.filter((c) => !c.pass).length;
  return { stage, chapters, hud, contrast, verdict: blocked ? 'blocked' : attention > 0 ? 'review' : 'ready', attention };
}
