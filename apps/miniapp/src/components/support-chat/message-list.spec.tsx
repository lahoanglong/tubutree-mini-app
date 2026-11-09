import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime } from '../../utils/format';
import { MessageList, type ChatItem, type ChatItemStatus } from './message-list';

const AT = '2026-11-09T03:05:00Z';
const TIME = formatDateTime(AT);
const item = (over: Partial<ChatItem> = {}): ChatItem => ({ key: 'm1', sender: 'CUSTOMER', body: 'Xin chào', imageUrl: null, createdAt: AT, status: 'sent', ...over });
const bubble = (key: string) => screen.getByTestId(`msg-${key}`);

describe('MessageList: vùng log của khung chat', () => {
  it('role="log" tên "Tin nhắn hỗ trợ", đọc lịch sự (aria-live polite), chứa mọi tin', () => {
    render(<MessageList items={[item({ key: 'a', sender: 'SYSTEM' }), item({ key: 'b' }), item({ key: 'c', sender: 'STAFF' })]} />);
    const log = screen.getByRole('log', { name: 'Tin nhắn hỗ trợ' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(within(log).getAllByTestId(/^msg-/)).toHaveLength(3);
  });

  it('chưa có tin nào: vẫn là vùng log, không có tin', () => {
    render(<MessageList items={[]} />);
    expect(screen.getByRole('log', { name: 'Tin nhắn hỗ trợ' })).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^msg-/)).toHaveLength(0);
  });
});

