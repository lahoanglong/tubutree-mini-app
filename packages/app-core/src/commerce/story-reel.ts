import { STORY_LIMITS, type AssemblyStep, type ProductStoryConfig } from '@tubutree/shared-types';
import { fillCopy } from '../shop-copy';
import { resolveStoryConfig, type StoryProductInput } from './product-story';

/**
 * Dải vòng tròn "Story" đầu Trang chủ: mỗi vòng mở khung Reel toàn màn của `ProductStoryShowcase` cho sản phẩm đó.
 * Logic chọn món, kịch bản dự phòng và trạng thái "đã xem" nằm ở đây để Mini App và web vẽ cùng một thứ.
 */

/** Trần và sàn số vòng: dưới sàn thì dải ẩn hẳn (không để tiêu đề trơ), như luật kệ ở `shelves.ts`. */
export const REEL_MAX_ITEMS = 8;
export const REEL_MIN_ITEMS = 3;

/** Khoá sessionStorage nhớ slug đã mở Reel trong phiên: vòng đã xem đổi từ viền xanh sang viền xám. */
export const REEL_SEEN_KEY = 'tubu.reel.seen.v1';

export interface ReelCandidate {
  slug: string;
  name: string;
  thumbnail: string | null;
  inStock: boolean;
  /** Ai giao; thiếu (API cũ) coi là Tubu giao như dải gợi ý bù đơn. Món đối tác không lên dải: chương dự phòng nói "Món Tubu Tree chọn". */
  fulfiller?: { kind?: string } | null;
}

/**
 * Các món lên dải: Tubu giao, còn hàng, có tên, CÓ ẢNH, không trùng slug, theo đúng thứ tự nguồn (Bán chạy nhất), tối đa `REEL_MAX_ITEMS`.
 * Món chưa có ảnh bị bỏ: vòng Story chỉ có ảnh sản phẩm bên trong, ô thay thế (lá) không kể được gì trong một khung Reel.
 * Dưới `REEL_MIN_ITEMS` món thì trả rỗng: dải không hiện.
 */
export function reelItems<T extends ReelCandidate>(cards: readonly T[] | null | undefined, limit: number = REEL_MAX_ITEMS): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of cards ?? []) {
    if (!c.slug || !c.name.trim() || !c.thumbnail?.trim() || c.inStock === false || (c.fulfiller?.kind ?? 'TUBU') !== 'TUBU' || seen.has(c.slug)) continue;
    seen.add(c.slug);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out.length >= REEL_MIN_ITEMS ? out : [];
}

/** Phần của chi tiết sản phẩm mà kịch bản dự phòng đọc. */
export interface ReelProductInput extends StoryProductInput {
  certifications?: string[] | null;
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';

const step = (title: string, body: string): AssemblyStep => ({ title, body, layers: [] });

/**
 * Kịch bản dự phòng cho món chưa có cấu hình riêng, preset, thành phần hay nhãn chủ lực. Chỉ nêu điều có trong dữ liệu sản phẩm
 * (tên, nhãn, chứng nhận do admin nhập, mô tả ngắn) hoặc điều cửa hàng làm thật (giao hàng). Cố ý KHÔNG có nơi sản xuất, vùng miền,
 * "thu hoạch", "độ giòn ngọt" hay chứng nhận không có trong dữ liệu: đó là tuyên bố cần giấy tờ (xem `story-presets-launch.ts`).
 * Không có lớp nguyên liệu vì không có nguyên liệu thật để vẽ; khung vẫn có ảnh sản phẩm trên nền quầng sáng.
 */
export function reelFallbackConfig(p: ReelProductInput): ProductStoryConfig {
  const name = clean(p.name, STORY_LIMITS.maxLabel);
  const brand = clean(p.brand, STORY_LIMITS.maxLabel) || 'Tubu Tree';
  const certs = (p.certifications ?? []).map((c) => clean(c, STORY_LIMITS.maxLabel)).filter(Boolean).slice(0, 3);
  const desc = clean(p.shortDesc, STORY_LIMITS.maxBody);
  const steps: AssemblyStep[] = [step(fillCopy('reel.fb1Title'), clean(fillCopy('reel.fb1Body', { name }), STORY_LIMITS.maxBody))];
  if (certs.length > 0) steps.push(step(fillCopy('reel.fbCertTitle'), clean(fillCopy('reel.fbCertBody', { a: certs.join(', ') }), STORY_LIMITS.maxBody)));
  if (desc) steps.push(step(fillCopy('reel.fbDescTitle'), desc));
  if (steps.length === 1) steps.push(step(fillCopy('reel.fbShipTitle'), fillCopy('reel.fbShipBody')));
  steps.push(step(fillCopy('story.stepTitle5'), clean(fillCopy('story.def5', { brand, name }), STORY_LIMITS.maxBody)));
  return { version: 1, enabled: true, scenes: [{ kind: 'ingredient_assembly', steps: steps.slice(0, STORY_LIMITS.maxSteps) }] };
}

/**
 * Cấu hình dùng cho Reel Trang chủ: luôn có (không null). Cấu hình đã lưu, preset, tự sinh và kịch bản nhãn như trang chi tiết
 * (`resolveStoryConfig`), nhưng bỏ cảnh vòng cung (Reel không chọn phân loại: thêm giỏ lấy đúng phân loại đại diện của thẻ). Không còn
 * cảnh nào thì dùng kịch bản dự phòng. Admin tắt câu chuyện của món thì gọi `reelDisabled` trước để bỏ món khỏi dải.
 */
export function resolveReelStoryConfig(p: ReelProductInput): ProductStoryConfig {
  const base = resolveStoryConfig(p);
  const scenes = (base?.scenes ?? []).filter((s) => s.kind !== 'variant_arc');
  if (base && scenes.length > 0) return { ...base, scenes };
  return reelFallbackConfig(p);
}

/** Admin đã tắt hẳn câu chuyện của món này (cấu hình lưu hợp lệ với `enabled: false`): Reel tôn trọng, không dựng kịch bản dự phòng. */
export function reelDisabled(p: Pick<ReelProductInput, 'storyConfig'>): boolean {
  const raw = p.storyConfig;
  return typeof raw === 'object' && raw !== null && (raw as { enabled?: unknown }).enabled === false;
}

type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Slug đã xem trong phiên; storage thiếu hay hỏng thì coi như chưa xem gì (không ném lỗi). */
export function readReelSeen(storage: SeenStorage | null | undefined): Set<string> {
  try {
    const raw = storage?.getItem(REEL_SEEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(-64) : []);
  } catch {
    return new Set();
  }
}

/** Ghi nhớ một slug vừa mở, trả bộ mới (bộ cũ không bị sửa). Ghi lỗi (storage đầy, chế độ riêng tư) vẫn trả bộ mới để vòng đổi màu trong phiên. */
export function markReelSeen(storage: SeenStorage | null | undefined, seen: ReadonlySet<string>, slug: string): Set<string> {
  const next = new Set(seen);
  next.add(slug);
  try {
    storage?.setItem(REEL_SEEN_KEY, JSON.stringify([...next].slice(-64)));
  } catch {
    /* không ghi được thì chỉ mất trạng thái "đã xem" khi mở lại app */
  }
  return next;
}

/** Slug của Reel kế (`dir` = 1) hoặc trước (`dir` = -1); null khi hết dải hoặc slug không có trong dải. */
export function reelNeighbor(slugs: readonly string[], slug: string, dir: 1 | -1): string | null {
  const i = slugs.indexOf(slug);
  return i < 0 ? null : (slugs[i + dir] ?? null);
}
