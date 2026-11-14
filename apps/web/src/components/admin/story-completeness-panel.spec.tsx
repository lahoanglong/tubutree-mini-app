// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { ProductStoryConfig } from '@tubutree/shared-types';
import { checkStoryCompleteness } from '@tubutree/app-core/commerce/story-completeness';
import { render, type Rendered } from '@/test-utils/dom';
import { StoryCompletenessPanel, storyPublication } from './story-completeness-panel';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

const cfg = (enabled: boolean): ProductStoryConfig => ({ version: 1, enabled, scenes: [] });
const result = () => checkStoryCompleteness(cfg(true), { unsaved: false, baseline: null, hasProductImage: true, cutoutResolvable: true });

describe('storyPublication', () => {
  it('không có cấu hình riêng (null hoặc undefined) là "none"', () => {
    expect(storyPublication(null)).toBe('none');
    expect(storyPublication(undefined)).toBe('none');
  });

  it('có cấu hình và bật là "live"; có cấu hình mà tắt là "draft"', () => {
    expect(storyPublication(cfg(true))).toBe('live');
    expect(storyPublication(cfg(false))).toBe('draft');
  });

  it('chưa lưu cấu hình riêng nhưng kịch bản mẫu hoặc tự sinh đang chạy cho khách là "runtime", không phải "none"', () => {
    expect(storyPublication(null, cfg(true))).toBe('runtime');
    expect(storyPublication(undefined, cfg(true))).toBe('runtime');
    expect(storyPublication(null, cfg(false))).toBe('none');
    expect(storyPublication(null, null)).toBe('none');
  });

  it('cấu hình đã lưu thắng kịch bản dự phòng', () => {
    expect(storyPublication(cfg(false), cfg(true))).toBe('draft');
    expect(storyPublication(cfg(true), null)).toBe('live');
  });
});

describe('StoryCompletenessPanel — dòng trạng thái xuất bản', () => {
  const cases = [
    ['live', 'Đang bật công khai'],
    ['draft', 'Bản nháp chờ duyệt'],
    ['runtime', 'Đang hiện kịch bản mẫu'],
    ['none', 'Chưa có kịch bản'],
  ] as const;

  for (const [state, text] of cases) {
    it(`"${state}" hiện chip "${text}" kèm lời giải thích cho người duyệt`, () => {
      const r = render(<StoryCompletenessPanel result={result()} publication={state} />);
      mounted.push(r);
      const chip = document.querySelector('[data-testid="story-status"]')!;
      expect(chip.getAttribute('data-status')).toBe(state);
      expect(chip.textContent).toContain(text);
      expect(document.querySelector('[data-testid="story-status-note"]')?.textContent?.length).toBeGreaterThan(20);
    });
  }

  it('bốn chip có chữ khác nhau để không nhầm bản nháp với bản đang chạy', () => {
    const texts = cases.map(([state]) => {
      const r = render(<StoryCompletenessPanel result={result()} publication={state} />);
      mounted.push(r);
      return r.container.querySelector('[data-testid="story-status"]')!.textContent;
    });
    expect(new Set(texts).size).toBe(4);
  });

  it('"runtime" nói khách đang thấy kịch bản mẫu và lưu cấu hình riêng sẽ thay nó; "none" nói khách không thấy gì', () => {
    const rt = render(<StoryCompletenessPanel result={result()} publication="runtime" />);
    mounted.push(rt);
    const note = rt.container.querySelector('[data-testid="story-status-note"]')?.textContent ?? '';
    expect(note).toContain('khách đang thấy');
    expect(note).toContain('thay');
    const none = render(<StoryCompletenessPanel result={result()} publication="none" />);
    mounted.push(none);
    expect(none.container.querySelector('[data-testid="story-status-note"]')?.textContent).toContain('khách chưa thấy');
  });

  it('bản nháp nói rõ khách chưa thấy; đang bật nói rõ khách đang thấy', () => {
    const draft = render(<StoryCompletenessPanel result={result()} publication="draft" />);
    mounted.push(draft);
    expect(draft.container.querySelector('[data-testid="story-status-note"]')?.textContent).toContain('chưa hiển thị cho khách');
    const live = render(<StoryCompletenessPanel result={result()} publication="live" />);
    mounted.push(live);
    expect(live.container.querySelector('[data-testid="story-status-note"]')?.textContent).toContain('khách đang thấy');
  });
});
