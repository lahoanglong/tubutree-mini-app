// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { TabErrorBoundary } from './tab-error-boundary';

const reloadPage = vi.hoisted(() => vi.fn());
vi.mock('./chunk-load-error', async (importOriginal) => ({ ...(await importOriginal<typeof import('./chunk-load-error')>()), reloadPage }));

let mounted: Rendered[] = [];
afterEach(() => {
  reloadPage.mockReset();
  try {
    sessionStorage.clear();
  } catch {
    // jsdom luôn có sessionStorage
  }
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new TypeError('rows.find is not a function');
  return <p>Nội dung ổn</p>;
}

describe('TabErrorBoundary', () => {
  it('lỗi trong tab: hiện thông báo, Thử lại dựng lại, Về Việc cần xử lý gọi onGoHome', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    const onGoHome = vi.fn();
    const r = render(<TabErrorBoundary tabLabel="Đổi rác" onGoHome={onGoHome}><Bomb /></TabErrorBoundary>);
    mounted.push(r);
    const c = r.container;
    expect(c.textContent).toContain('Mục này đang gặp lỗi');
    click(byText(c, 'button', 'Về Việc cần xử lý'));
    expect(onGoHome).toHaveBeenCalled();
    shouldThrow = false;
    click(byText(c, 'button', 'Thử lại'));
    expect(c.textContent).toContain('Nội dung ổn');
  });

  it('đổi key (đổi tab) thì bỏ trạng thái lỗi', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    function Host() {
      const [k, setK] = useState('a');
      return (
        <>
          <button type="button" onClick={() => { shouldThrow = false; setK('b'); }}>đổi</button>
          <TabErrorBoundary key={k} tabLabel="x" onGoHome={() => {}}><Bomb /></TabErrorBoundary>
        </>
      );
    }
    const r = render(<Host />);
    mounted.push(r);
    expect(r.container.textContent).toContain('Mục này đang gặp lỗi');
    click(byText(r.container, 'button', 'đổi'));
    expect(r.container.textContent).toContain('Nội dung ổn');
  });

  it('không truyền onGoHome thì ẩn nút Về Việc cần xử lý', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    const r = render(<TabErrorBoundary tabLabel="Việc"><Bomb /></TabErrorBoundary>);
    mounted.push(r);
    expect(byText(r.container, 'button', 'Về Việc cần xử lý')).toBeFalsy();
    expect(byText(r.container, 'button', 'Thử lại')).toBeTruthy();
  });
});

describe('TabErrorBoundary: chunk tab cũ sau khi deploy', () => {
  let chunkError: Error | null = null;
  function ChunkBomb() {
    if (chunkError) throw chunkError;
    return <p>Nội dung ổn</p>;
  }
  const mountChunk = (err: Error) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    chunkError = err;
    const r = render(<TabErrorBoundary tabLabel="Đổi rác" onGoHome={() => {}}><ChunkBomb /></TabErrorBoundary>);
    mounted.push(r);
    return r;
  };
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });

  it('ChunkLoadError: tự tải lại trang đúng một lần, không hiện câu "Mục này đang gặp lỗi"', () => {
    const r = mountChunk(named('ChunkLoadError', 'Loading chunk 123 failed.'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(r.container.textContent).not.toContain('Mục này đang gặp lỗi');
    expect(r.container.textContent).toContain('Trang quản trị vừa được cập nhật. Tải lại trang để dùng tiếp.');
  });

  it.each([
    'Failed to fetch dynamically imported module: https://x/_next/static/chunks/1.js',
    'Importing a module script failed.',
    'Loading chunk 9 failed.',
  ])('nhận ra lỗi tải chunk theo message: %s', (message) => {
    mountChunk(new Error(message));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('lần hai trong 60 giây: không tự tải lại nữa, hiện nút Tải lại trang và bấm thì gọi reload', () => {
    mountChunk(named('ChunkLoadError', 'x'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    const r2 = mountChunk(named('ChunkLoadError', 'x'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    click(byText(r2.container, 'button', 'Tải lại trang'));
    expect(reloadPage).toHaveBeenCalledTimes(2);
    expect(byText(r2.container, 'button', 'Thử lại')).toBeNull();
  });

  it('lỗi thường: không tải lại trang, giữ câu và nút Thử lại như cũ', () => {
    const r = mountChunk(new TypeError('rows.find is not a function'));
    expect(reloadPage).not.toHaveBeenCalled();
    expect(r.container.textContent).toContain('Mục này đang gặp lỗi');
    expect(byText(r.container, 'button', 'Thử lại')).not.toBeNull();
  });
});
