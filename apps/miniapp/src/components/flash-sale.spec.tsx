import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import type * as ZmpUi from 'zmp-ui';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchUpcoming: vi.fn(),
  setReminder: vi.fn(),
  cancelReminder: vi.fn(),
  navigate: vi.fn(),
  status: 'guest',
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../services/shop-api', () => ({
  fetchUpcomingFlashSales: mocks.fetchUpcoming,
  setFlashReminder: mocks.setReminder,
  cancelFlashReminder: mocks.cancelReminder,
}));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { FLASH_HINT_KEY, FLASH_NEXT_SLOT_HEIGHT, FLASH_SKELETON_HEIGHT } from '@tubutree/app-core/home-layout';
import { FlashSale, UpcomingFlashSales, type FlashSaleProps } from './flash-sale';

function renderFlash(props: Partial<FlashSaleProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (p: Partial<FlashSaleProps>) => (
    <QueryClientProvider client={qc}>
      <FlashSale items={[]} loading={false} {...p} />
    </QueryClientProvider>
  );
  const utils = render(tree(props));
  return { qc, ...utils, update: (p: Partial<FlashSaleProps>) => utils.rerender(tree(p)) };
}

const HOUR = 3_600_000;
const ITEM = {
  itemId: 'i1', productId: 'p1', productSlug: 'p1', productName: 'Nước rửa chén', thumbnail: null, variationId: 'v1',
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + HOUR).toISOString(),
};
const many = (n: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => ({ ...ITEM, itemId: `i${i}`, productSlug: `p${i}`, productName: `Sản phẩm ${i}`, ...over }));
const upcomingAt = (hours: number, n = 1) =>
  Array.from({ length: n }, (_, i) => ({
    itemId: `u${i}`, variationId: 'v', productSlug: `u${i}`, productName: `Sắp ${i}`, thumbnail: null, flashPrice: 1, retailPrice: 2,
    startAt: new Date(Date.now() + hours * HOUR).toISOString(), reminded: false,
  }));

