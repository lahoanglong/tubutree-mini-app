import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CATALOG_STORY_PRESETS, LAUNCH_STORY_PRESETS, findStoryPreset } from '@tubutree/app-core/commerce/story-presets-launch';
import { DEMO_STORY_PRESETS_FILE, DEMO_STORY_PRESETS_STUB, dropDemoStoryPresetsPlugin } from './build-demo-story-presets';

// Giống bản build Zalo: bảng kịch bản mẫu rỗng.
vi.mock('@tubutree/app-core/commerce/story-presets', () => ({ STORY_PRESETS: {} }));

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMERCE = path.resolve(here, '../../../packages/app-core/src/commerce');
const DEMO_CATALOG = path.resolve(here, '../../../apps/api/src/config/demo-data/demo-catalog.ts');

type Load = (id: string) => string | null;

describe('dropDemoStoryPresetsPlugin — bản build Zalo không mang kịch bản của sản phẩm mẫu', () => {
  it('chỉ nhắm đúng tệp story-presets.ts của app-core, không đụng story-presets-launch hay spec', () => {
    expect(DEMO_STORY_PRESETS_FILE.test(path.join(COMMERCE, 'story-presets.ts'))).toBe(true);
    expect(DEMO_STORY_PRESETS_FILE.test('C:\\repo\\packages\\app-core\\src\\commerce\\story-presets.ts')).toBe(true);
    for (const other of ['story-presets-launch.ts', 'story-presets.spec.ts', 'story-sprites.ts', 'product-story.ts']) {
      expect(DEMO_STORY_PRESETS_FILE.test(path.join(COMMERCE, other)), other).toBe(false);
    }
    expect(fs.existsSync(path.join(COMMERCE, 'story-presets.ts'))).toBe(true);
  });

  it('chỉ chạy khi build; trả bảng rỗng cho đúng tệp đó (kể cả có ?query), để nguyên mọi tệp khác', () => {
    const plugin = dropDemoStoryPresetsPlugin();
    expect(plugin.apply).toBe('build');
    const load = plugin.load as unknown as Load;
    expect(load(path.join(COMMERCE, 'story-presets.ts'))).toBe(DEMO_STORY_PRESETS_STUB);
    expect(load(`${path.join(COMMERCE, 'story-presets.ts')}?v=1`)).toBe(DEMO_STORY_PRESETS_STUB);
    expect(load(path.join(COMMERCE, 'story-presets-launch.ts'))).toBeNull();
    expect(DEMO_STORY_PRESETS_STUB).toBe('export const STORY_PRESETS = {};\n');
  });

  it('khi bảng mẫu rỗng, mọi kịch bản thật (đợt đầu + catalog) vẫn tra được, kể cả slug có hậu tố băm Pancake', () => {
    const real = [...Object.keys(LAUNCH_STORY_PRESETS), ...Object.keys(CATALOG_STORY_PRESETS)];
    expect(real.length).toBeGreaterThan(40);
    for (const slug of real) {
      expect(findStoryPreset(slug), slug).toBeDefined();
      expect(findStoryPreset(`${slug}-d6c685`), `${slug}-d6c685`).toBeDefined();
    }
    expect(findStoryPreset('dau-goi-buoi-po-lang')).toBeUndefined();
  });

  it('mỗi khoá của bảng mẫu là slug sản phẩm demo và không trùng khoá kịch bản thật, nên bỏ bảng không làm mất câu chuyện của sản phẩm thật nào', async () => {
    const { STORY_PRESETS } = await vi.importActual<{ STORY_PRESETS: Record<string, unknown> }>('@tubutree/app-core/commerce/story-presets');
    const demoKeys = Object.keys(STORY_PRESETS);
    expect(demoKeys).toHaveLength(10);
    const demoCatalog = fs.readFileSync(DEMO_CATALOG, 'utf8');
    const real = new Set([...Object.keys(LAUNCH_STORY_PRESETS), ...Object.keys(CATALOG_STORY_PRESETS)]);
    for (const key of demoKeys) {
      expect(demoCatalog, key).toContain(`slug: '${key}'`);
      expect(real.has(key), key).toBe(false);
    }
  });
});
