import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStoryConfig, STORY_LIMITS } from '@tubutree/shared-types';
import { STORY_PRESETS } from './story-presets';
import { STORY_SPRITES } from './story-sprites';

const GROUPS: Record<string, string[]> = {
  'cham-soc-ca-nhan-me-be': ['dau-goi-buoi-po-lang', 'serum-duong-am-visante', 'kem-duong-ba-bau-visante', 'nuoc-tam-goi-be-cobote'],
  'thuc-pham-do-uong': ['arabica-cau-dat-le-plateau', 'mat-ong-rung-bhnong', 'granola-hat-sokfram', 'bot-rau-ma-sokfram'],
  'cham-soc-nha-cua': ['nuoc-rua-chen-fuwa3e', 'nuoc-giat-fuwa3e'],
};
const SLUGS = Object.values(GROUPS).flat();

describe('STORY_PRESETS', () => {
  it('đủ 10 sản phẩm mẫu của 3 nhóm ngành hàng, không thừa', () => {
    expect(SLUGS).toHaveLength(10);
    expect(Object.keys(STORY_PRESETS).sort()).toEqual([...SLUGS].sort());
  });

  it('mỗi slug có thật trong dữ liệu mẫu của API', () => {
    const seed = readFileSync(resolve(__dirname, '../../../../apps/api/prisma/seed.ts'), 'utf8');
    for (const slug of SLUGS) expect(seed, slug).toContain(`slug: '${slug}'`);
  });

  it.each(SLUGS)('%s: qua parseStoryConfig, 5 bước và 3–4 điểm chỉ', (slug) => {
    const cfg = STORY_PRESETS[slug]!;
    const r = parseStoryConfig(cfg);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const assembly = cfg.scenes.find((s) => s.kind === 'ingredient_assembly');
    const hud = cfg.scenes.find((s) => s.kind === 'hud_callouts');
    expect(assembly && assembly.kind === 'ingredient_assembly' && assembly.steps.length).toBe(5);
    expect(hud && hud.kind === 'hud_callouts' && hud.points.length).toBeGreaterThanOrEqual(3);
    expect(hud && hud.kind === 'hud_callouts' && hud.points.length).toBeLessThanOrEqual(STORY_LIMITS.maxHudPoints);
    expect(cfg.enabled).toBe(true);
  });

  it('mọi spriteId của preset có trong thư viện, mọi bước có ít nhất một lớp', () => {
    for (const [slug, cfg] of Object.entries(STORY_PRESETS)) {
      for (const sc of cfg.scenes) {
        if (sc.kind !== 'ingredient_assembly') continue;
        for (const st of sc.steps) {
          expect(st.layers.length, `${slug}: ${st.title}`).toBeGreaterThan(0);
          for (const l of st.layers) expect(STORY_SPRITES, `${slug}: ${l.spriteId}`).toHaveProperty(l.spriteId ?? '');
        }
      }
    }
  });

  it('preset không tự thêm cảnh vòng cung (vòng cung sinh từ biến thể thật lúc chạy)', () => {
    for (const cfg of Object.values(STORY_PRESETS)) expect(cfg.scenes.some((s) => s.kind === 'variant_arc')).toBe(false);
  });

  it('chỉ nêu phần trăm có trong dữ liệu mẫu (không bịa thông số)', () => {
    const seed = readFileSync(resolve(__dirname, '../../../../apps/api/prisma/seed.ts'), 'utf8');
    for (const [slug, cfg] of Object.entries(STORY_PRESETS)) {
      for (const sc of cfg.scenes) {
        if (sc.kind !== 'hud_callouts') continue;
        for (const p of sc.points) {
          if (!p.value) continue;
          expect(seed, `${slug}: ${p.label} ${p.value}`).toContain(`percentage: '${p.value}'`);
        }
      }
    }
  });
});
