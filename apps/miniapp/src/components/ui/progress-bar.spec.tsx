import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('renders width proportional to value/max', () => {
    render(<ProgressBar value={30} max={100} ariaLabel="Tiến độ thử" />);
    const fill = screen.getByTestId('progress-fill');
    expect(fill.style.width).toBe('30%');
  });
  it('clamps over-100% to 100', () => {
    render(<ProgressBar value={150} max={100} ariaLabel="Tiến độ thử" />);
    expect(screen.getByTestId('progress-fill').style.width).toBe('100%');
  });
  it('luôn là progressbar có tên đọc được: từ ariaLabel hoặc từ label in ra', () => {
    const { rerender } = render(<ProgressBar value={1} max={4} ariaLabel="Bước 1 trên 4" />);
    expect(screen.getByRole('progressbar', { name: 'Bước 1 trên 4' })).toHaveAttribute('aria-valuenow', '1');
    rerender(<ProgressBar value={2} max={4} label="Tiến độ nhiệm vụ" />);
    expect(screen.getByRole('progressbar', { name: 'Tiến độ nhiệm vụ' })).toBeInTheDocument();
  });
});
