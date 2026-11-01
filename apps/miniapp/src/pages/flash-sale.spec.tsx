import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const m = {
    navigate: vi.fn(),
    openSnackbar: vi.fn(),
    login: vi.fn(),
    status: 'authenticated' as string,
    listeners: new Set<() => void>(),
    /** Đổi trạng thái phiên và báo cho các trang đang render (cửa hàng giả phản ứng như zustand thật). */
    setStatus: (_status: string): void => undefined,
    http: vi.fn(),
    fetchUpcoming: vi.fn(),
    setReminder: vi.fn(),
    cancelReminder: vi.fn(),
    addToCart: vi.fn(),
    fetchCategories: vi.fn(),
  };
  m.setStatus = (status) => {
    m.status = status;
    m.listeners.forEach((l) => l());
  };
  return m;
});
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/flash-sale', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/core-http', () => ({ coreHttp: { get: (...a: unknown[]) => mocks.http(...a) } }));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchUpcomingFlashSales: mocks.fetchUpcoming,
  setFlashReminder: mocks.setReminder,
  cancelFlashReminder: mocks.cancelReminder,
  addToCart: mocks.addToCart,
  fetchCategories: mocks.fetchCategories,
}));
vi.mock('../store/auth', async () => {
  const { useSyncExternalStore } = await import('react');
  const state = () => ({ status: mocks.status, login: mocks.login });
  const subscribe = (l: () => void) => {
    mocks.listeners.add(l);
    return () => void mocks.listeners.delete(l);
  };
  const useStore = (sel?: (s: unknown) => unknown) => {
    useSyncExternalStore(subscribe, () => mocks.status);
    return sel ? sel(state()) : state();
  };
  return { useAuthStore: Object.assign(useStore, { getState: () => state() }) };
});
vi.mock('../components/ui/countdown', () => ({
  Countdown: ({ endAt, kind = 'ends', mode, onEnd }: { endAt: string; kind?: string; mode: string; onEnd?: () => void }) => (
    <button type="button" data-testid={`countdown-${kind}-${mode}`} data-end={endAt} onClick={() => onEnd?.()}>
      đồng hồ
    </button>
  ),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import FlashSalePage from './flash-sale';

const NOW = new Date('2026-11-01T06:00:00Z'); // 13:00 giờ VN
const iso = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const slot = (id: string, startH: number, endH: number, status: 'LIVE' | 'UPCOMING' | 'ENDED', itemCount = 3) => ({
  id,
  title: id,
  startAt: iso(startH),
  endAt: iso(endH),
  status,
  itemCount,
});
const S12 = slot('s12', -1, 1, 'LIVE');
const S20 = slot('s20', 7, 9, 'UPCOMING');

const item = (id: string, over: Record<string, unknown> = {}) => ({
  itemId: id,
  variationId: `v-${id}`,
  variationName: null,
  productId: `p-${id}`,
  productSlug: `sp-${id}`,
  productName: `Sản phẩm ${id}`,
  thumbnail: null,
  categoryIds: ['food'],
  flashPrice: 50_000,
  retailPrice: 100_000,
  salePrice: null,
  soldCount: 2,
  quota: 10,
  soldOut: false,
  perUserLimit: 5,
  ...over,
});

interface Route {
  slots?: unknown;
  items?: Record<string, unknown>;
}
/** Máy chủ giả: `serverNow` luôn là giờ (đã giả) của lúc trả lời, như máy chủ thật; nếu đứng yên thì mỗi lần tải lại sẽ kéo đồng hồ về quá khứ. */
function serve({ slots = { serverNow: '', slots: [S12, S20] }, items = {} }: Route) {
  const stamp = (body: unknown) => ({ ...(body as object), serverNow: new Date().toISOString() });
  mocks.http.mockImplementation(async (path: string) => {
    if (path === '/flash-sales/slots') {
      if (slots instanceof Error) throw slots;
      return stamp(slots);
    }
    const id = /\/flash-sales\/slots\/([^/]+)\/items/.exec(path)?.[1];
    const body = id ? items[id] : undefined;
    if (body instanceof Error) throw body;
    if (body === undefined) throw new Error(`không có giả cho ${path}`);
    return stamp(body);
  });
}
const itemsOf = (s: typeof S12, list: unknown[]) => ({ serverNow: NOW.toISOString(), slot: s, items: list });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FlashSalePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.status = 'authenticated';
  mocks.fetchUpcoming.mockResolvedValue([]);
  mocks.fetchCategories.mockResolvedValue([
    { id: 'food', slug: 'food', name: 'Thực phẩm', image: null, productCount: 9, children: [] },
    { id: 'home', slug: 'home', name: 'Gia dụng', image: null, productCount: 5, children: [] },
  ]);
  mocks.setReminder.mockResolvedValue({});
  mocks.cancelReminder.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe('Trang Giờ vàng: khung giờ và danh sách', () => {
  it('có tiêu đề, dải tab khung giờ, chọn sẵn khung đang diễn ra và hiện món của nó', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a'), item('b')]) } });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Giờ vàng' })).toBeInTheDocument();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['12:00, đang diễn ra', '20:00, sắp diễn ra']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mua ngay Sản phẩm b' })).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
  });

  it('dải tab và đồng hồ nằm trong một khối dính, danh sách thì ở ngoài khối đó (cuộn danh sách dài không mất tab và đồng hồ)', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]), s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    const sticky = await screen.findByTestId('flash-sticky');
    expect(sticky.style.position).toBe('sticky');
    // Trang không dùng lớp `page`: `top` đo từ mép trên vùng cuộn là vùng an toàn, lớp `sticky-below-back` đẩy xuống dưới thanh nút lùi (56px) khi có nút lùi.
    expect(sticky.style.top).toBe('var(--safe-top)');
    expect(sticky.className).toContain('sticky-below-back');
    expect(within(sticky).getByRole('tablist')).toBeInTheDocument();
    expect(within(sticky).getByTestId('countdown-ends-clock')).toBeInTheDocument();
    const buy = await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' });
    expect(sticky.contains(buy)).toBe(false);
    expect(screen.getByRole('tabpanel').contains(sticky)).toBe(false);
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    const starts = await screen.findByTestId('countdown-starts-text');
    expect(sticky.contains(starts)).toBe(true);
    expect(screen.getByTestId('flash-sticky')).toBe(sticky);
  });

  it('đồng hồ khung đang diễn ra có nhãn "Kết thúc sau", không lặp "Đang diễn ra" của tab', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]) } });
    renderPage();
    const sticky = await screen.findByTestId('flash-sticky');
    expect(within(sticky).getByText('Kết thúc sau')).toBeInTheDocument();
    expect(within(sticky).getAllByText('Đang diễn ra')).toHaveLength(1);
    expect(within(sticky).getByText('Kết thúc sau').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('khung đang diễn ra có đồng hồ HH:MM:SS tới giờ kết thúc; khung sắp diễn ra có đếm ngược tới giờ bắt đầu', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]), s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    const clock = await screen.findByTestId('countdown-ends-clock');
    expect(clock).toHaveAttribute('data-end', S12.endAt);
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    const starts = await screen.findByTestId('countdown-starts-text');
    expect(starts).toHaveAttribute('data-end', S20.startAt);
    expect(screen.queryByTestId('countdown-ends-clock')).not.toBeInTheDocument();
  });

  it('chuyển sang khung 20:00: món của khung đó có Nhắc tôi, không còn Mua ngay', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]), s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' });
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    expect(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mua ngay/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('khung chỉ có khung sắp diễn ra: chọn sẵn khung sớm nhất', async () => {
    serve({ slots: { serverNow: '', slots: [S20] }, items: { s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' })).toBeInTheDocument();
  });

  it('món hết suất xuống cuối danh sách, vẫn hiện', async () => {
    serve({ items: { s12: itemsOf(S12, [item('sold', { soldOut: true, soldCount: 10 }), item('ok1'), item('ok2')]) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm ok1' });
    const names = screen.getAllByRole('button', { name: /^Mua ngay / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Mua ngay Sản phẩm ok1', 'Mua ngay Sản phẩm ok2', 'Mua ngay Sản phẩm sold']);
    expect(screen.getByRole('button', { name: 'Mua ngay Sản phẩm sold' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Trang Giờ vàng: chip danh mục', () => {
  const MANY = [
    ...Array.from({ length: 7 }, (_, i) => item(`f${i}`, { categoryIds: ['food'] })),
    ...Array.from({ length: 5 }, (_, i) => item(`h${i}`, { categoryIds: ['home'] })),
  ];

  it('dưới 12 món không có chip', async () => {
    serve({ items: { s12: itemsOf(S12, MANY.slice(0, 11)) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm f0' });
    expect(screen.queryByRole('group', { name: 'Danh mục' })).not.toBeInTheDocument();
  });

  it('từ 12 món: chip kèm số món, chọn chip lọc danh sách, "Tất cả" bỏ lọc', async () => {
    serve({ items: { s12: itemsOf(S12, MANY) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm f0' });
    const group = screen.getByRole('group', { name: 'Danh mục' });
    const chips = within(group).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Tất cả', 'Thực phẩm(7)', 'Gia dụng(5)']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: /Gia dụng/ }));
    expect(screen.queryByRole('button', { name: 'Mua ngay Sản phẩm f0' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Mua ngay / })).toHaveLength(5);
    expect(within(group).getByRole('button', { name: /Gia dụng/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'Tất cả' }));
    expect(screen.getAllByRole('button', { name: /^Mua ngay / })).toHaveLength(12);
  });

  it('đổi khung thì bỏ lọc danh mục của khung trước', async () => {
    serve({ items: { s12: itemsOf(S12, MANY), s20: itemsOf(S20, MANY) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm f0' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Danh mục' })).getByRole('button', { name: /Gia dụng/ }));
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm f0' });
    expect(screen.getAllByRole('button', { name: /^Nhắc tôi / })).toHaveLength(12);
  });
});

describe('Trang Giờ vàng: khách chưa đăng nhập', () => {
  beforeEach(() => {
    mocks.status = 'idle';
  });

  it('xem được trang, không gọi nhắc/giỏ nào; danh sách nhắc của khách chưa chờ phiên thì không hỏi', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]) } });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' })).toBeInTheDocument();
    expect(mocks.setReminder).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('bấm Nhắc tôi mở đăng nhập, không gọi API nhắc', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]), s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' });
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.setReminder).not.toHaveBeenCalled();
  });

  describe('đăng nhập xong thì "Nhắc tôi" đã bấm tự được đặt', () => {
    const UPCOMING_C = { itemId: 'c', variationId: 'v-c', productSlug: 'sp-c', productName: 'Sản phẩm c', thumbnail: null, flashPrice: 1, retailPrice: 2, startAt: S20.startAt };

    async function pressRemindAsGuest() {
      serve({ items: { s12: itemsOf(S12, [item('a')]), s20: itemsOf(S20, [item('c')]) } });
      renderPage();
      await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' });
      fireEvent.click(screen.getAllByRole('tab')[1]!);
      fireEvent.click(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' }));
    }
    /** Đăng nhập chạy như cửa hàng thật: 'loading' rồi kết thúc ở `final`. */
    const loginEndsAt = (final: string) =>
      mocks.login.mockImplementation(async () => {
        act(() => mocks.setStatus('loading'));
        await Promise.resolve();
        await act(async () => mocks.setStatus(final));
      });

    it('món chưa nhắc: đặt nhắc đúng suất một lần, báo giờ nhắc, không bấm lần hai và không huỷ', async () => {
      mocks.fetchUpcoming.mockResolvedValue([{ ...UPCOMING_C, reminded: false }]);
      loginEndsAt('authenticated');
      await pressRemindAsGuest();
      await waitFor(() => expect(mocks.setReminder).toHaveBeenCalledWith('c'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Tubu sẽ nhắc bạn lúc 20:00' })));
      expect(mocks.setReminder).toHaveBeenCalledTimes(1);
      expect(mocks.cancelReminder).not.toHaveBeenCalled();
    });

    it('món đã được nhắc từ trước (máy khác): không gọi gì, vì bấm bật lại sẽ huỷ nhắc', async () => {
      mocks.fetchUpcoming.mockResolvedValue([{ ...UPCOMING_C, reminded: true }]);
      loginEndsAt('authenticated');
      await pressRemindAsGuest();
      await waitFor(() => expect(mocks.fetchUpcoming).toHaveBeenCalled());
      expect(await screen.findByRole('button', { name: 'Đã đặt nhắc Sản phẩm c, bỏ nhắc' })).toHaveAttribute('aria-pressed', 'true');
      expect(mocks.setReminder).not.toHaveBeenCalled();
      expect(mocks.cancelReminder).not.toHaveBeenCalled();
    });

    it('đăng nhập không thành (phiên về khách): bỏ ý định, lần đăng nhập sau không tự đặt nhắc', async () => {
      mocks.fetchUpcoming.mockResolvedValue([{ ...UPCOMING_C, reminded: false }]);
      loginEndsAt('idle');
      await pressRemindAsGuest();
      await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
      await act(async () => mocks.setStatus('idle'));
      act(() => mocks.setStatus('authenticated'));
      await waitFor(() => expect(mocks.fetchUpcoming).toHaveBeenCalled());
      await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' });
      expect(mocks.setReminder).not.toHaveBeenCalled();
    });
  });

  it('bấm Mua ngay mở đăng nhập, không thêm giỏ', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]) } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('phiên đang khôi phục (loading): bấm Mua ngay hay Nhắc tôi không mở thêm một lần đăng nhập song song', async () => {
    mocks.status = 'loading';
    serve({ items: { s12: itemsOf(S12, [item('a')]), s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' }));
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' }));
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(mocks.setReminder).not.toHaveBeenCalled();
  });
});

describe('Trang Giờ vàng: Nhắc tôi khi đã đăng nhập', () => {
  const UPCOMING = [{ itemId: 'c', variationId: 'v-c', productSlug: 'sp-c', productName: 'Sản phẩm c', thumbnail: null, flashPrice: 1, retailPrice: 2, startAt: S20.startAt, reminded: false }];

  // Máy chủ giả có nhớ: đặt nhắc xong thì lần hỏi lại trả đúng trạng thái mới (không thì lần tải lại sau mutation làm nút nhảy ngược).
  async function openEvening(initiallyReminded: boolean) {
    let state = initiallyReminded;
    mocks.fetchUpcoming.mockImplementation(async () => [{ ...UPCOMING[0], reminded: state }]);
    mocks.setReminder.mockImplementation(async () => {
      state = true;
      return {};
    });
    mocks.cancelReminder.mockImplementation(async () => {
      state = false;
      return {};
    });
    serve({ items: { s12: itemsOf(S12, [item('a')]), s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' });
    fireEvent.click(screen.getAllByRole('tab')[1]!);
  }

  it('bấm Nhắc tôi gọi đặt nhắc đúng suất, đổi sang "Đã đặt nhắc" ngay và báo giờ nhắc', async () => {
    await openEvening(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' }));
    await waitFor(() => expect(mocks.setReminder).toHaveBeenCalledWith('c'));
    expect(await screen.findByRole('button', { name: 'Đã đặt nhắc Sản phẩm c, bỏ nhắc' })).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Tubu sẽ nhắc bạn lúc 20:00' }));
  });

  it('món đã đặt nhắc từ trước hiện "Đã đặt nhắc"; bấm lần nữa bỏ nhắc', async () => {
    await openEvening(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Đã đặt nhắc Sản phẩm c, bỏ nhắc' }));
    await waitFor(() => expect(mocks.cancelReminder).toHaveBeenCalledWith('c'));
    expect(mocks.setReminder).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã bỏ nhắc' }));
  });

  it('đặt nhắc lỗi: trả nút về "Nhắc tôi" và báo lỗi', async () => {
    await openEvening(false);
    mocks.setReminder.mockRejectedValue(new Error('boom'));
    fireEvent.click(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Trang Giờ vàng: Mua ngay', () => {
  it('thêm đúng một sản phẩm của phân loại có suất (nguồn buy_now) rồi sang thanh toán đúng dòng đó', async () => {
    mocks.addToCart.mockResolvedValue({ items: [{ id: 'line-x', variationId: 'v-a', quantity: 1 }, { id: 'line-y', variationId: 'v-other', quantity: 1 }] });
    serve({ items: { s12: itemsOf(S12, [item('a')]) } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v-a', 1, 'buy_now'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/checkout', { state: { itemIds: ['line-x'] } }));
  });

  it('thêm giỏ lỗi (hết suất giữa chừng): báo lỗi, ở lại trang, không sang thanh toán', async () => {
    mocks.addToCart.mockRejectedValue(new Error('Hết hàng'));
    serve({ items: { s12: itemsOf(S12, [item('a')]) } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('món hết suất: bấm Mua ngay không làm gì', async () => {
    serve({ items: { s12: itemsOf(S12, [item('sold', { soldOut: true, soldCount: 10 })]) } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mua ngay Sản phẩm sold' }));
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });
});

describe('Trang Giờ vàng: khung hết giờ khi khách đang xem', () => {
  it('đồng hồ về 0: báo "Khung 12:00 đã kết thúc" một lần ở vùng status rồi chuyển sang khung kế', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]), s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' });
    // Giờ trôi qua mốc kết thúc của khung 12:00.
    vi.setSystemTime(new Date(S12.endAt).getTime() + 1_000);
    await act(async () => {
      fireEvent.click(screen.getByTestId('countdown-ends-clock'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Khung 12:00 đã kết thúc');
    expect(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: /Mua ngay/ })).not.toBeInTheDocument();
  });

  it('vùng status luôn có trong cây (để trình đọc màn hình đọc được khi chữ xuất hiện), rỗng lúc chưa có gì', async () => {
    serve({ items: { s12: itemsOf(S12, [item('a')]) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('khung cuối hết giờ: báo đã kết thúc và không còn tab nào', async () => {
    serve({ slots: { serverNow: '', slots: [S12] }, items: { s12: itemsOf(S12, [item('a')]) } });
    renderPage();
    await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' });
    vi.setSystemTime(new Date(S12.endAt).getTime() + 1_000);
    await act(async () => {
      fireEvent.click(screen.getByTestId('countdown-ends-clock'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Khung 12:00 đã kết thúc');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByText('Chưa có Giờ vàng lúc này')).toBeInTheDocument();
  });

  it('máy chủ báo khung đang xem đã kết thúc (đồng hồ máy lệch): hiện thông báo đã kết thúc kèm lối sang khung kế', async () => {
    const ended = { ...S12, status: 'ENDED' as const, itemCount: 0 };
    serve({ items: { s12: { serverNow: NOW.toISOString(), slot: ended, items: [] }, s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    expect(await screen.findByText('Khung giờ này đã kết thúc')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem khung giờ tiếp theo' }));
    expect(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' })).toBeInTheDocument();
  });
});

describe('Trang Giờ vàng: trạng thái tải, rỗng, lỗi', () => {
  it('đang tải: khung chờ, không có tab', async () => {
    mocks.http.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByTestId('flash-slots-loading')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('không có khung nào: trạng thái rỗng, nút dẫn tới danh mục sản phẩm', async () => {
    serve({ slots: { serverNow: '', slots: [] } });
    renderPage();
    expect(await screen.findByText('Chưa có Giờ vàng lúc này')).toBeInTheDocument();
    expect(screen.getByText('Khung giờ tiếp theo sẽ hiện ở đây.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem sản phẩm khác' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('API khung giờ lỗi: báo lỗi và Thử lại tải lại', async () => {
    serve({ slots: new Error('500'), items: {} });
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    serve({ items: { s12: itemsOf(S12, [item('a')]) } });
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Mua ngay Sản phẩm a' })).toBeInTheDocument();
  });

  it('khung có nhưng món lỗi: lỗi nằm trong vùng danh sách, dải tab vẫn dùng được', async () => {
    serve({ items: { s12: new Error('500'), s20: itemsOf(S20, [item('c')]) } });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    expect(await screen.findByRole('button', { name: 'Nhắc tôi Sản phẩm c' })).toBeInTheDocument();
  });

  it('khung không còn món nào bán được thì báo rỗng, không để vùng trắng', async () => {
    serve({ items: { s12: itemsOf(S12, []) } });
    renderPage();
    expect(await screen.findByText('Chưa có sản phẩm trong khung giờ này')).toBeInTheDocument();
  });
});
