// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./core-http', () => ({ coreHttp: { get: mocks.get } }));

import { SUGGEST_DEBOUNCE_MS, SUGGEST_MIN_CHARS, useSuggest } from './use-suggest';

const P = { slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65000 };

let result: ReturnType<typeof useSuggest>;
let setDraft: (d: string) => void;
function Probe({ initial }: { initial: string }) {
  const [draft, set] = useState(initial);
  setDraft = set;
  result = useSuggest(draft);
  return null;
}
let mounted: Rendered | null = null;
const show = (draft: string) => {
  if (!mounted) mounted = render(<Probe initial={draft} />);
  else act(() => setDraft(draft));
};
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  mocks.get.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('useSuggest', () => {
  it('hằng số: debounce 250ms, từ 2 ký tự', () => {
    expect(SUGGEST_DEBOUNCE_MS).toBe(250);
    expect(SUGGEST_MIN_CHARS).toBe(2);
  });

  it('gõ liên tục chỉ gọi một lần GET /search/suggest với từ khoá cuối (đã trim) sau khi ngừng gõ', async () => {
    mocks.get.mockResolvedValue([P]);
    show('n');
    show('nu');
    await advance(SUGGEST_DEBOUNCE_MS - 50);
    show('nuo ');
    await advance(SUGGEST_DEBOUNCE_MS - 1);
    expect(mocks.get).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/search/suggest', { query: { q: 'nuo' } });
    await advance(0);
    expect(result.products).toEqual([P]);
  });

  it('dưới 2 ký tự: không gọi API, products rỗng', async () => {
    show('  n  ');
    await advance(SUGGEST_DEBOUNCE_MS + 500);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(result.products).toEqual([]);
  });

  it('xoá xuống dưới 2 ký tự: ẩn gợi ý ngay, không chờ debounce', async () => {
    mocks.get.mockResolvedValue([P]);
    show('nuoc');
    await advance(SUGGEST_DEBOUNCE_MS);
    expect(result.products).toEqual([P]);
    show('n');
    expect(result.products).toEqual([]);
  });

  it('lỗi mạng: im lặng, không có gợi ý', async () => {
    mocks.get.mockRejectedValue(new Error('down'));
    show('nuoc');
    await advance(SUGGEST_DEBOUNCE_MS + 100);
    expect(result.products).toEqual([]);
  });
});
