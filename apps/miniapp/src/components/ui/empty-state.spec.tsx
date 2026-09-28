import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmptyState, ErrorState } from './empty-state';

describe('EmptyState', () => {
  it('CTA loading state actually shows the spinner (regression test for the disabled+loading bug)', () => {
    render(<EmptyState art="box" heading="Chưa có đơn" ctaLabel="Mua ngay" onCta={() => {}} ctaLoading />);
    const btn = screen.getByText('Mua ngay').closest('.zaui-btn') as HTMLElement;
    expect(btn.className).toContain('loading');
    expect(btn.getAttribute('disabled')).toBeNull(); // NOT disabled — old bug set disabled={ctaLoading} too
  });

  it('variant="inline" uses tighter padding than the default "page"', () => {
    const { rerender } = render(<EmptyState art="leaf" heading="x" variant="inline" />);
    expect(screen.getByText('x').closest('.tubu-rise')).toHaveStyle({ padding: '16px' });
    rerender(<EmptyState art="leaf" heading="x" />);
    expect(screen.getByText('x').closest('.tubu-rise')).toHaveStyle({ padding: '40px 32px' });
  });
});

describe('ErrorState', () => {
  it('retry button text-on-secondary-bg is the new forest tone, not the old orange', () => {
    render(<ErrorState message="Lỗi mạng" onRetry={() => {}} />);
    // style is applied to the outer .zaui-btn root, not the inner text node — same convention
    // as button.spec.tsx's assertions on rendered zmp-ui Button output.
    const btn = screen.getByText('Thử lại').closest('.zaui-btn') as HTMLElement;
    expect(btn.style.color).toBe('var(--color-action-secondary-fg)');
  });
});
