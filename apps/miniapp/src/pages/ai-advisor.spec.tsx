import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiProduct } from '../services/ai-api';
import { formatVnd } from '../utils/format';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  aiChat: vi.fn(),
  getPublicConfig: vi.fn(async () => ({})),
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicConfig: mocks.getPublicConfig,
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/ai-advisor', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/ai-api', () => ({ aiChat: mocks.aiChat }));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));

import AiAdvisorPage from './ai-advisor';

const PRODUCT = (id: string, over: Partial<AiProduct> = {}): AiProduct => ({
  id,
  name: `Nước rửa chén ${id}`,
  slug: `nuoc-rua-chen-${id}`,
  brand: 'Tubu',
  shortDesc: null,
  thumbnail: `https://img.test/${id}.jpg`,
  basePrice: 90_000,
  salePrice: null,
  ...over,
});

const REPLY = (reply = 'Mình gợi ý bạn thử loại này', products: AiProduct[] = []) => ({ reply, products });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AiAdvisorPage />
    </QueryClientProvider>,
  );
}

const input = () => screen.getByPlaceholderText('Nhập câu hỏi…') as HTMLInputElement;
const sendBtn = () => screen.getByRole('button', { name: 'Gửi' });

async function ask(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(sendBtn());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aiChat.mockResolvedValue(REPLY());
  mocks.getPublicConfig.mockResolvedValue({ aiAdvisorEnabled: true });
});

