// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';
import { ScanCodeButton } from './recycle-scan';

// Nút "Quét mã của khách" ở quầy: quầy đang bận việc khác (tra mã, xác nhận, từ chối, trao quà) thì nút báo aria-disabled và
// KHÔNG mở camera, nhưng không `disabled` thật vì Chromium thả focus về body khi nút đang giữ focus bị khoá.

let mounted: Rendered[] = [];
const mount = (busy?: boolean) => {
  const r = render(<ScanCodeButton busy={busy} onCode={() => {}} onFail={() => {}} />);
  mounted.push(r);
  return r.container;
};
const scanBtn = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Quét mã của khách')) as HTMLButtonElement;
const dialog = () => document.querySelector('[role="dialog"]');

beforeEach(() => {
  // Camera không bao giờ trả lời: khung quét ở yên trạng thái mở, không rơi vào nhánh lỗi quyền camera.
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(() => {}) } });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  Reflect.deleteProperty(navigator, 'mediaDevices');
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ScanCodeButton: khoá khi quầy bận', () => {
  it('bận: aria-disabled, không disabled thật, bấm không mở khung quét', () => {
    const c = mount(true);
    const b = scanBtn(c);
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    click(b);
    expect(dialog()).toBeNull();
  });

  it('rảnh: không có aria-disabled, bấm mở khung quét; nút đủ vùng chạm 44px', () => {
    const c = mount(false);
    const b = scanBtn(c);
    expect(b.hasAttribute('aria-disabled')).toBe(false);
    expect(smallTouchTargets(c)).toEqual([]);
    click(b);
    expect(dialog()).not.toBeNull();
  });
});
