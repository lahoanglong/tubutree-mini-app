import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ renderPoster: vi.fn() }));
vi.mock('../utils/share-poster-png', () => ({ renderPoster: (i: unknown) => mocks.renderPoster(i) }));
vi.mock('./qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));

import { SharePoster } from './share-poster';

const STORE = { kind: 'store', title: 'Góc xanh', path: '/s/goc-xanh', referralCode: 'CTV1' } as const;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.renderPoster.mockReset();
});

describe('SharePoster (Mini)', () => {
  it('đang vẽ: khung chờ role=status có tên; vẽ xong: ảnh PNG có chữ thay thế và lời nhấn giữ để lưu', async () => {
    const d = deferred<{ url: string; png: string }>();
    mocks.renderPoster.mockReturnValue(d.promise);
    render(<SharePoster input={STORE} />);
    expect(screen.getByRole('status', { name: 'Đang tạo ảnh có mã QR' })).toBeInTheDocument();
    d.resolve({ url: 'https://tubutree.com/s/goc-xanh?ref=CTV1', png: PNG });
    const img = await screen.findByRole('img', { name: 'Ảnh có mã QR: Góc xanh' });
    expect(img).toHaveAttribute('src', PNG);
    expect(screen.getByText('Nhấn giữ ảnh để lưu hoặc gửi')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(mocks.renderPoster).toHaveBeenCalledWith(STORE);
  });

  it('webview không có canvas (png rỗng): hiện QR thường của link web công khai', async () => {
    mocks.renderPoster.mockResolvedValue({ url: 'https://tubutree.com/s/goc-xanh?ref=CTV1', png: '' });
    render(<SharePoster input={STORE} />);
    expect(await screen.findByTestId('qr')).toHaveTextContent('https://tubutree.com/s/goc-xanh?ref=CTV1');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('không nạp được bộ vẽ: QR thường của cùng link web công khai, không treo khung chờ', async () => {
    mocks.renderPoster.mockRejectedValue(new Error('chunk'));
    render(<SharePoster input={{ kind: 'product', name: 'Ly tre', slug: 'ly-tre', shareLink: 'https://zalo.me/s/1/product/ly-tre?ref=CTV9' }} />);
    expect(await screen.findByTestId('qr')).toHaveTextContent('https://tubutree.com/san-pham/ly-tre?ref=CTV9');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('đổi sản phẩm: vẽ lại theo dữ liệu mới, kết quả cũ về muộn không đè ảnh mới', async () => {
    const first = deferred<{ url: string; png: string }>();
    mocks.renderPoster.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ url: 'u2', png: `${PNG}2` });
    const { rerender } = render(<SharePoster input={{ kind: 'product', name: 'A', slug: 'a' }} />);
    rerender(<SharePoster input={{ kind: 'product', name: 'B', slug: 'b' }} />);
    expect(await screen.findByRole('img', { name: 'Ảnh có mã QR: B' })).toHaveAttribute('src', `${PNG}2`);
    first.resolve({ url: 'u1', png: `${PNG}1` });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('img')).toHaveAttribute('src', `${PNG}2`);
    expect(mocks.renderPoster).toHaveBeenNthCalledWith(2, { kind: 'product', name: 'B', slug: 'b' });
  });
});
