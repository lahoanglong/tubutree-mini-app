// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { SkipLink } from './skip-link';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('SkipLink', () => {
  it('đích không có tabindex lúc thường; kích hoạt thì nhận focus, mất focus thì bỏ tabindex', () => {
    mounted = render(
      <>
        <SkipLink />
        <div id="main-content" className="x">
          <p>Chữ</p>
        </div>
      </>,
    );
    const target = document.getElementById('main-content')!;
    expect(target.hasAttribute('tabindex')).toBe(false);
    click(mounted.container.querySelector('a'));
    expect(target.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(target);
    target.blur();
    expect(target.hasAttribute('tabindex')).toBe(false);
  });
});