describe('AiAdvisorPage — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('chưa có tin nhắn: lời chào và 3 câu gợi ý', () => {
    renderPage();
    expect(screen.getByText('Trợ lý AI Tubu')).toBeInTheDocument();
    expect(screen.getByText('Tư vấn sản phẩm tiêu dùng xanh 24/7')).toBeInTheDocument();
    expect(screen.getByText('Chào bạn! Mình là Trợ lý Tubu')).toBeInTheDocument();
    expect(screen.getByText('Nước rửa chén nào an toàn cho bé?')).toBeInTheDocument();
    expect(screen.getByText('Mình cần sản phẩm tẩy rửa nhà bếp xanh')).toBeInTheDocument();
    expect(screen.getByText('Gợi ý quà tặng sống xanh')).toBeInTheDocument();
  });

  it('bấm câu gợi ý gửi đúng câu đó, ẩn phần chào và hiện câu trả lời', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Gợi ý quà tặng sống xanh'));
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledWith('Gợi ý quà tặng sống xanh', expect.any(Array)));
    expect(await screen.findByText('Mình gợi ý bạn thử loại này')).toBeInTheDocument();
    expect(screen.getByText('Gợi ý quà tặng sống xanh')).toBeInTheDocument();
    expect(screen.queryByText('Chào bạn! Mình là Trợ lý Tubu')).not.toBeInTheDocument();
  });

  it('gõ và bấm Gửi: cắt khoảng trắng hai đầu, xoá ô nhập, hiện tin của bạn rồi câu trả lời', async () => {
    renderPage();
    await ask('  Có nước giặt không?  ');
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledWith('Có nước giặt không?', expect.any(Array)));
    expect(input().value).toBe('');
    expect(screen.getByText('Có nước giặt không?')).toBeInTheDocument();
    expect(await screen.findByText('Mình gợi ý bạn thử loại này')).toBeInTheDocument();
  });

  it('ô nhập giới hạn 500 ký tự', () => {
    renderPage();
    expect(input().maxLength).toBe(500);
  });

  it('ô nhập trống hoặc chỉ có khoảng trắng: nút Gửi khoá, không gửi', () => {
    renderPage();
    expect(sendBtn()).toBeDisabled();
    fireEvent.change(input(), { target: { value: '   ' } });
    expect(sendBtn()).toBeDisabled();
    fireEvent.click(sendBtn());
    expect(mocks.aiChat).not.toHaveBeenCalled();
    fireEvent.change(input(), { target: { value: 'a' } });
    expect(sendBtn()).not.toBeDisabled();
  });

  it('tin sau gửi kèm lịch sử các lượt trước (chỉ role + content, không kèm sản phẩm)', async () => {
    mocks.aiChat.mockResolvedValueOnce(REPLY('Câu trả lời 1', [PRODUCT('a')]));
    renderPage();
    await ask('Câu hỏi 1');
    await screen.findByText('Câu trả lời 1');

    await ask('Câu hỏi 2');
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(2));
    const [message, history] = mocks.aiChat.mock.calls[1] as [string, Record<string, unknown>[]];
    expect(message).toBe('Câu hỏi 2');
    expect(history.slice(0, 2)).toEqual([
      { role: 'user', content: 'Câu hỏi 1' },
      { role: 'assistant', content: 'Câu trả lời 1' },
    ]);
    for (const turn of history) expect(Object.keys(turn).sort()).toEqual(['content', 'role']);
  });

  it('lịch sử gửi lên chỉ giữ 20 lượt gần nhất', async () => {
    renderPage();
    for (let i = 1; i <= 12; i++) {
      await ask(`hỏi ${i}`);
      await waitFor(() => expect(screen.getAllByText('Mình gợi ý bạn thử loại này')).toHaveLength(i));
    }
    const lastHistory = mocks.aiChat.mock.calls[11]![1] as { role: string; content: string }[];
    expect(lastHistory).toHaveLength(20);
    expect(lastHistory.some((t) => t.content === 'hỏi 1')).toBe(false);
  });

  it('lỗi: báo lỗi và thêm tin xin lỗi của trợ lý', async () => {
    mocks.aiChat.mockRejectedValue(new Error('Hết hạn mức'));
    renderPage();
    await ask('Xin chào');
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Hết hạn mức', type: 'error' }));
    expect(await screen.findByText('Xin lỗi, mình chưa trả lời được lúc này 🌿')).toBeInTheDocument();
  });

  it('sản phẩm gợi ý: tên, giá khuyến mãi nếu có (không thì giá gốc), ảnh; bấm mở trang sản phẩm', async () => {
    mocks.aiChat.mockResolvedValue(
      REPLY('Đây nhé', [PRODUCT('a', { salePrice: 70_000 }), PRODUCT('b', { thumbnail: null })]),
    );
    renderPage();
    await ask('Gợi ý đi');
    expect(await screen.findByText('Nước rửa chén a')).toBeInTheDocument();
    expect(screen.getByText(formatVnd(70_000))).toBeInTheDocument();
    expect(screen.getByText(formatVnd(90_000))).toBeInTheDocument();
    expect(screen.getByAltText('Nước rửa chén a')).toHaveAttribute('src', 'https://img.test/a.jpg');
    expect(screen.queryByAltText('Nước rửa chén b')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Nước rửa chén b'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen-b');
  });

  it('đang soạn: hiện "Trợ lý đang soạn…" và bấm Gửi lần nữa không gửi thêm', async () => {
    mocks.aiChat.mockReturnValue(new Promise(() => {}));
    renderPage();
    await ask('Câu 1');
    expect(await screen.findByText('Trợ lý đang soạn…')).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'Câu 2' } });
    fireEvent.click(sendBtn());
    expect(mocks.aiChat).toHaveBeenCalledTimes(1);
  });

  it('xong thì ẩn "Trợ lý đang soạn…"', async () => {
    renderPage();
    await ask('Câu 1');
    await screen.findByText('Mình gợi ý bạn thử loại này');
    expect(screen.queryByText('Trợ lý đang soạn…')).not.toBeInTheDocument();
  });
});

