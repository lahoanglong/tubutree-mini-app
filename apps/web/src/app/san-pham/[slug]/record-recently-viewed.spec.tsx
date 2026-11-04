// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, type Rendered } from '@/test-utils/dom';
import { readRecentlyViewed } from '@/lib/recently-viewed';
import { RecordRecentlyViewed } from './record-recently-viewed';

let mounted: Rendered | null = null;
beforeEach(() => localStorage.clear());
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('RecordRecentlyViewed (PDP web)', () => {
  it('ghi một mục sau khi mount: slug, tên, thumbnail; không vẽ gì', () => {
    mounted = render(<RecordRecentlyViewed slug="sp-a" name="Sản phẩm A" thumbnail="https://cdn.example/a.jpg" images={['https://cdn.example/x.jpg']} />);
    expect(mounted.container.innerHTML).toBe('');
    const [it] = readRecentlyViewed();
    expect(it).toMatchObject({ slug: 'sp-a', name: 'Sản phẩm A', thumbnail: 'https://cdn.example/a.jpg' });
  });

  it('thiếu thumbnail thì lấy ảnh đầu của images, không có gì thì null (như Mini App)', () => {
    mounted = render(<RecordRecentlyViewed slug="sp-b" name="B" thumbnail={null} images={['https://cdn.example/first.jpg']} />);
    expect(readRecentlyViewed()[0]!.thumbnail).toBe('https://cdn.example/first.jpg');
    mounted.unmount();
    mounted = render(<RecordRecentlyViewed slug="sp-c" name="C" thumbnail={null} images={[]} />);
    expect(readRecentlyViewed()[0]!.thumbnail).toBeNull();
  });

  it('chỉ ghi một lần cho mỗi slug dù render lại; slug khác thì ghi thêm', () => {
    mounted = render(<RecordRecentlyViewed slug="sp-a" name="A" thumbnail={null} images={[]} />);
    const t1 = readRecentlyViewed()[0]!.viewedAt;
    mounted.root.render(<RecordRecentlyViewed slug="sp-a" name="A" thumbnail={null} images={[]} />);
    expect(readRecentlyViewed()).toHaveLength(1);
    expect(readRecentlyViewed()[0]!.viewedAt).toBe(t1);
  });

  it('không ghi gì ở HTML server (không localStorage, không vẽ)', () => {
    expect(renderToString(<RecordRecentlyViewed slug="sp-d" name="D" thumbnail={null} images={[]} />)).toBe('');
    expect(readRecentlyViewed()).toEqual([]);
  });
});