describe('FlashSale — khối Giờ vàng gọn của Trang chủ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.status = 'guest';
    mocks.fetchUpcoming.mockResolvedValue([]);
  });

  it('3 suất: vùng "Giờ vàng", tiêu đề h2, MỘT đồng hồ có ô số, mỗi thẻ một thanh đã bán, nút "Xem tất cả Giờ vàng"', async () => {
    renderFlash({ items: many(3) });
    const region = await screen.findByRole('region', { name: 'Giờ vàng' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Giờ vàng' })).toBeInTheDocument();
    const timers = within(region).getAllByRole('timer');
    expect(timers).toHaveLength(1);
    expect(timers[0]!.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(within(region).getAllByTestId('flash-sold-bar')).toHaveLength(3);
  });

  it('nút "Xem tất cả Giờ vàng" điều hướng tới trang Giờ vàng', async () => {
    renderFlash({ items: many(3) });
    const region = await screen.findByRole('region', { name: 'Giờ vàng' });
    fireEvent.click(within(region).getByRole('button', { name: 'Xem tất cả Giờ vàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/flash-sale');
  });

  it('dưới 3 suất: không vẽ gì (kệ chưa đủ dày), 9 suất: chỉ 8 thẻ', async () => {
    const { container, update } = renderFlash({ items: many(2) });
    await waitFor(() => expect(mocks.fetchUpcoming).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    update({ items: many(9) });
    expect(await screen.findAllByTestId('flash-sold-bar')).toHaveLength(8);
  });

  it('icon nét, không emoji: tiêu đề có svg', async () => {
    renderFlash({ items: many(3) });
    const title = await screen.findByRole('heading', { name: 'Giờ vàng' });
    expect(title.parentElement?.parentElement?.querySelector('svg')).not.toBeNull();
  });

  it('lần mở đầu chưa từng thấy Giờ vàng: đang tải thì không vẽ gì; lần mở trước có Giờ vàng: giữ chỗ bằng khung chờ', async () => {
    const first = renderFlash({ loading: true });
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    localStorage.setItem(FLASH_HINT_KEY, '1');
    renderFlash({ loading: true });
    expect(screen.getByTestId('flash-sale-loading')).toBeInTheDocument();
  });

  it('khung chờ cao đúng khối thật: bằng FLASH_SKELETON_HEIGHT, cao thêm dòng suất kế khi lần mở trước có dòng đó', () => {
    const heightOf = () => (screen.getByTestId('flash-sale-loading').firstElementChild as HTMLElement).style.height;
    localStorage.setItem(FLASH_HINT_KEY, '1');
    const a = renderFlash({ loading: true });
    expect(heightOf()).toBe(`${FLASH_SKELETON_HEIGHT}px`);
    a.unmount();
    localStorage.setItem(FLASH_HINT_KEY, '2');
    renderFlash({ loading: true });
    expect(heightOf()).toBe(`${FLASH_SKELETON_HEIGHT + FLASH_NEXT_SLOT_HEIGHT}px`);
  });

  it('ghi nhớ kèm dòng suất kế khi khối hiện có dòng đó', async () => {
    mocks.fetchUpcoming.mockResolvedValue(upcomingAt(2));
    renderFlash({ items: many(3) });
    await screen.findAllByTestId('flash-sold-bar');
    await waitFor(() => expect(localStorage.getItem(FLASH_HINT_KEY)).toBe('2'));
  });

  it('nhớ lại có hay không Giờ vàng cho lần mở sau, chỉ ghi khi đã tải xong', async () => {
    const { update, unmount } = renderFlash({ loading: true });
    expect(localStorage.getItem(FLASH_HINT_KEY)).toBeNull();
    update({ loading: false, items: many(3) });
    await waitFor(() => expect(localStorage.getItem(FLASH_HINT_KEY)).toBe('1'));
    unmount();
    renderFlash({ items: [] });
    await waitFor(() => expect(localStorage.getItem(FLASH_HINT_KEY)).toBe('0'));
  });

  it('tải lỗi và chưa có suất nào: khối có tiêu đề, thông báo và "Thử lại" gọi onRetry', async () => {
    const onRetry = vi.fn();
    renderFlash({ error: new Error('boom'), onRetry });
    const region = await screen.findByRole('region', { name: 'Giờ vàng' });
    expect(within(region).getByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Thử lại Giờ vàng' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('còn dữ liệu cũ mà lần tải lại lỗi: vẫn hiện suất đang có, không thay bằng khối lỗi', async () => {
    renderFlash({ items: many(3), error: new Error('boom') });
    expect(await screen.findAllByTestId('flash-sold-bar')).toHaveLength(3);
    expect(screen.queryByText('Có chút trục trặc, thử lại nhé')).toBeNull();
  });

  it('chờ suất sắp mở tải xong rồi mới hiện khối, để dòng "suất kế" không đẩy khối dưới xuống giữa chừng', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.fetchUpcoming.mockReturnValue(new Promise((r) => { release = r; }));
    const { container } = renderFlash({ items: many(3) });
    await waitFor(() => expect(mocks.fetchUpcoming).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    await act(async () => {
      release(upcomingAt(2));
    });
    expect(await screen.findAllByTestId('flash-sold-bar')).toHaveLength(3);
  });

  it('phiên còn đang khôi phục: chưa hỏi suất sắp mở (chưa biết có dùng được khối gộp của khách đã đăng nhập không), xong phiên mới hỏi', async () => {
    mocks.status = 'loading';
    const { update } = renderFlash({ items: many(3) });
    await act(async () => {});
    expect(mocks.fetchUpcoming).not.toHaveBeenCalled();
    mocks.status = 'guest';
    update({ items: many(3) });
    await waitFor(() => expect(mocks.fetchUpcoming).toHaveBeenCalledTimes(1));
  });

  it('tải suất sắp mở lỗi: khối vẫn hiện, không có dòng suất kế', async () => {
    mocks.fetchUpcoming.mockRejectedValue(new Error('x'));
    renderFlash({ items: many(3) });
    expect(await screen.findAllByTestId('flash-sold-bar')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /sắp mở/ })).toBeNull();
  });
});

describe('FlashSale — dòng suất kế tiếp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.status = 'guest';
  });

  it('suất kế mở sau 3 giờ: dòng có "Nhắc tôi" cao 44, bấm tới trang Giờ vàng (khách chưa đăng nhập vẫn thấy)', async () => {
    mocks.fetchUpcoming.mockResolvedValue(upcomingAt(3, 2));
    renderFlash({ items: many(3) });
    // Dòng chờ fetchUpcoming rồi mới vẽ; CI tải nặng đã vượt mức chờ 1s mặc định một lần (run 41282913325).
    const line = await screen.findByRole('button', { name: /^\d{2}:\d{2} · 2 món sắp mở/ }, { timeout: 5000 });
    expect(line).toHaveTextContent('Nhắc tôi');
    expect(line).toHaveStyle({ minHeight: '44px' });
    fireEvent.click(line);
    expect(mocks.navigate).toHaveBeenCalledWith('/flash-sale');
  });

  it('suất kế mở sau 8 giờ: không có dòng', async () => {
    mocks.fetchUpcoming.mockResolvedValue(upcomingAt(8));
    renderFlash({ items: many(3) });
    expect(await screen.findAllByTestId('flash-sold-bar')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /sắp mở/ })).toBeNull();
  });
});

