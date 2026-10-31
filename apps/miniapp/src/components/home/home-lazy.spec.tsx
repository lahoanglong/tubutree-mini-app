import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./home-below', () => new Promise(() => undefined));

import { HomeNewCustomerGift } from './home-lazy';
import { NewCustomerGiftSkeleton } from './new-customer-gift-skeleton';

describe('home-lazy — chỗ giữ khi chunk chưa về', () => {
  it('dải quà khách mới giữ chỗ bằng đúng khung chờ của dải thật (cùng DOM, cùng chiều cao)', () => {
    const slot = render(<HomeNewCustomerGift />).container.innerHTML;
    const real = render(<NewCustomerGiftSkeleton />).container.innerHTML;
    expect(slot).not.toBe('');
    expect(slot).toBe(real);
  });
});