describe('MessageList: bong bóng theo người gửi', () => {
  it('tin hệ thống: căn giữa, chỉ có chữ, không nhãn "Tubu Tree", không trạng thái, không giờ, không nút gửi lại', () => {
    render(<MessageList items={[item({ key: 's', sender: 'SYSTEM', body: 'Cuộc trò chuyện đã đóng', onRetry: vi.fn() })]} />);
    const b = bubble('s');
    expect(b).toHaveAttribute('data-sender', 'SYSTEM');
    expect(b.style.textAlign).toBe('center');
    expect(b).toHaveTextContent('Cuộc trò chuyện đã đóng');
    expect(screen.queryByText('Tubu Tree')).toBeNull();
    expect(screen.queryByText('Đã gửi')).toBeNull();
    expect(screen.queryByText(TIME)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gửi lại' })).toBeNull();
  });

  it('tin của khách: căn phải, có trạng thái và giờ, không nhãn "Tubu Tree"', () => {
    render(<MessageList items={[item()]} />);
    const b = bubble('m1');
    expect(b).toHaveAttribute('data-sender', 'CUSTOMER');
    expect(b.style.alignItems).toBe('flex-end');
    expect(within(b).getByText('Xin chào')).toBeInTheDocument();
    expect(within(b).getByText('Đã gửi')).toBeInTheDocument();
    expect(within(b).getByText(TIME)).toBeInTheDocument();
    expect(within(b).queryByText('Tubu Tree')).toBeNull();
  });

  it('tin của nhân viên: căn trái, có nhãn "Tubu Tree" và giờ, không có trạng thái gửi', () => {
    render(<MessageList items={[item({ key: 'st', sender: 'STAFF', body: 'Dạ Tubu nghe ạ' })]} />);
    const b = bubble('st');
    expect(b).toHaveAttribute('data-sender', 'STAFF');
    expect(b.style.alignItems).toBe('flex-start');
    expect(within(b).getByText('Tubu Tree')).toBeInTheDocument();
    expect(within(b).getByText('Dạ Tubu nghe ạ')).toBeInTheDocument();
    expect(within(b).getByText(TIME)).toBeInTheDocument();
    expect(within(b).queryByText('Đã gửi')).toBeNull();
  });

  it('khách và nhân viên khác màu nền bong bóng', () => {
    render(<MessageList items={[item({ key: 'k' }), item({ key: 'n', sender: 'STAFF' })]} />);
    const bgOf = (key: string) => (within(bubble(key)).getByText('Xin chào').parentElement as HTMLElement).style.background;
    expect(bgOf('k')).toContain('--color-action-primary-bg');
    expect(bgOf('n')).toContain('--color-bg-surface');
  });

  it('có ảnh và chữ: ảnh có alt "Ảnh đã gửi", chữ nằm dưới ảnh cách 6px', () => {
    render(<MessageList items={[item({ imageUrl: 'https://res.cloudinary.com/demo/a.jpg' })]} />);
    const img = screen.getByAltText('Ảnh đã gửi') as HTMLImageElement;
    expect(img.src).toBe('https://res.cloudinary.com/demo/a.jpg');
    expect(img.style.marginBottom).toBe('6px');
    expect(screen.getByText('Xin chào')).toBeInTheDocument();
  });

  it('chỉ có ảnh: không vẽ chữ, ảnh không chừa lề dưới', () => {
    render(<MessageList items={[item({ body: '', imageUrl: 'https://res.cloudinary.com/demo/a.jpg' })]} />);
    const img = screen.getByAltText('Ảnh đã gửi') as HTMLImageElement;
    expect(img.style.marginBottom).toMatch(/^0(px)?$/);
    expect(img.parentElement?.textContent).toBe('');
  });

  it('không có ảnh thì không vẽ thẻ ảnh', () => {
    render(<MessageList items={[item()]} />);
    expect(screen.queryByAltText('Ảnh đã gửi')).toBeNull();
  });

  it('chưa có giờ (createdAt null): không vẽ giờ ở cả tin khách lẫn nhân viên', () => {
    render(<MessageList items={[item({ key: 'k', createdAt: null }), item({ key: 'n', sender: 'STAFF', createdAt: null })]} />);
    expect(screen.queryByText(TIME)).toBeNull();
  });
});

describe('MessageList: nhãn trạng thái gửi', () => {
  it.each<[ChatItemStatus, string]>([
    ['sent', 'Đã gửi'],
    ['sending', 'Đang gửi'],
    ['failed', 'Chưa gửi được'],
    ['rejected', 'Không gửi được'],
  ])('%s → "%s"', (status, label) => {
    render(<MessageList items={[item({ status })]} />);
    expect(within(bubble('m1')).getByText(label)).toBeInTheDocument();
  });

  it('chỉ failed và rejected có màu cảnh báo, sent và sending giữ màu phụ', () => {
    const colorOf = (status: ChatItemStatus, label: string) => {
      const { unmount } = render(<MessageList items={[item({ status })]} />);
      const color = screen.getByText(label).style.color;
      unmount();
      return color;
    };
    const sent = colorOf('sent', 'Đã gửi');
    const failed = colorOf('failed', 'Chưa gửi được');
    expect(colorOf('sending', 'Đang gửi')).toBe(sent);
    expect(failed).not.toBe(sent);
    expect(colorOf('rejected', 'Không gửi được')).toBe(failed);
  });
});

describe('MessageList: số đều ở giờ gửi', () => {
  it('giờ gửi của tin khách và tin nhân viên đều dùng tabular-nums, nhãn trạng thái thì không', () => {
    render(<MessageList items={[item({ key: 'k' }), item({ key: 'n', sender: 'STAFF' })]} />);
    expect(within(bubble('k')).getByText(TIME).style.fontVariantNumeric).toBe('tabular-nums');
    expect(within(bubble('n')).getByText(TIME).style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('Đã gửi').style.fontVariantNumeric).toBe('');
  });
});

describe('MessageList: lý do gửi lỗi được đọc lên (role="alert")', () => {
  it('có item.error: một vùng role="alert" chứa đúng lý do', () => {
    render(<MessageList items={[item({ status: 'rejected', error: 'Nội dung không phù hợp' })]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Nội dung không phù hợp');
  });

  it.each([[undefined], ['']])('không có lý do (%j): không vẽ vùng alert', (error) => {
    render(<MessageList items={[item({ status: 'failed', error })]} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('MessageList: nút "Gửi lại" khoá đồng bộ', () => {
  const retryBtn = () => screen.getByRole('button', { name: 'Gửi lại' });

  it('không có onRetry: không vẽ nút', () => {
    render(<MessageList items={[item({ status: 'failed' })]} />);
    expect(screen.queryByRole('button', { name: 'Gửi lại' })).toBeNull();
  });

  it('tin failed có onRetry: nút bật, bấm gọi onRetry', () => {
    const onRetry = vi.fn();
    render(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    expect(retryBtn()).toBeEnabled();
    fireEvent.click(retryBtn());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('tin đang gửi (sending): nút khoá, bấm không gọi onRetry', () => {
    const onRetry = vi.fn();
    render(<MessageList items={[item({ status: 'sending', onRetry })]} />);
    expect(retryBtn()).toBeDisabled();
    fireEvent.click(retryBtn());
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('hai cú chạm sát nhau trước khi vẽ lại: onRetry chỉ chạy một lần', () => {
    const onRetry = vi.fn();
    render(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    act(() => {
      fireEvent.click(retryBtn());
      fireEvent.click(retryBtn());
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('tin chưa đổi trạng thái (vẫn failed) thì khoá còn giữ: chạm thêm không gọi lần hai', () => {
    const onRetry = vi.fn();
    render(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    fireEvent.click(retryBtn());
    fireEvent.click(retryBtn());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('gửi lại → sending (nút khoá) → failed lại: khoá nhả, gửi lại được lần nữa', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    fireEvent.click(retryBtn());
    rerender(<MessageList items={[item({ status: 'sending', onRetry })]} />);
    expect(retryBtn()).toBeDisabled();
    fireEvent.click(retryBtn());
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    expect(retryBtn()).toBeEnabled();
    fireEvent.click(retryBtn());
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('gửi lại → sending → rejected (vẫn còn onRetry): khoá cũng nhả', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    fireEvent.click(retryBtn());
    rerender(<MessageList items={[item({ status: 'sending', onRetry })]} />);
    rerender(<MessageList items={[item({ status: 'rejected', error: 'Nội dung không phù hợp', onRetry })]} />);
    fireEvent.click(retryBtn());
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('chỉ quay về failed hoặc rejected mới nhả khoá: sang sent (vẫn còn onRetry) thì khoá còn giữ', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    fireEvent.click(retryBtn());
    rerender(<MessageList items={[item({ status: 'sent', onRetry })]} />);
    fireEvent.click(retryBtn());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đổi key (tin khác): bong bóng dựng mới nên khoá cũ không dính sang', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<MessageList items={[item({ key: 'a', status: 'failed', onRetry })]} />);
    fireEvent.click(retryBtn());
    rerender(<MessageList items={[item({ key: 'b', status: 'failed', onRetry })]} />);
    fireEvent.click(retryBtn());
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});

describe('MessageList: cuộn xuống tin mới nhất', () => {
  const scroll = vi.fn();
  beforeEach(() => {
    scroll.mockClear();
    Element.prototype.scrollIntoView = scroll;
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('cuộn khi vào; cuộn lại khi tin cuối đổi key hoặc đổi trạng thái; không cuộn khi tin cũ hơn đổi', () => {
    const { rerender } = render(<MessageList items={[item({ key: 'a' }), item({ key: 'b', status: 'sending' })]} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'end' });
    rerender(<MessageList items={[item({ key: 'a', body: 'đã sửa' }), item({ key: 'b', status: 'sending' })]} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<MessageList items={[item({ key: 'a' }), item({ key: 'b', status: 'sent' })]} />);
    expect(scroll).toHaveBeenCalledTimes(2);
    rerender(<MessageList items={[item({ key: 'a' }), item({ key: 'b', status: 'sent' }), item({ key: 'c', sender: 'STAFF' })]} />);
    expect(scroll).toHaveBeenCalledTimes(3);
  });
});