describe('FlashSale — hết giờ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.status = 'guest';
    mocks.fetchUpcoming.mockResolvedValue([]);
  });

  it('suất sớm nhất đã quá giờ mà danh sách chưa tải lại: đồng hồ và thẻ chỉ tính các suất còn giờ', async () => {
    renderFlash({
      items: [
        ...many(1, { itemId: 'old', productName: 'Hết giờ', endAt: new Date(Date.now() - 60_000).toISOString() }),
        ...many(3, { endAt: new Date(Date.now() + 2 * HOUR - 30_000).toISOString() }),
      ],
    });
    expect(await screen.findByRole('timer')).toHaveTextContent(/^0[12]:\d{2}:\d{2}$/);
    expect(screen.queryByText('Hết giờ')).toBeNull();
    expect(screen.getAllByTestId('flash-sold-bar')).toHaveLength(3);
  });

  it('đang xem mà suất sớm nhất hết giờ: đồng hồ chuyển sang suất kế; hết mọi suất thì khối ẩn, không hiện 00:00:00', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(new Date('2026-10-17T08:00:00.000Z'));
      const items = [
        ...many(3, { endAt: '2026-10-17T08:01:00.000Z' }),
        ...many(3, { endAt: '2026-10-17T10:00:00.000Z' }).map((x, i) => ({ ...x, itemId: `late${i}`, productSlug: `late${i}` })),
      ];
      const { container } = renderFlash({ items });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(screen.getByRole('timer').textContent).toMatch(/^(00:59|01:00)$/);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      expect(screen.getByRole('timer')).toHaveTextContent(/^01:5\d:\d{2}$/);
      expect(screen.getAllByTestId('flash-sold-bar')).toHaveLength(3);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * HOUR);
      });
      expect(container).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it('đồng hồ về 0: gọi onExpire đúng một lần để chỗ nối dữ liệu tính lại chống trùng (món hết giờ trở lại kệ khác)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(new Date('2026-10-17T08:00:00.000Z'));
      const onExpire = vi.fn();
      renderFlash({ items: many(3, { endAt: '2026-10-17T08:01:00.000Z' }), onExpire });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(onExpire).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FlashSale — thẻ giờ vàng (C-076 di cư DS v2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.status = 'guest';
    mocks.fetchUpcoming.mockResolvedValue([]);
  });
  // Hai thẻ còn lại đắt hơn và đã bán nhiều hơn để các giá trị của thẻ đầu không trùng với thẻ khác.
  const three = (first: Record<string, unknown>) => [{ ...ITEM, ...first }, ...many(2, { itemId: 'x' }).map((x, i) => ({ ...x, itemId: `x${i}`, productSlug: `x${i}`, productName: `Khác ${i}`, flashPrice: 45000, retailPrice: 50000, soldCount: 5 }))];

  it('thẻ hiện -% / giá giờ vàng / giá gạch và thanh đã bán có chữ', async () => {
    renderFlash({ items: three({}) });
    expect(await screen.findByText('Nước rửa chén')).toBeInTheDocument();
    expect(screen.getByText('-20%')).toBeInTheDocument();
    expect(screen.getByText('80.000đ')).toBeInTheDocument();
    expect(screen.getByText('100.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.getByText('Đã bán 20%')).toBeInTheDocument();
  });

  it('chưa bán suất nào vẫn có thanh với chữ "Vừa mở bán"; bán hết suất ghi "Đã bán hết", không in 150%', async () => {
    renderFlash({ items: [...three({ soldCount: 0 }).slice(0, 2), { ...ITEM, itemId: 'over', productSlug: 'over', productName: 'Hết suất', quota: 10, soldCount: 15 }] });
    expect(await screen.findByText('Vừa mở bán')).toBeInTheDocument();
    expect(screen.getByText('Đã bán hết')).toBeInTheDocument();
    expect(screen.queryByText(/150%/)).toBeNull();
  });

  it('sản phẩm nhiều phân loại: tên phân loại ở dòng riêng; một phân loại thì không có dòng đó', async () => {
    renderFlash({ items: three({ variationName: '500g' }) });
    expect(await screen.findByText('500g')).toBeInTheDocument();
    expect(screen.queryByText('Mặc định')).toBeNull();
  });

  it('chạm thẻ → sang SP kèm đúng phân loại đang giờ vàng', async () => {
    renderFlash({ items: three({}) });
    fireEvent.click(await screen.findByText('Nước rửa chén'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/p1', { state: { variationId: 'v1' } });
  });

  it('thẻ dùng được bằng bàn phím: Tab tới nút tên, Enter và Space đều mở sản phẩm (D8-8)', async () => {
    renderFlash({ items: three({}) });
    const card = await screen.findByRole('button', { name: /Nước rửa chén/ });
    const user = userEvent.setup();
    card.focus();
    await user.keyboard('{Enter}');
    expect(mocks.navigate).toHaveBeenLastCalledWith('/product/p1', { state: { variationId: 'v1' } });
    await user.keyboard(' ');
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
  });
});

describe('FlashSale — giá hiển thị khớp giá thật (BUYERMINI-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.status = 'guest';
    mocks.fetchUpcoming.mockResolvedValue([]);
  });
  const others = many(2, {}).map((x, i) => ({ ...x, itemId: `o${i}`, productSlug: `o${i}`, productName: `Khác ${i}`, flashPrice: 60000, retailPrice: 60000 }));

  it('flashPrice cao hơn giá đang bán → hiện giá đang bán, không nhãn % âm, không gạch giá', async () => {
    renderFlash({ items: [{ ...ITEM, flashPrice: 85000, retailPrice: 79000 }, ...others] });
    expect(await screen.findByText('Nước rửa chén')).toBeInTheDocument();
    expect(screen.queryByText(/^-\d+%$/)).toBeNull();
    expect(screen.queryByText('85.000đ')).toBeNull();
    expect(screen.getAllByText('79.000đ').length).toBeGreaterThan(0);
  });

  it('có salePrice → % giảm và giá gạch tính theo giá đang bán', async () => {
    renderFlash({ items: [{ ...ITEM, flashPrice: 60000, retailPrice: 100000, salePrice: 75000 }, ...others] });
    expect(await screen.findByText('-20%')).toBeInTheDocument();
    expect(screen.getByText('75.000đ')).toHaveStyle({ textDecoration: 'line-through' });
  });
});

