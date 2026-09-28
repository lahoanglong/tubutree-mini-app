import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('renders width proportional to value/max', () => {
    render(<ProgressBar value={30} max={100} />);
    const fill = screen.getByTestId('progress-fill');
    expect(fill.style.width).toBe('30%');
  });
  it('clamps over-100% to 100', () => {
    render(<ProgressBar value={150} max={100} />);
    expect(screen.getByTestId('progress-fill').style.width).toBe('100%');
  });
});
