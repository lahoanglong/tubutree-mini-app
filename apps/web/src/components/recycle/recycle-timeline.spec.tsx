// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { RecycleTimeline } from './recycle-timeline';

// Chép ý timeline.spec.tsx (Mini App): chữ bước hiện tại dưới bản gọn, dòng phụ theo bước ở bản đầy đủ.
const STEPS = ['Tạo yêu cầu', 'Vận chuyển', 'Kho đếm', 'Cộng điểm'];

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r.container;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('RecycleTimeline', () => {
  it('compact: chữ bước hiện tại hiện ra dưới các chấm, ẩn với trình đọc màn hình', () => {
    const c = mount(<RecycleTimeline steps={STEPS} current={1} compact />);
    expect(c.querySelector('div[aria-hidden]')?.textContent).toBe('Vận chuyển');
    expect(c.querySelectorAll('li')[1]?.textContent).toContain('Vận chuyển, đang diễn ra');
  });

  it('compact: mọi bước xong thì chữ là bước cuối', () => {
    const c = mount(<RecycleTimeline steps={STEPS} current={4} compact />);
    expect(c.querySelector('div[aria-hidden]')?.textContent).toBe('Cộng điểm');
  });

  it('không compact: không có chữ phụ dưới danh sách', () => {
    const c = mount(<RecycleTimeline steps={STEPS} current={1} />);
    expect(c.querySelector('div[aria-hidden]')).toBeNull();
  });

  it('hints: dòng phụ dưới đúng bước ở bản đầy đủ, không hiện ở compact', () => {
    const c = mount(<RecycleTimeline steps={STEPS} current={1} hints={{ 1: <span>Ghi chú bước 2</span> }} />);
    expect(c.querySelectorAll('li')[1]?.textContent).toContain('Ghi chú bước 2');
    expect(c.querySelectorAll('li')[0]?.textContent).not.toContain('Ghi chú');
    const d = mount(<RecycleTimeline steps={STEPS} current={1} compact hints={{ 1: <span>Ghi chú bước 2</span> }} />);
    expect(d.textContent).not.toContain('Ghi chú bước 2');
  });

  it('hints: bước có dòng phụ canh trên cùng với tên bước, bước không có dòng phụ vẫn canh giữa', () => {
    const c = mount(<RecycleTimeline steps={STEPS} current={1} hints={{ 1: <span>Ghi chú bước 2</span> }} />);
    const items = c.querySelectorAll('li');
    expect(items[1]?.className).toContain('items-start');
    expect(items[0]?.className).toContain('items-center');
  });
});