describe('UpcomingFlashSales — mốc bắt đầu', () => {
  const UPCOMING = {
    itemId: 'u1', productId: 'p1', productSlug: 'p1', productName: 'Nước rửa chén', thumbnail: null, variationId: 'v1',
    retailPrice: 100000, flashPrice: 80000, reminded: false, startAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  };
  const renderUpcoming = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <UpcomingFlashSales />
      </QueryClientProvider>,
    );
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
  });

  it('còn thời gian: "Sau 1 giờ 59 phút" theo luật chữ (không "1h 59m"), ngắn để vừa thẻ 112px, và nút nhắc', async () => {
    mocks.fetchUpcoming.mockResolvedValue([UPCOMING]);
    renderUpcoming();
    expect(await screen.findByText(/^Sau [12] giờ \d{2} phút$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nhắc tôi/ })).toBeInTheDocument();
  });

  it('đã tới giờ bắt đầu: không hiện "Bắt đầu sau 0h 00m", đổi thành "Đang diễn ra" và bỏ nút nhắc', async () => {
    mocks.fetchUpcoming.mockResolvedValue([{ ...UPCOMING, startAt: new Date(Date.now() - 60_000).toISOString() }]);
    renderUpcoming();
    expect(await screen.findByText('Đang diễn ra')).toBeInTheDocument();
    expect(screen.queryByText(/Bắt đầu sau/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Nhắc tôi|Đã đặt nhắc/ })).toBeNull();
  });
});

