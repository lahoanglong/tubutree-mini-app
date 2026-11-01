import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionTitle } from './section-title';

describe('SectionTitle', () => {
  it('mặc định Inter title-sm (token), nhãn nhỏ trong thẻ', () => {
    render(<SectionTitle data-testid="t">Thành phần</SectionTitle>);
    const h = screen.getByTestId('t');
    expect(h.tagName).toBe('H2');
    expect(h.style.fontWeight).toBe('var(--type-title-sm-weight)');
  });

  it('block: tiêu đề khối trong luồng mua là Inter 16/700, -0.01em (Q1)', () => {
    render(<SectionTitle block data-testid="t">Cam kết Tubu</SectionTitle>);
    const h = screen.getByTestId('t');
    expect(h.style.fontSize).toBe('var(--type-title-sm-size)');
    expect(h.style.fontWeight).toBe('700');
    expect(h.style.letterSpacing).toBe('-0.01em');
  });
});
