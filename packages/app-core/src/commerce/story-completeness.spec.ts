import { describe, expect, it } from 'vitest';
import type { IngredientLayerSprite, ProductStoryConfig, StoryAmbient } from '@tubutree/shared-types';
import { checkStoryCompleteness, contrastRatio, STORY_AMBIENT_RGB, STORY_MIN_CONTRAST, STORY_TEXT_RGB } from './story-completeness';

const lay = (id: string, imageUrl?: string): IngredientLayerSprite => ({ id, label: id, from: 'top', xPct: 30, yPct: 30, scale: 1, rotateDeg: 0, ...(imageUrl ? { imageUrl } : { spriteId: 'water-droplet' }) });
const config = (over: Partial<ProductStoryConfig> = {}, ambients: StoryAmbient[] = []): ProductStoryConfig => ({
  version: 1,
  enabled: true,
  scenes: [
    ...(ambients.length ? [{ kind: 'variant_arc' as const, items: ambients.map((ambient, i) => ({ label: `L${i}`, ambient })) }] : []),
    {
      kind: 'ingredient_assembly',
      steps: [
        { title: 'Chọn lọc', body: 'Nguyên liệu tuyển chọn.', layers: [lay('a', '/api/x.png'), lay('b')] },
        { title: 'Hoà quyện', body: 'Trong từng chai.', layers: [lay('c')] },
      ],
    },
    { kind: 'hud_callouts', points: [{ id: 'p1', xPct: 20, yPct: 30, label: 'Bưởi', value: '2%', side: 'left' }], closing: 'An lành' },
  ],
  ...over,
});
const ctx = { unsaved: false, hasProductImage: true };

