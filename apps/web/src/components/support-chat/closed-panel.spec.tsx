// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supportCopy } from '@tubutree/app-core/support-copy';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ChatClosedPanel } from './closed-panel';

const mocks = vi.hoisted(() => ({ copyText: vi.fn(), openChat: vi.fn(), oaAvailable: false }));
vi.mock('@/lib/copy-text', () => ({ copyText: mocks.copyText }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    oa: {
      get available() {
        return mocks.oaAvailable;
      },
      openChat: mocks.openChat,
    },
  },
}));

const copy = supportCopy.closed;
const FULL = { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: 'Tubu Tree', hours: '8:00–21:00' };
const EMPTY = { hotline: null, email: null, zaloOaName: null, hours: null };

let mounted: Rendered | null = null;
const mount = (ui: Parameters<typeof render>[0]) => {
  mounted = render(ui);
  return mounted.container;
};
const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button'));
const byName = (c: HTMLElement, name: string) => buttons(c).find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name) ?? null;
const hotlineBtn = (c: HTMLElement) => byName(c, `0984 606 774. ${copy.tapToCopy}`)!;
const emailBtn = (c: HTMLElement) => byName(c, FULL.email)!;
const statusRegion = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="status"]')!;
const alertRegion = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="alert"]');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.copyText.mockReset().mockResolvedValue(true);
  mocks.openChat.mockReset();
  mocks.oaAvailable = false;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ChatClosedPanel (web): bản đầy đủ', () => {
  it('có hotline: tiêu đề, lời dẫn, số, gợi ý chạm để chép, giờ trực và liên kết gọi', () => {
    const c = mount(<ChatClosedPanel support={FULL} />);
    const text = c.textContent ?? '';
    expect(text).toContain(copy.title);
    expect(text).toContain(copy.lead(true));
    expect(hotlineBtn(c)).not.toBeNull();
    expect(text).toContain(copy.tapToCopy);
    expect(text).toContain(copy.hours(FULL.hours));
    const call = c.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!;
    expect(call.getAttribute('href')).toBe('tel:0984606774');
    expect(call.textContent).toBe(copy.call('0984 606 774'));
  });

  it('không có hotline (hoặc chưa có cấu hình): lời dẫn khác, không có nút số và liên kết gọi', () => {
    const c = mount(<ChatClosedPanel support={EMPTY} />);
    expect(c.textContent).toContain(copy.lead(false));
    expect(c.textContent).not.toContain(copy.tapToCopy);
    expect(buttons(c)).toHaveLength(0);
    expect(c.querySelector('a')).toBeNull();
    mounted!.unmount();
    const c2 = mount(<ChatClosedPanel support={undefined} />);
    expect(c2.textContent).toContain(copy.title);
    expect(buttons(c2)).toHaveLength(0);
  });

  it('số hotline dùng số đều (tabular-nums)', () => {
    const c = mount(<ChatClosedPanel support={FULL} />);
    const heading = hotlineBtn(c).firstElementChild as HTMLElement;
    expect(heading.textContent).toBe('0984 606 774');
    expect(heading.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('có OA: nút "Nhắn OA" mở chat OA; không có OA thì chỉ hiện tên OA và không có nút', () => {
    mocks.oaAvailable = true;
    const c = mount(<ChatClosedPanel support={FULL} />);
    click(byName(c, copy.oa));
    expect(mocks.openChat).toHaveBeenCalledTimes(1);
    mounted!.unmount();
    mocks.oaAvailable = false;
    const c2 = mount(<ChatClosedPanel support={FULL} />);
    expect(byName(c2, copy.oa)).toBeNull();
    expect(c2.textContent).toContain(copy.oaName('Tubu Tree'));
  });

  it('không có tên OA: không có nút lẫn chữ OA', () => {
    mocks.oaAvailable = true;
    const c = mount(<ChatClosedPanel support={{ ...FULL, zaloOaName: null }} />);
    expect(byName(c, copy.oa)).toBeNull();
    expect(c.textContent).not.toContain('Zalo OA:');
  });
});

describe('ChatClosedPanel (web): sao chép số và email', () => {
  it('lúc đầu: vùng trạng thái có sẵn nhưng trống, không có cảnh báo', () => {
    const c = mount(<ChatClosedPanel support={FULL} />);
    expect(statusRegion(c).getAttribute('aria-live')).toBe('polite');
    expect(statusRegion(c).textContent).toBe('');
    expect(alertRegion(c)).toBeNull();
  });

  it('chép số thành công: chữ nằm trong role="status" tông phụ, không có role="alert"', async () => {
    const c = mount(<ChatClosedPanel support={FULL} />);
    click(hotlineBtn(c));
    await flush(4);
    expect(mocks.copyText).toHaveBeenCalledWith('0984 606 774');
    expect(statusRegion(c).textContent).toBe(copy.copied);
    expect((statusRegion(c).firstElementChild as HTMLElement).style.color).toBe('var(--color-text-secondary)');
    expect(alertRegion(c)).toBeNull();
  });

  it('chép số thất bại: chữ nằm trong role="alert" tông nguy hiểm, vùng trạng thái để trống', async () => {
    mocks.copyText.mockResolvedValue(false);
    const c = mount(<ChatClosedPanel support={FULL} />);
    click(hotlineBtn(c));
    await flush(4);
    const alert = alertRegion(c)!;
    expect(alert.textContent).toBe(copy.copyFailed);
    expect((alert.firstElementChild as HTMLElement).style.color).toBe('var(--color-text-danger)');
    expect(statusRegion(c).textContent).toBe('');
    expect(alert.closest('[role="status"]')).toBeNull();
  });

  it('thất bại hai lần liên tiếp cùng chữ: nút cảnh báo được dựng lại để trình đọc màn hình đọc lại', async () => {
    mocks.copyText.mockResolvedValue(false);
    const c = mount(<ChatClosedPanel support={FULL} />);
    click(hotlineBtn(c));
    await flush(4);
    const first = alertRegion(c)!;
    click(hotlineBtn(c));
    await flush(4);
    const second = alertRegion(c)!;
    expect(second.textContent).toBe(copy.copyFailed);
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it('thành công hai lần liên tiếp cùng chữ: chữ trạng thái cũng được dựng lại', async () => {
    const c = mount(<ChatClosedPanel support={FULL} />);
    click(hotlineBtn(c));
    await flush(4);
    const first = statusRegion(c).firstElementChild!;
    click(hotlineBtn(c));
    await flush(4);
    const second = statusRegion(c).firstElementChild!;
    expect(second.textContent).toBe(copy.copied);
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it('chép email: báo "Đã sao chép email hỗ trợ"; thất bại rồi thành công thì cảnh báo biến mất, và ngược lại', async () => {
    const c = mount(<ChatClosedPanel support={FULL} />);
    mocks.copyText.mockResolvedValueOnce(false);
    click(emailBtn(c));
    await flush(4);
    expect(mocks.copyText).toHaveBeenLastCalledWith(FULL.email);
    expect(alertRegion(c)!.textContent).toBe(copy.copyFailed);
    click(emailBtn(c));
    await flush(4);
    expect(alertRegion(c)).toBeNull();
    expect(statusRegion(c).textContent).toBe('Đã sao chép email hỗ trợ');
    mocks.copyText.mockResolvedValueOnce(false);
    click(emailBtn(c));
    await flush(4);
    expect(statusRegion(c).textContent).toBe('');
    expect(alertRegion(c)!.textContent).toBe(copy.copyFailed);
  });

  it('hai cú chạm số khi lần chép còn treo: chỉ chép một lần; chép xong thì chạm lại được', async () => {
    const gate = deferred<boolean>();
    mocks.copyText.mockReturnValueOnce(gate.promise);
    const c = mount(<ChatClosedPanel support={FULL} />);
    const btn = hotlineBtn(c);
    act(() => {
      btn.click();
      btn.click();
    });
    await flush(2);
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(statusRegion(c).textContent).toBe('');
    gate.resolve(true);
    await flush(4);
    expect(statusRegion(c).textContent).toBe(copy.copied);
    click(btn);
    await flush(4);
    expect(mocks.copyText).toHaveBeenCalledTimes(2);
  });

  it('một lần chép đang treo khoá cả email: chạm email lúc đó không chép thêm', async () => {
    const gate = deferred<boolean>();
    mocks.copyText.mockReturnValueOnce(gate.promise);
    const c = mount(<ChatClosedPanel support={FULL} />);
    act(() => {
      hotlineBtn(c).click();
      emailBtn(c).click();
    });
    await flush(2);
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).toHaveBeenCalledWith('0984 606 774');
    gate.resolve(true);
    await flush(4);
    click(emailBtn(c));
    await flush(4);
    expect(mocks.copyText).toHaveBeenLastCalledWith(FULL.email);
  });
});

describe('ChatClosedPanel (web): bản gọn (chat tắt mà còn lịch sử)', () => {
  it('chỉ có tiêu đề, giờ trực và liên kết gọi; không có lời dẫn hay nút chép số; vùng trạng thái không chiếm chỗ', () => {
    const c = mount(<ChatClosedPanel support={FULL} compact />);
    const text = c.textContent ?? '';
    expect(text).toContain(copy.title);
    expect(text).toContain(copy.hours(FULL.hours));
    expect(c.querySelector('a[href="tel:0984606774"]')).not.toBeNull();
    expect(text).not.toContain(copy.lead(true));
    expect(byName(c, `0984 606 774. ${copy.tapToCopy}`)).toBeNull();
    expect(statusRegion(c).parentElement!.style.minHeight).toBe('0px');
  });

  it('bản đầy đủ giữ chỗ 18px cho vùng trạng thái', () => {
    const c = mount(<ChatClosedPanel support={FULL} />);
    expect(statusRegion(c).parentElement!.style.minHeight).toBe('18px');
  });

  it('nút mở rộng: thu gọn thì ẩn OA và email (aria-expanded=false), mở ra thì hiện (aria-expanded=true, nhãn "Thu gọn"), bấm lại thì ẩn', () => {
    mocks.oaAvailable = true;
    const c = mount(<ChatClosedPanel support={FULL} compact />);
    const toggle = byName(c, copy.more)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(byName(c, copy.oa)).toBeNull();
    expect(byName(c, FULL.email)).toBeNull();
    click(toggle);
    const open = byName(c, copy.less)!;
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(byName(c, copy.oa)).not.toBeNull();
    expect(emailBtn(c)).not.toBeNull();
    expect(byName(c, copy.more)).toBeNull();
    click(open);
    expect(byName(c, copy.more)!.getAttribute('aria-expanded')).toBe('false');
    expect(byName(c, FULL.email)).toBeNull();
  });

  it('không có OA lẫn email: không có nút mở rộng', () => {
    const c = mount(<ChatClosedPanel support={{ ...FULL, email: null, zaloOaName: null }} compact />);
    expect(byName(c, copy.more)).toBeNull();
  });

  it('chỉ có email (không có tên OA): vẫn có nút mở rộng, mở ra thấy email', () => {
    const c = mount(<ChatClosedPanel support={{ ...FULL, zaloOaName: null }} compact />);
    click(byName(c, copy.more));
    expect(emailBtn(c)).not.toBeNull();
  });

  it('chỉ có tên OA (chưa mở được OA): vẫn có nút mở rộng, mở ra thấy tên OA', () => {
    const c = mount(<ChatClosedPanel support={{ ...FULL, email: null }} compact />);
    click(byName(c, copy.more));
    expect(c.textContent).toContain(copy.oaName('Tubu Tree'));
  });

  it('mở rộng rồi chép email thất bại: cảnh báo hiện trong bản gọn', async () => {
    mocks.copyText.mockResolvedValue(false);
    const c = mount(<ChatClosedPanel support={FULL} compact />);
    click(byName(c, copy.more));
    click(emailBtn(c));
    await flush(4);
    expect(alertRegion(c)!.textContent).toBe(copy.copyFailed);
  });
});
