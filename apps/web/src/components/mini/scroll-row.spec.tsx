// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from './harness';
import { ScrollRow } from './scroll-row';

const region = (container: HTMLElement) => container.querySelector('[role="region"]') as HTMLElement;

describe('ScrollRow', () => {
  it('vùng cuộn là khung định vị (position:relative): chữ đọc ẩn position:absolute của PriceTag ở trong không thoát ra làm tràn trang', () => {
    const r = mount(<ScrollRow label="Kệ"><i /></ScrollRow>);
    expect(region(r.container).style.position).toBe('relative');
  });

  it('style của nơi gọi vẫn thắng (đặt sau)', () => {
    const r = mount(<ScrollRow label="Kệ" style={{ position: 'sticky', gap: 8 }}><i /></ScrollRow>);
    expect(region(r.container).style.position).toBe('sticky');
    expect(region(r.container).style.gap).toBe('8px');
  });

  it('có nút ‹ › thì khung ngoài relative còn vùng cuộn vẫn relative', () => {
    const r = mount(<ScrollRow label="Kệ" arrows><i /></ScrollRow>);
    expect(region(r.container).style.position).toBe('relative');
  });
});
