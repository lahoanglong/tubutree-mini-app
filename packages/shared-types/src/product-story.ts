/**
 * Cấu hình câu chuyện sản phẩm (cột Product.storyConfig). Nguồn kiểu và bộ kiểm duy nhất: API kiểm trước khi ghi,
 * app-core dùng để dựng preset, hai app chỉ vẽ kết quả đã qua `parseStoryConfig`.
 */
export const STORY_LIMITS = {
  maxScenes: 3,
  maxSteps: 5,
  maxLayersPerStep: 6,
  maxHudPoints: 4,
  maxArcItems: 8,
  maxLabel: 40,
  maxBody: 140,
  maxClosing: 80,
  maxJsonBytes: 16 * 1024,
} as const;

export type StoryAmbient = 'leaf' | 'amber' | 'rose' | 'sky' | 'sand';
export type StoryFrom = 'top' | 'left' | 'right' | 'bottom';

export interface IngredientLayerSprite {
  id: string;
  /** Mã sprite trong thư viện nguyên liệu (app-core). Một trong `spriteId`/`imageUrl`. */
  spriteId?: string;
  /** Ảnh nguyên liệu tải lên: chỉ https hoặc đường dẫn `/api/...`. */
  imageUrl?: string;
  label: string;
  from: StoryFrom;
  xPct: number;
  yPct: number;
  scale: number;
  rotateDeg: number;
}

export interface AssemblyStep {
  title: string;
  body: string;
  layers: IngredientLayerSprite[];
}

export interface HudCalloutPoint {
  id: string;
  xPct: number;
  yPct: number;
  label: string;
  value?: string;
  barPct?: number;
  side: 'left' | 'right';
}

export interface VariantArcItem {
  variationId?: string;
  label: string;
  ambient: StoryAmbient;
}

export type StoryScene =
  | { kind: 'variant_arc'; items: VariantArcItem[] }
  | { kind: 'ingredient_assembly'; steps: AssemblyStep[] }
  | { kind: 'hud_callouts'; points: HudCalloutPoint[]; closing: string };

export interface ProductStoryConfig {
  version: 1;
  enabled: boolean;
  cutoutUrl?: string;
  scenes: StoryScene[];
}

export type ParseStoryResult = { ok: true; value: ProductStoryConfig } | { ok: false; error: string };

const AMBIENTS: readonly StoryAmbient[] = ['leaf', 'amber', 'rose', 'sky', 'sand'];
const FROMS: readonly StoryFrom[] = ['top', 'left', 'right', 'bottom'];

