// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { formatDateTime } from '@/lib/format-date';
import { MessageList, type ChatItem, type ChatItemStatus } from './message-list';

const AT = '2026-11-09T03:05:00Z';
const TIME = formatDateTime(AT);
const item = (over: Partial<ChatItem> = {}): ChatItem => ({ key: 'm1', sender: 'CUSTOMER', body: 'Xin chào', imageUrl: null, createdAt: AT, status: 'sent', ...over });

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});
// Cùng một client và cùng lớp bọc ở lần dựng đầu lẫn các lần vẽ lại: nếu không React dựng lại cả cây và ref của bong bóng bị đặt lại.
const qc = new QueryClient();
const mount = (ui: ReactElement) => {
  const r = render(ui, qc);
  mounted.push(r);
  return r;
};
const rerender = (r: Rendered, ui: ReactElement) =>
  act(() => {
    r.root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  });
const bubble = (r: Rendered, key: string) => r.container.querySelector<HTMLElement>(`[data-testid="msg-${key}"]`)!;
/** Phần tử lá có đúng chữ này (null nếu không có). */
const leaf = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLElement>('*')].find((e) => e.children.length === 0 && e.textContent === text) ?? null;
const retryBtn = (r: Rendered) => [...r.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Gửi lại') as HTMLButtonElement | undefined;

describe('MessageList (web): vùng log của khung chat', () => {
  it('role="log" tên "Tin nhắn hỗ trợ", đọc lịch sự (aria-live polite), chứa mọi tin', () => {
    const r = mount(<MessageList items={[item({ key: 'a', sender: 'SYSTEM' }), item({ key: 'b' }), item({ key: 'c', sender: 'STAFF' })]} />);
    const log = r.container.querySelector('[role="log"]')!;
    expect(log.getAttribute('aria-label')).toBe('Tin nhắn hỗ trợ');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.querySelectorAll('[data-testid^="msg-"]')).toHaveLength(3);
  });

  it('chưa có tin nào: vẫn là vùng log, không có tin', () => {
    const r = mount(<MessageList items={[]} />);
    expect(r.container.querySelector('[role="log"]')).not.toBeNull();
    expect(r.container.querySelectorAll('[data-testid^="msg-"]')).toHaveLength(0);
  });
});

describe('MessageList (web): bong bóng theo người gửi', () => {
  it('tin hệ thống: căn giữa, chỉ có chữ, không nhãn "Tubu Tree", không trạng thái, không giờ, không nút gửi lại', () => {
    const r = mount(<MessageList items={[item({ key: 's', sender: 'SYSTEM', body: 'Cuộc trò chuyện đã đóng', onRetry: vi.fn() })]} />);
    const b = bubble(r, 's');
    expect(b.getAttribute('data-sender')).toBe('SYSTEM');
    expect(b.style.textAlign).toBe('center');
    expect(b.textContent).toBe('Cuộc trò chuyện đã đóng');
    expect(leaf(r.container, 'Tubu Tree')).toBeNull();
    expect(leaf(r.container, 'Đã gửi')).toBeNull();
    expect(leaf(r.container, TIME)).toBeNull();
    expect(retryBtn(r)).toBeUndefined();
  });

  it('tin của khách: căn phải, có trạng thái và giờ, không nhãn "Tubu Tree"', () => {
    const r = mount(<MessageList items={[item()]} />);
    const b = bubble(r, 'm1');
    expect(b.getAttribute('data-sender')).toBe('CUSTOMER');
    expect(b.style.alignItems).toBe('flex-end');
    expect(leaf(b, 'Xin chào')).not.toBeNull();
    expect(leaf(b, 'Đã gửi')).not.toBeNull();
    expect(leaf(b, TIME)).not.toBeNull();
    expect(leaf(b, 'Tubu Tree')).toBeNull();
  });

  it('tin của nhân viên: căn trái, có nhãn "Tubu Tree" và giờ, không có trạng thái gửi', () => {
    const r = mount(<MessageList items={[item({ key: 'st', sender: 'STAFF', body: 'Dạ Tubu nghe ạ' })]} />);
    const b = bubble(r, 'st');
    expect(b.getAttribute('data-sender')).toBe('STAFF');
    expect(b.style.alignItems).toBe('flex-start');
    expect(leaf(b, 'Tubu Tree')).not.toBeNull();
    expect(leaf(b, 'Dạ Tubu nghe ạ')).not.toBeNull();
    expect(leaf(b, TIME)).not.toBeNull();
    expect(leaf(b, 'Đã gửi')).toBeNull();
  });

  it('khách và nhân viên khác màu nền bong bóng', () => {
    const r = mount(<MessageList items={[item({ key: 'k' }), item({ key: 'n', sender: 'STAFF' })]} />);
    const bgOf = (key: string) => leaf(bubble(r, key), 'Xin chào')!.parentElement!.style.background;
    expect(bgOf('k')).toContain('--color-action-primary-bg');
    expect(bgOf('n')).toContain('--color-bg-surface');
  });

  it('có ảnh và chữ: ảnh có alt "Ảnh đã gửi", chữ nằm dưới ảnh cách 6px', () => {
    const r = mount(<MessageList items={[item({ imageUrl: 'https://res.cloudinary.com/demo/a.jpg' })]} />);
    const img = r.container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('Ảnh đã gửi');
    expect(img.getAttribute('src')).toBe('https://res.cloudinary.com/demo/a.jpg');
    expect(img.style.marginBottom).toBe('6px');
    expect(leaf(r.container, 'Xin chào')).not.toBeNull();
  });

  it('chỉ có ảnh: không vẽ chữ, ảnh không chừa lề dưới', () => {
    const r = mount(<MessageList items={[item({ body: '', imageUrl: 'https://res.cloudinary.com/demo/a.jpg' })]} />);
    const img = r.container.querySelector('img')!;
    expect(img.style.marginBottom).toMatch(/^0(px)?$/);
    expect(img.parentElement!.textContent).toBe('');
  });

  it('không có ảnh thì không vẽ thẻ ảnh', () => {
    const r = mount(<MessageList items={[item()]} />);
    expect(r.container.querySelector('img')).toBeNull();
  });

  it('chưa có giờ (createdAt null): không vẽ giờ ở cả tin khách lẫn nhân viên', () => {
    const r = mount(<MessageList items={[item({ key: 'k', createdAt: null }), item({ key: 'n', sender: 'STAFF', createdAt: null })]} />);
    expect(leaf(r.container, TIME)).toBeNull();
  });
});