describe('checkStoryCompleteness', () => {
  it('đủ ảnh tách nền, chữ, nguyên liệu, điểm chỉ: sẵn sàng, mọi mục ok', () => {
    const r = checkStoryCompleteness(config({ cutoutUrl: '/api/cut.png' }), ctx);
    expect(r.verdict).toBe('ready');
    expect(r.attention).toBe(0);
    expect(r.chapters.map((c) => [c.key, c.state])).toEqual([['step-01', 'ok'], ['step-02', 'ok']]);
    expect(r.chapters[0]!.note).toBe('1 ảnh tải lên · 1 sprite thư viện');
    expect(r.chapters[0]!.label).toBe('01 · Chọn lọc');
  });

  it('chưa có ảnh tách nền: dùng ảnh gốc trong thẻ nổi thì cần xem lại, không chặn', () => {
    const r = checkStoryCompleteness(config(), ctx);
    expect(r.stage).toMatchObject({ state: 'warn' });
    expect(r.verdict).toBe('review');
    expect(r.attention).toBe(1);
  });

  it('sản phẩm không có ảnh nào: thiếu ảnh sân khấu, chặn xuất bản', () => {
    const r = checkStoryCompleteness(config(), { unsaved: false, hasProductImage: false });
    expect(r.stage.state).toBe('missing');
    expect(r.verdict).toBe('blocked');
  });

  it('ảnh tách nền trỏ tới ảnh sản phẩm đã xoá: thiếu và chặn, còn dựng được thì vẫn ok', () => {
    const gone = checkStoryCompleteness(config({ cutoutUrl: '/public-image/product/p1/3' }), { ...ctx, cutoutResolvable: false });
    expect(gone.stage).toMatchObject({ state: 'missing', source: 'custom' });
    expect(gone.verdict).toBe('blocked');
    expect(checkStoryCompleteness(config({ cutoutUrl: '/public-image/product/p1/0' }), { ...ctx, cutoutResolvable: true }).stage.state).toBe('ok');
    expect(checkStoryCompleteness(config(), { ...ctx, cutoutResolvable: false }).stage.state).toBe('warn');
  });

  it('khung cutout tự chọn dù chưa có cutoutUrl: ảnh đầu đặt thẳng, mục ok', () => {
    expect(checkStoryCompleteness(config({ imageFrame: 'cutout' }), ctx).stage.state).toBe('ok');
  });

  it('bước thiếu nội dung hoặc nguyên liệu bị đánh dấu cần xem, ghi rõ thiếu gì', () => {
    const c = config({ cutoutUrl: '/api/cut.png' });
    const asm = c.scenes.find((s) => s.kind === 'ingredient_assembly')!;
    if (asm.kind === 'ingredient_assembly') asm.steps[1] = { title: 'Hoà quyện', body: '', layers: [] };
    const r = checkStoryCompleteness(c, ctx);
    expect(r.chapters[1]).toMatchObject({ state: 'warn', note: 'Thiếu nội dung, nguyên liệu' });
    expect(r.verdict).toBe('review');
  });

  it('bước chưa có tiêu đề là thiếu và chặn', () => {
    const c = config({ cutoutUrl: '/api/cut.png' });
    const asm = c.scenes.find((s) => s.kind === 'ingredient_assembly')!;
    if (asm.kind === 'ingredient_assembly') asm.steps[0]!.title = ' ';
    const r = checkStoryCompleteness(c, ctx);
    expect(r.chapters[0]).toMatchObject({ state: 'missing', label: '01 · Chưa có tiêu đề' });
    expect(r.verdict).toBe('blocked');
  });

  it('không có bước nào: một dòng cảnh báo, không chặn', () => {
    const r = checkStoryCompleteness({ version: 1, enabled: true, cutoutUrl: '/api/cut.png', scenes: [{ kind: 'hud_callouts', points: [{ id: 'p', xPct: 1, yPct: 1, label: 'A', side: 'left' }], closing: 'x' }] }, ctx);
    expect(r.chapters).toEqual([expect.objectContaining({ key: 'steps', state: 'warn' })]);
    expect(r.verdict).toBe('review');
  });

  it('điểm chỉ: thiếu hoàn toàn hoặc thiếu câu kết đều cần xem', () => {
    const none = checkStoryCompleteness({ version: 1, enabled: true, cutoutUrl: '/api/cut.png', scenes: [] }, ctx);
    expect(none.hud).toMatchObject({ state: 'warn', note: 'Chưa có điểm chỉ nào' });
    const c = config({ cutoutUrl: '/api/cut.png' });
    const h = c.scenes.find((s) => s.kind === 'hud_callouts')!;
    if (h.kind === 'hud_callouts') h.closing = '';
    expect(checkStoryCompleteness(c, ctx).hud.note).toBe('1 điểm chỉ, thiếu câu kết');
  });

  describe('nguồn: tự động hay đã chỉnh tay', () => {
    it('chưa lưu cấu hình riêng thì mọi mục là tự động', () => {
      const r = checkStoryCompleteness(config(), { ...ctx, unsaved: true });
      expect([r.stage, ...r.chapters, r.hud].map((x) => x.source)).toEqual(['auto', 'auto', 'auto', 'auto']);
    });
    it('đã lưu: bước giữ nguyên so với bản tự sinh vẫn là tự động, bước đã sửa là chỉnh tay', () => {
      const baseline = config();
      const saved = config();
      const asm = saved.scenes.find((s) => s.kind === 'ingredient_assembly')!;
      if (asm.kind === 'ingredient_assembly') asm.steps[1]!.body = 'Câu do admin viết.';
      const r = checkStoryCompleteness(saved, { ...ctx, baseline });
      expect(r.chapters.map((c) => c.source)).toEqual(['auto', 'custom']);
      expect(r.hud.source).toBe('auto');
    });
    it('đã lưu, không có bản tự sinh: mọi bước là chỉnh tay', () => {
      const r = checkStoryCompleteness(config(), { ...ctx, baseline: null });
      expect(r.chapters.every((c) => c.source === 'custom')).toBe(true);
    });
    it('ảnh tách nền do admin chọn luôn tính là chỉnh tay', () => {
      expect(checkStoryCompleteness(config({ cutoutUrl: '/api/cut.png' }), { ...ctx, unsaved: true }).stage.source).toBe('custom');
    });
  });

  describe('độ tương phản chữ trên nền cảnh', () => {
    it('chỉ đo các màu nền đang dùng, luôn có nền cát mặc định', () => {
      const r = checkStoryCompleteness(config({}, ['leaf', 'leaf', 'sky']), ctx);
      expect(r.contrast.map((c) => c.ambient).sort()).toEqual(['leaf', 'sand', 'sky']);
      expect(checkStoryCompleteness(config(), ctx).contrast.map((c) => c.ambient)).toEqual(['sand']);
    });
    it('cả năm nền hiện có đạt 4,5:1', () => {
      for (const a of Object.keys(STORY_AMBIENT_RGB) as StoryAmbient[]) {
        expect(contrastRatio(STORY_TEXT_RGB, STORY_AMBIENT_RGB[a]), a).toBeGreaterThanOrEqual(STORY_MIN_CONTRAST);
      }
    });
    it('nền tối làm chữ tối không đọc được: tính là trượt và chặn', () => {
      const orig = STORY_AMBIENT_RGB.rose;
      (STORY_AMBIENT_RGB as Record<string, readonly [number, number, number]>).rose = [0x22, 0x22, 0x22];
      try {
        const r = checkStoryCompleteness(config({ cutoutUrl: '/api/cut.png' }, ['rose']), ctx);
        expect(r.contrast.find((c) => c.ambient === 'rose')).toMatchObject({ pass: false });
        expect(r.verdict).toBe('blocked');
        expect(r.attention).toBe(1);
      } finally {
        (STORY_AMBIENT_RGB as Record<string, readonly [number, number, number]>).rose = orig;
      }
    });
    it('contrastRatio: đen/trắng 21:1, cùng màu 1:1', () => {
      expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
      expect(contrastRatio([10, 20, 30], [10, 20, 30])).toBe(1);
    });
  });
});