describe('AiAdvisorPage — tiêu đề, vùng chạm, bàn phím (C-076, C-114)', () => {
  it('có đúng một h1 "Trợ lý AI Tubu" khi chưa chat và sau khi có tin', async () => {
    const first = renderPage();
    expect(first.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trợ lý AI Tubu');
    await ask('Xin chào');
    await screen.findByText('Mình gợi ý bạn thử loại này');
    expect(first.container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('nút Gửi, câu gợi ý và dòng sản phẩm cao >= 44px', async () => {
    mocks.aiChat.mockResolvedValue(REPLY('Đây nhé', [PRODUCT('a')]));
    renderPage();
    const heights = (els: HTMLElement[]) => els.map((e) => Number.parseFloat(e.style.minHeight || e.style.height));
    const suggestion = screen.getByText('Gợi ý quà tặng sống xanh').closest('[role="button"]') as HTMLElement | null;
    expect(suggestion).not.toBeNull();
    expect(heights([sendBtn(), suggestion!]).every((h) => h >= 44)).toBe(true);

    fireEvent.click(suggestion!);
    const row = (await screen.findByText('Nước rửa chén a')).closest('[role="button"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(Number.parseFloat(row!.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('câu gợi ý và dòng sản phẩm dùng được bằng bàn phím', async () => {
    mocks.aiChat.mockResolvedValue(REPLY('Đây nhé', [PRODUCT('a')]));
    renderPage();
    const suggestion = screen.getByText('Nước rửa chén nào an toàn cho bé?').closest('[role="button"]') as HTMLElement;
    expect(suggestion.tabIndex).toBe(0);
    fireEvent.keyDown(suggestion, { key: 'Enter' });
    await waitFor(() =>
      expect(mocks.aiChat).toHaveBeenCalledWith('Nước rửa chén nào an toàn cho bé?', expect.any(Array)),
    );

    const row = (await screen.findByText('Nước rửa chén a')).closest('[role="button"]') as HTMLElement;
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen-a');
  });

  it('ô nhập có tên truy cập, khung chat là role=log và trạng thái soạn là role=status', async () => {
    mocks.aiChat.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('textbox', { name: 'Nhập câu hỏi' })).toBe(input());
    expect(screen.getByRole('log', { name: 'Cuộc trò chuyện' })).toBeInTheDocument();
    await ask('Câu 1');
    expect(await screen.findByRole('status')).toHaveTextContent('Trợ lý đang soạn…');
  });

  it('đang soạn: nút Gửi hiện trạng thái đang tải thay vì khoá trắng', async () => {
    mocks.aiChat.mockReturnValue(new Promise(() => {}));
    renderPage();
    await ask('Câu 1');
    await screen.findByText('Trợ lý đang soạn…');
    expect(sendBtn()).toHaveAttribute('aria-busy', 'true');
  });
});

describe('AiAdvisorPage — cuộn, phím Enter, lưu ý, thử lại (D5-12)', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it('chưa có tin nhắn thì không cuộn; gửi tin thì cuộn ngay, có trả lời thì cuộn tiếp xuống tin mới nhất', async () => {
    let answer: (v: ReturnType<typeof REPLY>) => void = () => {};
    mocks.aiChat.mockReturnValue(new Promise((r) => (answer = r)));
    renderPage();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await ask('Xin chào');
    await screen.findByText('Trợ lý đang soạn…');
    const afterQuestion = scrollIntoView.mock.calls.length;
    expect(afterQuestion).toBeGreaterThanOrEqual(1);
    answer(REPLY('Trả lời đây'));
    await screen.findByText('Trả lời đây');
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(afterQuestion);
    expect(scrollIntoView.mock.calls.at(-1)![0]).toMatchObject({ block: 'end' });
  });

  it('Enter gửi tin và xoá ô nhập', async () => {
    renderPage();
    fireEvent.change(input(), { target: { value: 'Có nước giặt không?' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledWith('Có nước giặt không?', expect.any(Array)));
    expect(input().value).toBe('');
  });

  it('Shift+Enter xuống dòng (không gửi, không chặn phím)', () => {
    renderPage();
    fireEvent.change(input(), { target: { value: 'dòng 1' } });
    const notPrevented = fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(notPrevented).toBe(true);
    expect(mocks.aiChat).not.toHaveBeenCalled();
    expect(input().value).toBe('dòng 1');
  });

  it('Enter khi đang gõ dở bằng bộ gõ (IME) chỉ chốt chữ, không gửi', () => {
    renderPage();
    fireEvent.change(input(), { target: { value: 'nuoc' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(mocks.aiChat).not.toHaveBeenCalled();
    expect(input().value).toBe('nuoc');
  });

  it('Enter khi ô trống hoặc đang soạn câu trước: không gửi', async () => {
    renderPage();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(mocks.aiChat).not.toHaveBeenCalled();
    mocks.aiChat.mockReturnValue(new Promise(() => {}));
    await ask('Câu 1');
    await screen.findByText('Trợ lý đang soạn…');
    fireEvent.change(input(), { target: { value: 'Câu 2' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(mocks.aiChat).toHaveBeenCalledTimes(1);
  });

  it('ô nhập là ô nhiều dòng (textarea) vẫn giữ tên truy cập và giới hạn 500 ký tự', () => {
    renderPage();
    expect(input().tagName).toBe('TEXTAREA');
    expect(screen.getByRole('textbox', { name: 'Nhập câu hỏi' })).toBe(input());
    expect(input().maxLength).toBe(500);
  });

  it('luôn có dòng nhỏ "Gợi ý chỉ để tham khảo" — cả lúc chưa chat và sau khi có trả lời', async () => {
    renderPage();
    expect(screen.getByText(/Gợi ý chỉ để tham khảo/)).toBeInTheDocument();
    await ask('Xin chào');
    await screen.findByText('Mình gợi ý bạn thử loại này');
    expect(screen.getAllByText(/Gợi ý chỉ để tham khảo/)).toHaveLength(1);
  });

  it('lỗi: tin xin lỗi có nút "Thử lại"; bấm thì gửi lại đúng câu cũ, bỏ tin xin lỗi, không nhân đôi tin của bạn', async () => {
    mocks.aiChat.mockRejectedValueOnce(new Error('Hết hạn mức')).mockResolvedValueOnce(REPLY('Trả lời sau khi thử lại'));
    renderPage();
    await ask('Xin chào');
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(2));
    expect(mocks.aiChat.mock.calls[1]![0]).toBe('Xin chào');
    expect(mocks.aiChat.mock.calls[1]![1]).toEqual([]);
    expect(await screen.findByText('Trả lời sau khi thử lại')).toBeInTheDocument();
    expect(screen.queryByText('Xin lỗi, mình chưa trả lời được lúc này 🌿')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getAllByText('Xin chào')).toHaveLength(1);
  });

  it('thử lại giữ nguyên lịch sử các lượt trước (không kèm tin xin lỗi và chính câu đang hỏi lại)', async () => {
    mocks.aiChat
      .mockResolvedValueOnce(REPLY('Trả lời 1'))
      .mockRejectedValueOnce(new Error('lỗi mạng'))
      .mockResolvedValueOnce(REPLY('Trả lời 2'));
    renderPage();
    await ask('Câu 1');
    await screen.findByText('Trả lời 1');
    await ask('Câu 2');
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(3));
    expect(mocks.aiChat.mock.calls[2]![0]).toBe('Câu 2');
    expect(mocks.aiChat.mock.calls[2]![1]).toEqual([
      { role: 'user', content: 'Câu 1' },
      { role: 'assistant', content: 'Trả lời 1' },
    ]);
  });

  it('thử lại vẫn lỗi: lại có tin xin lỗi và nút "Thử lại" (chỉ một nút)', async () => {
    mocks.aiChat.mockRejectedValue(new Error('Hết hạn mức'));
    renderPage();
    await ask('Xin chào');
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText('Xin lỗi, mình chưa trả lời được lúc này 🌿')).toHaveLength(1);
    expect(await screen.findAllByRole('button', { name: 'Thử lại' })).toHaveLength(1);
  });

  it('chỉ tin xin lỗi cuối cùng có nút "Thử lại": hỏi câu mới thì nút cũ biến mất', async () => {
    mocks.aiChat.mockRejectedValueOnce(new Error('lỗi')).mockResolvedValueOnce(REPLY('Ổn rồi'));
    renderPage();
    await ask('Câu 1');
    await screen.findByRole('button', { name: 'Thử lại' });
    await ask('Câu 2');
    await screen.findByText('Ổn rồi');
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });
});

describe('Công tắc tắt AI', () => {
  it('server báo tắt → link cũ vào trang được đưa về Trang chủ, không hiện khung chat lỗi', async () => {
    mocks.getPublicConfig.mockResolvedValue({ aiAdvisorEnabled: false });
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('server báo bật hoặc chưa biết → không chuyển hướng', async () => {
    renderPage();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    await act(async () => {});
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
