import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REFILL_LANDING_PATH } from '@tubutree/app-core/refill/refill-landing';

const mocks = vi.hoisted(() => ({
  on: true,
  landing: vi.fn(),
  edu: vi.fn(),
  go: vi.fn(),
  useSuggestion: vi.fn(),
}));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true }) }));
vi.mock('@tubutree/app-core/refill/refill-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refillFirstOn: () => mocks.on,
}));
vi.mock('@tubutree/app-core/refill/refill-landing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refillLandingQuery: () => ({ queryKey: ['refill-landing-test'], queryFn: mocks.landing }),
  refillCartEducation: mocks.edu,
}));
vi.mock('../../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.go }));
vi.mock('../reorder/subscription-suggestion', () => ({
  useSubscriptionSuggestion: mocks.useSuggestion,
  SubscriptionSuggestionRow: (p: { suggestion: { variationId: string }; onAccept: (s: unknown) => void }) => (
    <button type="button" data-testid="subscription-suggestion" onClick={() => p.onAccept(p.suggestion)}>
      gợi ý {p.suggestion.variationId}
    </button>
  ),
  SuggestedSubscribe: (p: { suggestion: { variationId: string } }) => <div data-testid="suggested-subscribe">{p.suggestion.variationId}</div>,
}));

import { CartNudges } from './cart-nudges';

const LINES = [
  { slug: 'nuoc-rua-chen-fuwa3e-500ml', variationId: 'v-chai' },
  { slug: 'khan-tre', variationId: 'v-khan' },
];
const DTO = { enabled: true, pairs: [] };

function renderNudges(props: Partial<Parameters<typeof CartNudges>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CartNudges lines={LINES} {...props} />
    </QueryClientProvider>,
  );
}

describe('CartNudges (Mini): lời mời trang Refill + gợi ý giao định kỳ dưới các dòng giỏ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.on = true;
    mocks.landing.mockResolvedValue(DTO);
    mocks.edu.mockReturnValue(null);
    mocks.useSuggestion.mockReturnValue({ suggestion: null, discountFraction: 0 });
  });

  it('giỏ có chai ghép cặp: một hàng (cùng hàng lối vào Refill của hub) dẫn sang trang Tiết kiệm với Refill, câu do app-core dựng từ slug giỏ trừ chai đã có lối đổi', async () => {
    mocks.edu.mockImplementation((dto: unknown) => (dto ? { pct: 34, text: 'Đã có chai sẵn? Xem gói Refill tiết kiệm tới 34%' } : null));
    const swap = new Set(['khan-tre']);
    renderNudges({ swapSlugs: swap });
    const wrap = await screen.findByTestId('cart-refill-edu');
    const row = within(wrap).getByRole('button');
    expect(row).toHaveTextContent('Đã có chai sẵn? Xem gói Refill tiết kiệm tới 34%');
    expect(mocks.edu).toHaveBeenLastCalledWith(DTO, ['nuoc-rua-chen-fuwa3e-500ml', 'khan-tre'], swap);
    fireEvent.click(row);
    expect(mocks.go).toHaveBeenCalledWith(REFILL_LANDING_PATH.miniapp);
  });

  it('cờ Refill tắt: không hỏi trang Refill, không có hàng; không gợi ý thì không vẽ gì', async () => {
    mocks.on = false;
    const { container } = renderNudges();
    await waitFor(() => expect(mocks.useSuggestion).toHaveBeenCalled());
    expect(mocks.landing).not.toHaveBeenCalled();
    expect(mocks.edu).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('gợi ý giao định kỳ cho đúng các phân loại trong giỏ; chạm mở sheet Đặt định kỳ', async () => {
    mocks.useSuggestion.mockReturnValue({ suggestion: { variationId: 'v-chai', intervalWeeks: 6 }, discountFraction: 0.12 });
    renderNudges();
    expect(mocks.useSuggestion).toHaveBeenCalledWith(true, ['v-chai', 'v-khan']);
    fireEvent.click(await screen.findByTestId('subscription-suggestion'));
    expect(await screen.findByTestId('suggested-subscribe')).toHaveTextContent('v-chai');
  });
});