describe('UpcomingFlashSales (C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  const UP = {
    itemId: 'u1', productSlug: 'nrc', productName: 'Nước rửa chén', thumbnail: null, retailPrice: 100000, flashPrice: 80000,
    startAt: new Date(Date.now() + 3_600_000).toISOString(), reminded: false,
  };

  function renderUpcoming() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <UpcomingFlashSales />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    mocks.fetchUpcoming.mockResolvedValue([UP]);
    mocks.setReminder.mockResolvedValue({});
    mocks.cancelReminder.mockResolvedValue({});
  });

  it('tiêu đề "Sắp diễn ra" và hai trạng thái nút nhắc dùng icon nét, không emoji (D7-6)', async () => {
    const first = renderUpcoming();
    const heading = await screen.findByRole('heading', { name: 'Sắp diễn ra' });
    expect(heading.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Nhắc tôi' }).querySelector('svg')).not.toBeNull();
    first.unmount();
    mocks.fetchUpcoming.mockResolvedValue([{ ...UP, reminded: true }]);
    renderUpcoming();
    expect((await screen.findByRole('button', { name: 'Đã đặt nhắc' })).querySelector('svg')).not.toBeNull();
  });

  it('khách chưa đăng nhập → không vẽ gì', async () => {
    mocks.status = 'guest';
    const { container } = renderUpcoming();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('"Nhắc tôi" đặt nhắc mà KHÔNG mở sản phẩm; bấm khi đã nhắc thì huỷ nhắc', async () => {
    renderUpcoming();
    fireEvent.click(await screen.findByRole('button', { name: /Nhắc tôi/ }));
    await waitFor(() => expect(mocks.setReminder).toHaveBeenCalledWith('u1'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('nút nhắc dùng được bằng bàn phím: Space đặt nhắc, không mở sản phẩm (D8-8)', async () => {
    renderUpcoming();
    const user = userEvent.setup();
    const remind = await screen.findByRole('button', { name: /Nhắc tôi/ });
    await user.tab();
    expect(screen.getByRole('button', { name: 'Nước rửa chén' })).toHaveFocus();
    await user.tab();
    expect(remind).toHaveFocus();
    await user.keyboard(' ');
    await waitFor(() => expect(mocks.setReminder).toHaveBeenCalledWith('u1'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('đã đặt nhắc → nhãn "Đã đặt nhắc", bấm huỷ nhắc', async () => {
    mocks.fetchUpcoming.mockResolvedValue([{ ...UP, reminded: true }]);
    renderUpcoming();
    fireEvent.click(await screen.findByRole('button', { name: /Đã đặt nhắc/ }));
    await waitFor(() => expect(mocks.cancelReminder).toHaveBeenCalledWith('u1'));
  });

  it('thẻ "Sắp diễn ra" cũng là nút tên: Enter và Space đều mở sản phẩm', async () => {
    renderUpcoming();
    const card = await screen.findByRole('button', { name: 'Nước rửa chén' });
    const user = userEvent.setup();
    card.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/product/nrc', undefined);
  });

  it('chạm thẻ → mở sản phẩm (không kèm state)', async () => {
    renderUpcoming();
    fireEvent.click(await screen.findByRole('button', { name: 'Nước rửa chén' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc', undefined);
  });

  it('nút nhắc cao tối thiểu 44px', async () => {
    renderUpcoming();
    const btn = await screen.findByRole('button', { name: /Nhắc tôi/ });
    expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});
