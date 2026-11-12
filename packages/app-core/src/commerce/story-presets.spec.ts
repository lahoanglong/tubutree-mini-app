import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStoryConfig, STORY_LIMITS } from '@tubutree/shared-types';
import { BAMBOO_CLAIMS, MEDICAL_CLAIMS, NATURAL_CLAIMS, PROOF_CLAIMS } from './copy-claims-guard';
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

  it('không điểm chỉ nào mang giá trị hay thanh phần trăm', () => {
    for (const [slug, cfg] of Object.entries(STORY_PRESETS)) {
      for (const sc of cfg.scenes) {
        if (sc.kind !== 'hud_callouts') continue;
        for (const p of sc.points) {
          expect(p.value, `${slug}: ${p.label}`).toBeUndefined();
          expect(p.barPct, `${slug}: ${p.label}`).toBeUndefined();
        }
      }
    }
  });

  describe('copy-claims-guard trên toàn bộ chữ của STORY_PRESETS', () => {
    const textOf = (cfg: (typeof STORY_PRESETS)[string]): string[] =>
      cfg.scenes.flatMap((sc) => {
        if (sc.kind === 'ingredient_assembly') return sc.steps.flatMap((st) => [st.title, st.body, ...st.layers.map((l) => l.label ?? '')]);
        if (sc.kind === 'hud_callouts') return [sc.closing, ...sc.points.flatMap((p) => [p.label, p.value ?? ''])];
        return [];
      });
    const GUARDS: [string, RegExp][] = [
      ['MEDICAL_CLAIMS', MEDICAL_CLAIMS],
      ['PROOF_CLAIMS', PROOF_CLAIMS],
      ['NATURAL_CLAIMS', NATURAL_CLAIMS],
      ['BAMBOO_CLAIMS', BAMBOO_CLAIMS],
    ];

    it.each(SLUGS)('%s: mọi tiêu đề bước, nội dung bước, nhãn lớp, nhãn điểm chỉ, giá trị và câu kết đều qua bốn bộ chặn', (slug) => {
      const lines = textOf(STORY_PRESETS[slug]!);
      expect(lines.length, slug).toBeGreaterThan(10);
      for (const line of lines) for (const [name, re] of GUARDS) expect(line, `${slug}: "${line}" dính ${name}`).not.toMatch(re);
    });

    it('bộ chặn còn cắn thật: những câu cũ từng nằm trong preset bị bắt', () => {
      const OLD: [string, RegExp][] = [
        ['Tinh dầu bưởi giúp kích thích mọc tóc, giảm gãy rụng.', MEDICAL_CLAIMS],
        ['Tinh dầu sả khử mùi tanh, kháng khuẩn tự nhiên.', MEDICAL_CLAIMS],
        ['Chiết xuất rau má 5% giúp phục hồi, làm dịu da.', PROOF_CLAIMS],
        ['USDA Organic', PROOF_CLAIMS],
        ['Vegan', PROOF_CLAIMS],
        ['Mật ong rừng tự nhiên, không pha đường.', NATURAL_CLAIMS],
      ];
      for (const [text, re] of OLD) expect(text).toMatch(re);
    });
  });
  it('mọi lời khẳng định về nguồn gốc, quy trình, công dụng đặc thù chỉ xuất hiện khi dữ liệu mẫu của chính sản phẩm đó có từ ấy', () => {
    const seed = readFileSync(resolve(__dirname, '../../../../apps/api/prisma/seed.ts'), 'utf8');
    const CLAIMS = ['tây nguyên', 'enzyme', 'lên men', 'kháng khuẩn', 'khử mùi', 'sấy lạnh', 'kết dính', 'sinh học', 'thảo mộc', 'phân huỷ', 'organic', 'vegan', 'eco', 'không đường', 'mật ong', 'thơm'];
    const textOf = (cfg: (typeof STORY_PRESETS)[string]): string[] =>
      cfg.scenes.flatMap((sc) => {
        if (sc.kind === 'ingredient_assembly') return sc.steps.flatMap((st) => [st.title, st.body, ...st.layers.map((l) => l.label)]);
        if (sc.kind === 'hud_callouts') return [sc.closing, ...sc.points.flatMap((p) => [p.label, p.value ?? ''])];
        return [];
      });
    for (const [slug, cfg] of Object.entries(STORY_PRESETS)) {
      const at = seed.indexOf(`slug: '${slug}'`);
      const next = seed.indexOf("id: 'p-", at);
      const block = seed.slice(at, next === -1 ? undefined : next).toLowerCase();
      for (const line of textOf(cfg)) {
        const low = line.toLowerCase();
        for (const claim of CLAIMS) if (low.includes(claim)) expect(block, `${slug}: "${line}" nói "${claim}" nhưng dữ liệu sản phẩm không có`).toContain(claim);
      }
    }
  });
});
