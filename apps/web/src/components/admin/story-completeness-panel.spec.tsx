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
});

describe('StoryCompletenessPanel — dòng trạng thái xuất bản', () => {
  const cases = [
    ['live', 'Đang bật công khai'],
    ['draft', 'Bản nháp chờ duyệt'],
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

  it('ba chip có chữ khác nhau để không nhầm bản nháp với bản đang chạy', () => {
    const texts = cases.map(([state]) => {
      const r = render(<StoryCompletenessPanel result={result()} publication={state} />);
      mounted.push(r);
      return r.container.querySelector('[data-testid="story-status"]')!.textContent;
    });
    expect(new Set(texts).size).toBe(3);
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