describe('MessageList (web): nhãn trạng thái gửi', () => {
  it.each<[ChatItemStatus, string]>([
    ['sent', 'Đã gửi'],
    ['sending', 'Đang gửi'],
    ['failed', 'Chưa gửi được'],
    ['rejected', 'Không gửi được'],
  ])('%s → "%s"', (status, label) => {
    const r = mount(<MessageList items={[item({ status })]} />);
    expect(leaf(bubble(r, 'm1'), label)).not.toBeNull();
  });

  it('chỉ failed và rejected có màu cảnh báo, sent và sending giữ màu phụ', () => {
    const colorOf = (status: ChatItemStatus, label: string) => {
      const r = render(<MessageList items={[item({ status })]} />);
      const color = leaf(r.container, label)!.style.color;
      r.unmount();
      return color;
    };
    const sent = colorOf('sent', 'Đã gửi');
    const failed = colorOf('failed', 'Chưa gửi được');
    expect(colorOf('sending', 'Đang gửi')).toBe(sent);
    expect(failed).not.toBe(sent);
    expect(colorOf('rejected', 'Không gửi được')).toBe(failed);
  });
});

describe('MessageList (web): số đều ở giờ gửi', () => {
  it('giờ gửi của tin khách và tin nhân viên đều dùng tabular-nums, nhãn trạng thái thì không', () => {
    const r = mount(<MessageList items={[item({ key: 'k' }), item({ key: 'n', sender: 'STAFF' })]} />);
    expect(leaf(bubble(r, 'k'), TIME)!.style.fontVariantNumeric).toBe('tabular-nums');
    expect(leaf(bubble(r, 'n'), TIME)!.style.fontVariantNumeric).toBe('tabular-nums');
    expect(leaf(r.container, 'Đã gửi')!.style.fontVariantNumeric).toBe('');
  });
});

