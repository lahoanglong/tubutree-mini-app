// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Truck } from 'lucide-react';
import { mount } from './harness';

vi.mock('next/link', () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a>,
}));

import { SectionHeader } from './section-header';
import { Section } from './section';

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

describe('SectionHeader (web)', () => {
  it('tiêu đề là h2 (đổi được sang h3), Inter 700, một dòng cắt "…"', () => {
    const m = mount(<SectionHeader title="Bán chạy nhất" />);
    const h = q('h2')!;
    expect(h.textContent).toBe('Bán chạy nhất');
    expect(h.style.fontWeight).toBe('700');
    expect(h.style.letterSpacing).toBe('-0.01em');
    expect(h.style.textOverflow).toBe('ellipsis');
    m.unmount();
    mount(<SectionHeader title="Bán chạy nhất" as="h3" />);
    expect(q('h3')).not.toBeNull();
  });

  it('hàng cao --section-header-h, id đặt lên tiêu đề', () => {
    mount(<SectionHeader title="Giờ vàng" id="flash-title" />);
    expect(q('[data-testid="section-header"]')!.style.minHeight).toBe('var(--section-header-h)');
    expect(q('h2')!.id).toBe('flash-title');
  });

  it('icon theo tên hoặc LucideIcon, luôn aria-hidden; không icon thì không svg', () => {
    const a = mount(<SectionHeader title="A" icon="zap" />);
    expect(q('svg')!.getAttribute('aria-hidden')).toBe('true');
    a.unmount();
    const b = mount(<SectionHeader title="A" icon={Truck} />);
    expect(q('svg')!.getAttribute('aria-hidden')).toBe('true');
    b.unmount();
    mount(<SectionHeader title="A" />);
    expect(q('svg')).toBeNull();
  });

  it('tone="promo": chữ --color-promo-fg; trailing và subtitle hiện', () => {
    mount(<SectionHeader title="Giờ vàng" tone="promo" trailing={<span data-testid="tr">x</span>} subtitle="Theo lượt bán" />);
    expect(q('h2')!.style.color).toBe('var(--color-promo-fg)');
    expect(q('[data-testid="tr"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Theo lượt bán');
  });

  it('không action thì không liên kết; có action thì liên kết tên "Xem tất cả {title}" tới đúng đường dẫn', () => {
    const a = mount(<SectionHeader title="Giờ vàng" />);
    expect(q('a')).toBeNull();
    a.unmount();
    mount(<SectionHeader title="Giờ vàng" action={{ to: '/gio-vang' }} />);
    const link = q('a')!;
    expect(link.getAttribute('href')).toBe('/gio-vang');
    expect(link.getAttribute('aria-label')).toBe('Xem tất cả Giờ vàng');
    expect(link.textContent).toBe('Xem tất cả');
    expect(link.style.minHeight).toBe('44px');
    expect(link.style.flex).toBe('0 0 auto');
  });

  it('action.label tuỳ chọn: chữ nhìn thấy nằm trong tên đọc', () => {
    mount(<SectionHeader title="Mã giảm giá" action={{ label: 'Tất cả 12 mã', to: '/ma-giam-gia' }} />);
    expect(q('a')!.getAttribute('aria-label')).toBe('Tất cả 12 mã Mã giảm giá');
  });
});

describe('Section (web)', () => {
  it('<section id> cách khối trên --space-block; spacing="section" cách --space-section; label thành aria-label', () => {
    const a = mount(<Section id="best" label="Bán chạy nhất">x</Section>);
    const el = q('section#best')!;
    expect(el.style.marginTop).toBe('var(--space-block)');
    expect(el.getAttribute('aria-label')).toBe('Bán chạy nhất');
    a.unmount();
    mount(<Section id="y" spacing="section">x</Section>);
    expect(q('section#y')!.style.marginTop).toBe('var(--space-section)');
    expect(q('section#y')!.hasAttribute('aria-label')).toBe(false);
  });
});
