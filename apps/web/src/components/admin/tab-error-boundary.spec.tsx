// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { TabErrorBoundary } from './tab-error-boundary';

let mounted: Rendered[] = [];
afterEach(() => {
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
});