class Bad extends Error {}
const fail = (msg: string): never => {
  throw new Bad(msg);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Chữ hiển thị: luôn là text, bỏ `<` `>` (không bao giờ là HTML), cắt theo trần. */
function text(v: unknown, max: number, what: string, required = true): string {
  if (v === undefined || v === null || v === '') {
    if (required) fail(`${what} thiếu`);
    return '';
  }
  if (typeof v !== 'string') fail(`${what} phải là chữ`);
  const clean = (v as string).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (required && clean === '') fail(`${what} thiếu`);
  return clean.slice(0, max);
}

function num(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} phải là số`);
  return Math.min(hi, Math.max(lo, v as number));
}

/** Ảnh sản phẩm đã đăng ký ở API: `/public-image/product/<id>/<số thứ tự>` (mã `v` tuỳ chọn). Máy khách ghép thêm địa chỉ API phía trước. */
const OWN_PRODUCT_IMAGE = /^\/public-image\/product\/[A-Za-z0-9_-]{1,64}\/\d{1,2}(?:\?v=[0-9a-f]{1,32})?$/;

function url(v: unknown, what: string): string {
  if (typeof v !== 'string') return fail(`${what} phải là đường dẫn`);
  const s = v.trim();
  if (s.length > 2048) fail(`${what} quá dài`);
  if (s.startsWith('/api/') && !s.includes('..') && !s.includes('//')) return s;
  if (OWN_PRODUCT_IMAGE.test(s)) return s;
  try {
    if (new URL(s).protocol === 'https:') return s;
  } catch {
    /* rơi xuống lỗi */
  }
  return fail(`${what} chỉ nhận link https hoặc ảnh đã đăng ký`);
}

function arr(v: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(v)) return fail(`${what} phải là danh sách`);
  if (v.length > max) fail(`${what} tối đa ${max} mục`);
  return v;
}

function layer(raw: unknown): IngredientLayerSprite {
  if (!isObj(raw)) return fail('lớp nguyên liệu không hợp lệ');
  const from = raw.from;
  if (!FROMS.includes(from as StoryFrom)) fail('hướng bay không hợp lệ');
  const out: IngredientLayerSprite = {
    id: text(raw.id, STORY_LIMITS.maxLabel, 'mã lớp'),
    label: text(raw.label, STORY_LIMITS.maxLabel, 'tên lớp'),
    from: from as StoryFrom,
    xPct: num(raw.xPct, 0, 100, 'xPct'),
    yPct: num(raw.yPct, 0, 100, 'yPct'),
    scale: num(raw.scale, 0.2, 3, 'scale'),
    rotateDeg: num(raw.rotateDeg, -180, 180, 'rotateDeg'),
  };
  if (raw.spriteId !== undefined) out.spriteId = text(raw.spriteId, STORY_LIMITS.maxLabel, 'spriteId');
  if (raw.imageUrl !== undefined) out.imageUrl = url(raw.imageUrl, 'imageUrl');
  if (out.spriteId === undefined && out.imageUrl === undefined) fail('lớp cần spriteId hoặc imageUrl');
  return out;
}

function scene(raw: unknown): StoryScene {
  if (!isObj(raw)) return fail('cảnh không hợp lệ');
  if (raw.kind === 'variant_arc') {
    const rawItems = arr(raw.items, STORY_LIMITS.maxArcItems, 'mục vòng cung');
    if (rawItems.length === 0) fail('vòng cung cần ít nhất một mục');
    const items = rawItems.map((it): VariantArcItem => {
      if (!isObj(it)) return fail('mục vòng cung không hợp lệ');
      if (!AMBIENTS.includes(it.ambient as StoryAmbient)) fail('màu nền không hợp lệ');
      const out: VariantArcItem = { label: text(it.label, STORY_LIMITS.maxLabel, 'nhãn'), ambient: it.ambient as StoryAmbient };
      if (it.variationId !== undefined) out.variationId = text(it.variationId, 64, 'variationId');
      return out;
    });
    return { kind: 'variant_arc', items };
  }
  if (raw.kind === 'ingredient_assembly') {
    const steps = arr(raw.steps, STORY_LIMITS.maxSteps, 'bước').map((st): AssemblyStep => {
      if (!isObj(st)) return fail('bước không hợp lệ');
      return {
        title: text(st.title, STORY_LIMITS.maxLabel, 'tiêu đề bước'),
        body: text(st.body, STORY_LIMITS.maxBody, 'nội dung bước', false),
        layers: arr(st.layers ?? [], STORY_LIMITS.maxLayersPerStep, 'lớp nguyên liệu').map(layer),
      };
    });
    return { kind: 'ingredient_assembly', steps };
  }
  if (raw.kind === 'hud_callouts') {
    const points = arr(raw.points, STORY_LIMITS.maxHudPoints, 'điểm chỉ').map((p): HudCalloutPoint => {
      if (!isObj(p)) return fail('điểm chỉ không hợp lệ');
      if (p.side !== 'left' && p.side !== 'right') fail('phía thẻ không hợp lệ');
      const out: HudCalloutPoint = {
        id: text(p.id, STORY_LIMITS.maxLabel, 'mã điểm'),
        xPct: num(p.xPct, 0, 100, 'xPct'),
        yPct: num(p.yPct, 0, 100, 'yPct'),
        label: text(p.label, STORY_LIMITS.maxLabel, 'nhãn điểm'),
        side: p.side as 'left' | 'right',
      };
      if (p.value !== undefined) out.value = text(p.value, STORY_LIMITS.maxLabel, 'giá trị', false);
      if (p.barPct !== undefined) out.barPct = num(p.barPct, 0, 100, 'barPct');
      return out;
    });
    return { kind: 'hud_callouts', points, closing: text(raw.closing, STORY_LIMITS.maxClosing, 'câu kết', false) };
  }
  return fail('loại cảnh không hợp lệ');
}

/**
 * Kiểm nghiêm một giá trị chưa tin cậy (body admin, cột Json cũ). Bỏ khoá lạ, kẹp toạ độ về 0–100, từ chối vượt giới hạn,
 * chỉ nhận ảnh https hoặc `/api/...`. Không ném lỗi: luôn trả `{ ok }`.
 */
export function parseStoryConfig(raw: unknown): ParseStoryResult {
  try {
    if (!isObj(raw)) return fail('cấu hình phải là đối tượng');
    if (JSON.stringify(raw).length > STORY_LIMITS.maxJsonBytes) fail('cấu hình quá lớn (tối đa 16 KB)');
    if (raw.version !== 1) fail('phiên bản không hỗ trợ');
    const enabled = raw.enabled;
    if (typeof enabled !== 'boolean') return fail('enabled phải là true/false');
    const scenes = arr(raw.scenes, STORY_LIMITS.maxScenes, 'cảnh').map(scene);
    const value: ProductStoryConfig = { version: 1, enabled, scenes };
    if (raw.cutoutUrl !== undefined && raw.cutoutUrl !== null) value.cutoutUrl = url(raw.cutoutUrl, 'cutoutUrl');
    return { ok: true, value };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    throw e;
  }
}
