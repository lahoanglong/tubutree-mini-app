// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Check } from 'lucide-react';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { Heading, Text } from './text';
import { Icon } from './icon';
import { IconButton } from './icon-button';
import { SectionTitle } from './section-title';
import { KeyValueRow } from './key-value-row';

describe('Text / Heading', () => {
  it('Text mặc định là span body-md màu chính, cỡ chữ lấy từ biến type-*', () => {
    const el = mount(<Text>Xin chào</Text>).container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('SPAN');
    expect(el.textContent).toBe('Xin chào');
    expect(el.style.fontSize).toBe('var(--type-body-md-size)');
    expect(el.style.color).toBe('var(--color-text-primary)');
  });

  it('Text nhận variant, tone, as và data-testid', () => {
    const el = mount(<Text variant="caption" tone="danger" as="div" data-testid="t">Lỗi</Text>).container.querySelector('[data-testid="t"]') as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el.style.fontSize).toBe('var(--type-caption-size)');
    expect(el.style.color).toBe('var(--color-text-danger)');
  });

  it('Heading render h1-h3 thật theo bậc, font serif, và nhận id', () => {
    const c = mount(
      <>
        <Heading variant="title-lg">A</Heading>
        <Heading variant="title-md" id="x">B</Heading>
        <Heading variant="title-sm">C</Heading>
      </>,
    ).container;
    expect(c.querySelector('h1')!.textContent).toBe('A');
    expect(c.querySelector('h2')!.id).toBe('x');
    expect(c.querySelector('h3')!.textContent).toBe('C');
    expect((c.querySelector('h1') as HTMLElement).style.fontFamily).toBe('var(--font-display)');
  });
});

describe('Icon / IconButton', () => {
  it('Icon cố định nét 1,75 và 3 cỡ chuẩn', () => {
    const svg = mount(<Icon icon={Check} size="lg" tone="brand" />).container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('stroke')).toBe('var(--color-text-brand)');
  });

  it('IconButton là button có nhãn, vùng chạm tối thiểu 44px, bấm gọi onPress', () => {
    const onPress = vi.fn();
    const btn = mount(<IconButton icon={Check} label="Đóng" onPress={onPress} />).container.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('Đóng');
    expect(btn.style.minWidth).toBe('44px');
    expect(btn.style.minHeight).toBe('44px');
    click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('IconButton badge là chấm trang trí ẩn khỏi trình đọc màn hình', () => {
    const c = mount(<IconButton icon={Check} label="Thông báo" badge />).container;
    expect(c.querySelector('[data-testid="icon-button-badge"]')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('SectionTitle / KeyValueRow', () => {
  it('SectionTitle là h2 Inter title-sm', () => {
    const h = mount(<SectionTitle>Gợi ý</SectionTitle>).container.querySelector('h2')!;
    expect(h.style.fontSize).toBe('var(--type-title-sm-size)');
    expect(h.style.fontFamily).toBe('var(--font-ui)');
  });

  it('KeyValueRow hiện nhãn và giá trị; emphasis đậm hơn và to hơn', () => {
    const plain = mount(<KeyValueRow label="Phí ship" value="15.000đ" />).container;
    expect(plain.textContent).toBe('Phí ship15.000đ');
    const strong = mount(<KeyValueRow label="Tổng" value="100.000đ" emphasis tone="danger" />).container;
    const value = strong.querySelectorAll('span')[1] as HTMLElement;
    expect(value.style.fontWeight).toBe('700');
    expect(value.style.fontSize).toBe('var(--type-title-sm-size)');
    expect(value.style.color).toBe('var(--color-text-danger)');
  });
});
