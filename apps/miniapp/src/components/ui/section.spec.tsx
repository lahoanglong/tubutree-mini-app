import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Section } from './section';

const el = (c: HTMLElement) => c.querySelector('section')!;

describe('Section', () => {
  it('là <section id>, mặc định cách khối trên --space-block', () => {
    const { container } = render(<Section id="best"><p>nội dung</p></Section>);
    expect(el(container)).toHaveAttribute('id', 'best');
    expect(el(container).style.marginTop).toBe('var(--space-block)');
    expect(el(container)).toHaveTextContent('nội dung');
  });

  it('spacing="section" cách --space-section', () => {
    const { container } = render(<Section id="x" spacing="section">a</Section>);
    expect(el(container).style.marginTop).toBe('var(--space-section)');
  });

  it('label thành aria-label; không có label thì không có aria-label', () => {
    const { container, rerender } = render(<Section id="x" label="Bán chạy nhất">a</Section>);
    expect(el(container)).toHaveAttribute('aria-label', 'Bán chạy nhất');
    rerender(<Section id="x">a</Section>);
    expect(el(container).hasAttribute('aria-label')).toBe(false);
  });

  it('con không bị Section tự thêm đệm trên/dưới', () => {
    const { container } = render(<Section id="x">a</Section>);
    expect(el(container).style.paddingTop).toBe('');
    expect(el(container).style.paddingBottom).toBe('');
  });
});