describe('MessageList (web): lý do gửi lỗi được đọc lên (role="alert")', () => {
  it('có item.error: một vùng role="alert" chứa đúng lý do', () => {
    const r = mount(<MessageList items={[item({ status: 'rejected', error: 'Nội dung không phù hợp' })]} />);
    const alerts = r.container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toBe('Nội dung không phù hợp');
  });

  it.each([[undefined], ['']])('không có lý do (%j): không vẽ vùng alert', (error) => {
    const r = mount(<MessageList items={[item({ status: 'failed', error })]} />);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('MessageList (web): nút "Gửi lại" khoá đồng bộ', () => {
  it('không có onRetry: không vẽ nút', () => {
    const r = mount(<MessageList items={[item({ status: 'failed' })]} />);
    expect(retryBtn(r)).toBeUndefined();
  });

  it('tin failed có onRetry: nút bật, bấm gọi onRetry', () => {
    const onRetry = vi.fn();
    const r = mount(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    expect(retryBtn(r)!.disabled).toBe(false);
    click(retryBtn(r)!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('tin đang gửi (sending): nút khoá, bấm không gọi onRetry', () => {
    const onRetry = vi.fn();
    const r = mount(<MessageList items={[item({ status: 'sending', onRetry })]} />);
    expect(retryBtn(r)!.disabled).toBe(true);
    click(retryBtn(r)!);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('hai cú bấm sát nhau trước khi vẽ lại: onRetry chỉ chạy một lần', () => {
    const onRetry = vi.fn();
    const r = mount(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    act(() => {
      click(retryBtn(r)!);
      click(retryBtn(r)!);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('tin chưa đổi trạng thái (vẫn failed) thì khoá còn giữ: bấm thêm không gọi lần hai', () => {
    const onRetry = vi.fn();
    const r = mount(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    click(retryBtn(r)!);
    click(retryBtn(r)!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('gửi lại → sending (nút khoá) → failed lại: khoá nhả, gửi lại được lần nữa', () => {
    const onRetry = vi.fn();
    const r = mount(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    click(retryBtn(r)!);
    rerender(r, <MessageList items={[item({ status: 'sending', onRetry })]} />);
    expect(retryBtn(r)!.disabled).toBe(true);
    click(retryBtn(r)!);
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(r, <MessageList items={[item({ status: 'failed', onRetry })]} />);
    expect(retryBtn(r)!.disabled).toBe(false);
    click(retryBtn(r)!);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('gửi lại → sending → rejected (vẫn còn onRetry): khoá cũng nhả', () => {
    const onRetry = vi.fn();
    const r = mount(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    click(retryBtn(r)!);
    rerender(r, <MessageList items={[item({ status: 'sending', onRetry })]} />);
    rerender(r, <MessageList items={[item({ status: 'rejected', error: 'Nội dung không phù hợp', onRetry })]} />);
    click(retryBtn(r)!);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('chỉ quay về failed hoặc rejected mới nhả khoá: sang sent (vẫn còn onRetry) thì khoá còn giữ', () => {
    const onRetry = vi.fn();
    const r = mount(<MessageList items={[item({ status: 'failed', onRetry })]} />);
    click(retryBtn(r)!);
    rerender(r, <MessageList items={[item({ status: 'sent', onRetry })]} />);
    click(retryBtn(r)!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đổi key (tin khác): bong bóng dựng mới nên khoá cũ không dính sang', () => {
    const onRetry = vi.fn();
    const r = mount(<MessageList items={[item({ key: 'a', status: 'failed', onRetry })]} />);
    click(retryBtn(r)!);
    rerender(r, <MessageList items={[item({ key: 'b', status: 'failed', onRetry })]} />);
    click(retryBtn(r)!);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});

describe('MessageList (web): cuộn xuống tin mới nhất', () => {
  const scroll = vi.fn();
  beforeEach(() => {
    scroll.mockClear();
    Element.prototype.scrollIntoView = scroll;
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('cuộn khi vào; cuộn lại khi tin cuối đổi key hoặc đổi trạng thái; không cuộn khi tin cũ hơn đổi', () => {
    const r = mount(<MessageList items={[item({ key: 'a' }), item({ key: 'b', status: 'sending' })]} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'end' });
    rerender(r, <MessageList items={[item({ key: 'a', body: 'đã sửa' }), item({ key: 'b', status: 'sending' })]} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(r, <MessageList items={[item({ key: 'a' }), item({ key: 'b', status: 'sent' })]} />);
    expect(scroll).toHaveBeenCalledTimes(2);
    rerender(r, <MessageList items={[item({ key: 'a' }), item({ key: 'b', status: 'sent' }), item({ key: 'c', sender: 'STAFF' })]} />);
    expect(scroll).toHaveBeenCalledTimes(3);
  });

  it('từ md trong khung tin riêng: cuộn ô khung xuống đáy, không cuộn cả trang', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const r = mount(
      <div data-chat-pane>
        <MessageList items={[item()]} />
      </div>,
    );
    const pane = r.container.querySelector<HTMLElement>('[data-chat-pane]')!;
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 480 });
    rerender(
      r,
      <div data-chat-pane>
        <MessageList items={[item(), item({ key: 'm2' })]} />
      </div>,
    );
    expect(pane.scrollTop).toBe(480);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 768px)');
    expect(scroll).not.toHaveBeenCalled();
  });

  it('dưới md dù có khung tin: cuộn bằng scrollIntoView', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    mount(
      <div data-chat-pane>
        <MessageList items={[item()]} />
      </div>,
    );
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
