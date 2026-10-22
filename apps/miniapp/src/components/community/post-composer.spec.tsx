import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedCategory } from '../../services/feed-api';

const mocks = vi.hoisted(() => ({ createPost: vi.fn(), openSnackbar: vi.fn(), haptic: vi.fn() }));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/feed-api', () => ({ createPost: mocks.createPost }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../image-upload', () => ({
  MultiImageUpload: ({ onChange }: { onChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['https://img/1.jpg'])}>
      stub-them-anh
    </button>
  ),
}));
vi.mock('./product-picker', () => ({
  ProductPicker: ({ onChange }: { onChange: (v: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange([{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén', thumbnail: null, basePrice: 89_000 }])}>
      stub-gan-san-pham
    </button>
  ),
}));

import PostComposer from './post-composer';

const CATS: FeedCategory[] = [
  { id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null },
  { id: 'c2', slug: 'vuon', name: 'Vườn', icon: null },
];

function renderComposer(props: Partial<Parameters<typeof PostComposer>[0]> = {}) {
  const onPosted = vi.fn();
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <PostComposer visible onClose={onClose} categories={CATS} onPosted={onPosted} {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onPosted, onClose };
}

const titleInput = () => screen.getByPlaceholderText(/Tiêu đề câu hỏi/);
const bodyInput = () => screen.getByPlaceholderText('Chia sẻ chi tiết…');
const submitBtn = () => screen.getByRole('button', { name: 'Đăng' });
const kindChip = (re: RegExp) => screen.getByText(re).closest('button') ?? screen.getByText(re);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPost.mockResolvedValue({ id: 'p1', status: 'APPROVED' });
});

describe('PostComposer — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('mở ở loại Hỏi đáp: có ô tiêu đề, nút Đăng khoá tới khi có tiêu đề + nội dung', () => {
    renderComposer();
    expect(titleInput()).toBeInTheDocument();
    expect(screen.getByText('Câu hỏi cần có tiêu đề')).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
    fireEvent.change(bodyInput(), { target: { value: 'Nội dung' } });
    expect(submitBtn()).toBeDisabled();
    fireEvent.change(titleInput(), { target: { value: 'Tiêu đề' } });
    expect(submitBtn()).not.toBeDisabled();
    expect(screen.queryByText('Câu hỏi cần có tiêu đề')).toBeNull();
  });

  it('đăng câu hỏi gửi đúng tham số: tiêu đề/nội dung đã trim, thẻ tách theo dấu phẩy, bỏ # và trùng, kèm ảnh + sản phẩm + danh mục', async () => {
    const { onPosted } = renderComposer();
    fireEvent.click(screen.getByText('Nhà bếp'));
    fireEvent.change(titleInput(), { target: { value: '  Hỏi gì đó  ' } });
    fireEvent.change(bodyInput(), { target: { value: '  Chi tiết  ' } });
    fireEvent.click(screen.getByText('stub-them-anh'));
    fireEvent.click(screen.getByText('stub-gan-san-pham'));
    fireEvent.change(screen.getByPlaceholderText(/vd: da nhạy cảm/), { target: { value: 'da nhạy cảm, #sen đá, Da Nhạy Cảm' } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalledTimes(1));
    expect(mocks.createPost).toHaveBeenCalledWith({
      kind: 'QUESTION',
      categoryId: 'c1',
      title: 'Hỏi gì đó',
      body: 'Chi tiết',
      images: ['https://img/1.jpg'],
      productSlugs: ['nuoc-rua-chen'],
      tagSlugs: ['da nhạy cảm', 'sen đá'],
      eventId: undefined,
    });
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đăng bài 🌿', type: 'success' });
    expect(mocks.haptic).toHaveBeenCalledWith('medium');
  });

  it('đổi sang Trải nghiệm: ẩn ô tiêu đề, chỉ cần nội dung, không gửi tiêu đề', async () => {
    renderComposer();
    fireEvent.click(kindChip(/Trải nghiệm/));
    expect(screen.queryByPlaceholderText(/Tiêu đề câu hỏi/)).toBeNull();
    fireEvent.change(bodyInput(), { target: { value: 'Khoe vườn' } });
    expect(submitBtn()).not.toBeDisabled();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
    expect(mocks.createPost.mock.calls[0]![0]).toMatchObject({ kind: 'SHOWCASE', title: undefined, body: 'Khoe vườn' });
  });

  it('bấm lại danh mục đang chọn thì bỏ chọn', async () => {
    renderComposer();
    fireEvent.click(kindChip(/Mẹo hay/));
    fireEvent.change(bodyInput(), { target: { value: 'Mẹo' } });
    fireEvent.click(screen.getByText('Vườn'));
    fireEvent.click(screen.getByText('Vườn'));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
    expect(mocks.createPost.mock.calls[0]![0]).toMatchObject({ kind: 'TIP', categoryId: undefined });
  });

  it('bài chờ duyệt → báo "Bài đang chờ duyệt"', async () => {
    mocks.createPost.mockResolvedValue({ id: 'p2', status: 'PENDING' });
    renderComposer();
    fireEvent.click(kindChip(/Mẹo hay/));
    fireEvent.change(bodyInput(), { target: { value: 'Mẹo' } });
    fireEvent.click(submitBtn());
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Bài đang chờ duyệt, sẽ hiện sau khi được duyệt 🌱', type: 'info' }),
    );
  });

  it('mở từ sự kiện: mặc định Trải nghiệm, hiện "Dự thi: …" và gửi kèm eventId', async () => {
    renderComposer({ eventId: 'ev1', eventTitle: 'Thi vườn xanh' });
    expect(screen.getByText('Dự thi: Thi vườn xanh')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Tiêu đề câu hỏi/)).toBeNull();
    fireEvent.change(bodyInput(), { target: { value: 'Vườn nhà mình' } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
    expect(mocks.createPost.mock.calls[0]![0]).toMatchObject({ kind: 'SHOWCASE', eventId: 'ev1' });
  });

  it('thẻ nhập có nút gỡ: bấm Huỷ trên thẻ bỏ thẻ đó khỏi danh sách gửi', async () => {
    renderComposer();
    fireEvent.click(kindChip(/Mẹo hay/));
    fireEvent.change(bodyInput(), { target: { value: 'Mẹo' } });
    fireEvent.change(screen.getByPlaceholderText(/vd: da nhạy cảm/), { target: { value: 'sen đá, da nhạy cảm' } });
    const tag = screen.getByText('sen đá', { selector: 'span' });
    fireEvent.click(tag.parentElement!.querySelector('[aria-label="Huỷ"]')!);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
    expect(mocks.createPost.mock.calls[0]![0]).toMatchObject({ tagSlugs: ['da nhạy cảm'] });
  });
});

describe('PostComposer — tiêu đề, vùng chạm, biểu tượng (C-076, C-113)', () => {
  it('có tiêu đề sheet "Đăng bài" là heading', () => {
    renderComposer();
    expect(screen.getByRole('heading', { name: 'Đăng bài' })).toBeInTheDocument();
  });

  it('loại bài và danh mục là nút chọn (aria-pressed) với vùng chạm 44px', () => {
    renderComposer();
    const hoiDap = kindChip(/Hỏi đáp/) as HTMLElement;
    expect(hoiDap.tagName).toBe('BUTTON');
    expect(hoiDap).toHaveAttribute('aria-pressed', 'true');
    expect(hoiDap.className).toContain('tubu-hit-44');
    const nhaBep = screen.getByText('Nhà bếp').closest('button') as HTMLElement;
    expect(nhaBep).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(nhaBep);
    expect(nhaBep).toHaveAttribute('aria-pressed', 'true');
  });

  it('nút gỡ thẻ có vùng chạm 44x44', () => {
    renderComposer();
    fireEvent.change(screen.getByPlaceholderText(/vd: da nhạy cảm/), { target: { value: 'sen đá' } });
    const btn = document.querySelector('[aria-label="Huỷ"]') as HTMLElement;
    expect(Number.parseFloat(btn.style.minWidth)).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('loại bài không dùng emoji làm biểu tượng', () => {
    renderComposer();
    expect(kindChip(/Hỏi đáp/).textContent).not.toMatch(/[❓🌿💡]/u);
    expect(kindChip(/Mẹo hay/).textContent).not.toMatch(/[❓🌿💡]/u);
  });

  it('ô tiêu đề, nội dung, thẻ có tên truy cập cho trình đọc màn hình', () => {
    renderComposer();
    expect(screen.getByLabelText(/Tiêu đề câu hỏi/)).toBe(titleInput());
    expect(screen.getByLabelText('Chia sẻ chi tiết…')).toBe(bodyInput());
    expect(screen.getByLabelText('Thẻ (hashtag)')).toBeInTheDocument();
  });

  it('nút Đăng nằm ngoài vùng cuộn của form (luôn thấy khi bàn phím mở)', () => {
    renderComposer();
    expect(screen.getByTestId('bottom-sheet-body').contains(submitBtn())).toBe(false);
  });
});
