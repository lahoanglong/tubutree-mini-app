import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PriceTag, Money, Points, Xu } from './price-tag';

describe('PriceTag', () => {
  it('renders the formatted VND price, no compare-at shown when not on sale', () => {
    render(<PriceTag value={42000} />);
    expect(screen.getByText('42.000đ')).toBeInTheDocument();
    expect(screen.queryByText('52.000đ')).not.toBeInTheDocument();
  });
  it('shows a struck-through compareAt when it is greater than value', () => {
    render(<PriceTag value={42000} compareAt={52000} />);
    expect(screen.getByText('52.000đ')).toBeInTheDocument();
  });
  it('flash price wins and gets the flash tone', () => {
    render(<PriceTag value={52000} flash={{ price: 39000 }} />);
    expect(screen.getByText('39.000đ')).toBeInTheDocument();
  });
  it('tabular-nums applied so digits align in lists', () => {
    render(<PriceTag value={1000} data-testid="p" />);
    expect(screen.getByText('1.000đ').style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('Money/Points/Xu', () => {
  it('Money renders a formatted amount', () => {
    render(<Money amount={100000} />);
    expect(screen.getByText('100.000đ')).toBeInTheDocument();
  });
  it('Points renders with "điểm" suffix', () => {
    render(<Points value={250} />);
    expect(screen.getByText(/250.*điểm/)).toBeInTheDocument();
  });
  it('Xu renders with the xu unit', () => {
    render(<Xu value={500} />);
    expect(screen.getByText(/500.*xu/)).toBeInTheDocument();
  });
});
