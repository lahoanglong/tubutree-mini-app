import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useSubscribeCandidate } from './order-success';
import type { OrderDTO } from '@tubutree/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function Probe({ order }: { order: OrderDTO }) {
  return <div data-testid="c">{useSubscribeCandidate(order) ? 'co' : 'khong'}</div>;
}

describe('OrderSuccess khi giao định kỳ tạm ẩn ở Mini App (R-30)', () => {
  it('không tìm ứng viên định kỳ', () => {
    const order = { items: [{ productSlug: 'gao', variationId: 'v', quantity: 1, productName: 'Gạo' }] } as unknown as OrderDTO;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe order={order} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('c').textContent).toBe('khong');
  });
});
