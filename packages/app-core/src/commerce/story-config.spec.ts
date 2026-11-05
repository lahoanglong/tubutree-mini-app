import { describe, expect, it } from 'vitest';
import { parseStoryConfig, STORY_LIMITS, type ProductStoryConfig } from '@tubutree/shared-types';

const layer = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  spriteId: 'pomelo-peel',
  label: 'Vỏ bưởi',
  from: 'top',
  xPct: 50,
  yPct: 40,
  scale: 1,
  rotateDeg: 10,
  ...over,
});

const valid = (): ProductStoryConfig => ({
  version: 1,
  enabled: true,
  cutoutUrl: 'https://cdn.example.com/chai.webp',
  scenes: [
    { kind: 'variant_arc', items: [{ label: '300ml', ambient: 'leaf' }, { label: '500ml', ambient: 'amber' }] },
    {
      kind: 'ingredient_assembly',
      steps: [{ title: 'Tinh tuyển nguyên liệu', body: 'Vỏ bưởi tươi.', layers: [layer() as never] }],
    },
    {
      kind: 'hud_callouts',
      points: [{ id: 'p1', xPct: 30, yPct: 60, label: 'Tinh dầu vỏ bưởi', value: '2%', barPct: 2, side: 'left' }],
      closing: 'An lành cho cả nhà',
    },
  ],
});

const step = (n: number) => ({ title: `Bước ${n}`, body: 'x', layers: [] });
const withScenes = (scenes: unknown) => ({ ...valid(), scenes });

describe('parseStoryConfig', () => {
  it('parses a valid 3-scene config', () => {
    const r = parseStoryConfig(valid());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.scenes).toHaveLength(3);
  });

  it('rejects javascript: imageUrl', () => {
    const cfg = withScenes([{ kind: 'ingredient_assembly', steps: [{ title: 't', body: 'b', layers: [layer({ imageUrl: 'javascript:alert(1)' })] }] }]);
    expect(parseStoryConfig(cfg).ok).toBe(false);
  });

  it('rejects javascript: cutoutUrl', () => {
    expect(parseStoryConfig({ ...valid(), cutoutUrl: 'javascript:alert(1)' }).ok).toBe(false);
  });

  it('rejects more than 5 steps', () => {
    const steps = [1, 2, 3, 4, 5, 6].map(step);
    expect(STORY_LIMITS.maxSteps).toBe(5);
    expect(parseStoryConfig(withScenes([{ kind: 'ingredient_assembly', steps }])).ok).toBe(false);
  });

  it('clamps xPct 140 to 100 and -5 to 0', () => {
    const cfg = withScenes([{ kind: 'hud_callouts', closing: 'c', points: [{ id: 'a', xPct: 140, yPct: -5, label: 'l', side: 'right' }] }]);
    const r = parseStoryConfig(cfg);
    expect(r.ok).toBe(true);
    const sc = r.ok ? r.value.scenes[0] : undefined;
    expect(sc?.kind).toBe('hud_callouts');
    if (sc?.kind === 'hud_callouts') {
      expect(sc.points[0]?.xPct).toBe(100);
      expect(sc.points[0]?.yPct).toBe(0);
    }
  });

  it('rejects NaN yPct', () => {
    const cfg = withScenes([{ kind: 'hud_callouts', closing: 'c', points: [{ id: 'a', xPct: 1, yPct: Number.NaN, label: 'l', side: 'left' }] }]);
    expect(parseStoryConfig(cfg).ok).toBe(false);
  });

  it('strips unknown keys', () => {
    const r = parseStoryConfig({ ...valid(), evil: '<script>' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value)).not.toContain('evil');
  });

  it('rejects JSON over 16KB', () => {
    expect(parseStoryConfig({ ...valid(), pad: 'x'.repeat(17_000) }).ok).toBe(false);
  });

  it('strips angle brackets from labels', () => {
    const cfg = withScenes([{ kind: 'variant_arc', items: [{ label: '<b>300</b>ml', ambient: 'leaf' }] }]);
    const r = parseStoryConfig(cfg);
    expect(r.ok).toBe(true);
    const sc = r.ok ? r.value.scenes[0] : undefined;
    expect(sc?.kind).toBe('variant_arc');
    if (sc?.kind === 'variant_arc') expect(sc.items[0]?.label).toBe('b300/bml');
  });

  it('rejects version 2', () => {
    expect(parseStoryConfig({ ...valid(), version: 2 }).ok).toBe(false);
  });

  it('rejects non-objects and more than 3 scenes', () => {
    expect(parseStoryConfig(null).ok).toBe(false);
    expect(parseStoryConfig('x').ok).toBe(false);
    const s = valid().scenes;
    expect(parseStoryConfig(withScenes([...s, s[0]])).ok).toBe(false);
  });

  it('rejects a layer from value outside top/left/right/bottom', () => {
    const cfg = withScenes([{ kind: 'ingredient_assembly', steps: [{ title: 't', body: 'b', layers: [layer({ from: 'diagonal' })] }] }]);
    expect(parseStoryConfig(cfg).ok).toBe(false);
  });
  it('rejects a variant_arc scene with zero items', () => {
    const r = parseStoryConfig(withScenes([{ kind: 'variant_arc', items: [] }]));
    expect(r.ok).toBe(false);
  });

  it('accepts a cutoutUrl that points at a registered product image, with or without version', () => {
    for (const u of ['/public-image/product/p1/3', '/public-image/product/p1/3?v=0a1b2c3d4e5f6071']) {
      const r = parseStoryConfig({ ...valid(), cutoutUrl: u });
      expect(r.ok && r.value.cutoutUrl).toBe(u);
    }
  });

  it('rejects public-image references that are not a product image slot', () => {
    for (const u of ['/public-image/brand/p1/logo', '/public-image/product/p1/../x', '/public-image/product/p1/3?v=zz', '/public-image/product//3', '//evil.test/public-image/product/p1/3']) {
      expect(parseStoryConfig({ ...valid(), cutoutUrl: u }).ok).toBe(false);
    }
  });
});
