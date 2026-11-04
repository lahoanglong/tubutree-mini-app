// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, type Rendered } from '@/test-utils/dom';
import { readRecentlyViewed } from '@/lib/recently-viewed';
import { RecordRecentlyViewed } from './record-recently-viewed';

let mounted: Rendered | null = null;
const client = new QueryClient();
// Cùng kiểu phần tử gốc như `render`, để render lại là cập nhật chứ không phải gắn mới (ref giữ nguyên).
const rerender = (ui: ReactElement) => act(() => mounted!.root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>));
beforeEach(() => localStorage.clear());
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('RecordRecentlyViewed (PDP web)', () => {
  it('ghi một mục sau khi mount: slug, tên, thumbnail; không vẽ gì', () => {
    mounted = render(<RecordRecentlyViewed slug="sp-a" name="Sản phẩm A" thumbnail="https://cdn.example/a.jpg" />);
    expect(mounted.container.innerHTML).toBe('');
    const [it] = readRecentlyViewed();
    expect(it).toMatchObject({ slug: 'sp-a', name: 'Sản phẩm A', thumbnail: 'https://cdn.example/a.jpg' });
  });

  it('chỉ ghi một lần cho mỗi slug dù render lại với tên/ảnh khác (viewedAt không đổi); slug khác thì ghi thêm', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    mounted = render(<RecordRecentlyViewed slug="sp-a" name="A" thumbnail={null} />, client);
    const t1 = readRecentlyViewed()[0]!.viewedAt;
    vi.setSystemTime(1_700_000_005_000);
    rerender(<RecordRecentlyViewed slug="sp-a" name="A đổi tên" thumbnail="https://cdn.example/moi.jpg" />);
    expect(readRecentlyViewed()).toHaveLength(1);
    expect(readRecentlyViewed()[0]).toMatchObject({ viewedAt: t1, name: 'A' });
    rerender(<RecordRecentlyViewed slug="sp-b" name="B" thumbnail={null} />);
    expect(readRecentlyViewed().map((i) => i.slug)).toEqual(['sp-b', 'sp-a']);
    vi.useRealTimers();
  });

  it('không ghi gì ở HTML server (không localStorage, không vẽ)', () => {
    expect(renderToString(<RecordRecentlyViewed slug="sp-d" name="D" thumbnail={null} />)).toBe('');
    expect(readRecentlyViewed()).toEqual([]);
  });
});
