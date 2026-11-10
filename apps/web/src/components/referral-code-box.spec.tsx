// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, typeInto } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ recordReferralTouch: vi.fn() }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  recordReferralTouch: mocks.recordReferralTouch,
}));

import { ReferralCodeBox } from './referral-code-box';

type Props = React.ComponentProps<typeof ReferralCodeBox>;

interface Mounted {
  container: HTMLDivElement;
  rerender: (next: Partial<Props>) => void;
  onApplied: ReturnType<typeof vi.fn>;
}

let roots: { root: Root; container: HTMLDivElement }[] = [];
afterEach(() => {
  roots.forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
  roots = [];
});
beforeEach(() => vi.clearAllMocks());

// Không bọc QueryClientProvider: ca đổi prop `disabled` giữa chừng phải giữ nguyên state của hộp, dựng lại cây là mất.
function mount(initial: Partial<Props> = {}): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  const onApplied = vi.fn();
  let props: Props = { linkedCode: null, appliedCode: null, onApplied, ...initial };
  act(() => root.render(<ReferralCodeBox {...props} />));
  return {
    container,
    onApplied,
    rerender: (next) => {
      props = { ...props, ...next };
      act(() => root.render(<ReferralCodeBox {...props} />));
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// jsdom không tự thả focus khi ô nhập bị disabled (Chromium thả về body) và không cho blur() ô đã disabled: đẩy focus sang một nút phụ để tái hiện.
function dropFocusElsewhere() {
  const sink = document.createElement('button');
  document.body.appendChild(sink);
  sink.focus();
  return sink;
}

const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('#referral-code')!;
const form = (c: HTMLElement) => c.querySelector('form')!;
const button = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(label))!;
const submitButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const alertEl = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="alert"]');
const submitForm = (c: HTMLElement) =>
  act(() => {
    form(c).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
const openForm = (c: HTMLElement) => click(button(c, 'Nhập mã'));

describe('ReferralCodeBox web — vùng có tên và các trạng thái hiển thị', () => {
  it('thu gọn: vùng "Mã người giới thiệu" có nút Nhập mã, chưa có ô nhập', () => {
    const { container } = mount();
    const region = container.querySelector('section');
    expect(region).not.toBeNull();
    expect(region!.getAttribute('aria-label')).toBe('Mã người giới thiệu');
    expect(button(container, 'Nhập mã').disabled).toBe(false);
    expect(input(container)).toBeNull();
    openForm(container);
    expect(region!.contains(input(container))).toBe(true);
  });

  it('có mã gắn sẵn từ link: hiện cố định viết hoa, không có nút Nhập mã/Đổi, vẫn nằm trong vùng', () => {
    const { container } = mount({ linkedCode: ' ab12cd34 ' });
    expect(container.querySelector('section')!.getAttribute('aria-label')).toBe('Mã người giới thiệu');
    expect(container.textContent).toContain('AB12CD34');
    expect(container.textContent).toContain('Bạn đang mua qua link giới thiệu');
    expect(button(container, 'Nhập mã')).toBeUndefined();
    expect(button(container, 'Đổi')).toBeUndefined();
  });

  it('đã áp dụng: hiện mã + nút Đổi; Huỷ giữ mã cũ; đổi sang mã mới hợp lệ thì báo mã mới', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    const { container, onApplied } = mount({ appliedCode: 'AB12CD34' });
    expect(container.textContent).toContain('Mã hợp lệ, đơn này ghi nhận cho người giới thiệu');

    click(button(container, 'Đổi'));
    expect(input(container).value).toBe('');
    click(button(container, 'Huỷ'));
    expect(container.textContent).toContain('AB12CD34');
    expect(onApplied).not.toHaveBeenCalled();

    click(button(container, 'Đổi'));
    typeInto(input(container), 'ff00ee11');
    submitForm(container);
    await flush();
    expect(onApplied).toHaveBeenCalledWith('FF00EE11');
  });

  it('Đổi xoá lỗi và bản nháp cũ của lần mở trước', () => {
    const { container } = mount({ appliedCode: 'AB12CD34' });
    click(button(container, 'Đổi'));
    submitForm(container);
    expect(alertEl(container)).not.toBeNull();
    typeInto(input(container), 'zz');
    click(button(container, 'Huỷ'));
    click(button(container, 'Đổi'));
    expect(input(container).value).toBe('');
    expect(alertEl(container)).toBeNull();
  });
});

describe('ReferralCodeBox web — xác nhận mã', () => {
  it('chuẩn hoá HOA + bỏ mọi khoảng trắng, xác nhận qua /affiliate/touch rồi báo lên thanh toán', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    const { container, onApplied } = mount();
    openForm(container);
    typeInto(input(container), '  ab12 cd\t34 ');
    submitForm(container);
    await flush();
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    expect(mocks.recordReferralTouch).toHaveBeenCalledWith({ referralCode: 'AB12CD34', kind: 'ctv' });
    expect(onApplied).toHaveBeenCalledWith('AB12CD34');
    expect(input(container)).toBeNull();
  });

  it('bấm nút Áp dụng (submit) cũng xác nhận mã', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    const { container, onApplied } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    click(submitButton(container));
    await flush();
    expect(onApplied).toHaveBeenCalledWith('AB12CD34');
  });

  it('chưa có lỗi: ô nhập không báo aria-invalid/aria-describedby', () => {
    const { container } = mount();
    openForm(container);
    expect(input(container).hasAttribute('aria-invalid')).toBe(false);
    expect(input(container).hasAttribute('aria-describedby')).toBe(false);
  });

  it('ô trống → nhắc nhập, không gọi server, ô nhập aria-invalid và aria-describedby trỏ đúng vùng role=alert', () => {
    const { container, onApplied } = mount();
    openForm(container);
    submitForm(container);
    const alert = alertEl(container)!;
    expect(alert.textContent).toContain('Bạn nhập mã người giới thiệu giúp Tubu nhé');
    expect(alert.getAttribute('id')).toBe('referral-code-error');
    expect(input(container).getAttribute('aria-invalid')).toBe('true');
    expect(input(container).getAttribute('aria-describedby')).toBe('referral-code-error');
    expect(document.getElementById('referral-code-error')).toBe(alert);
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('server trả ok:false (không thấy mã / mã của chính mình) → báo lỗi, không áp dụng, aria nối với lỗi', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: false });
    const { container, onApplied } = mount();
    openForm(container);
    typeInto(input(container), 'ZZZZ9999');
    submitForm(container);
    await flush();
    expect(alertEl(container)!.textContent).toContain('Không tìm thấy mã này');
    expect(input(container).getAttribute('aria-invalid')).toBe('true');
    expect(input(container).getAttribute('aria-describedby')).toBe('referral-code-error');
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('lỗi mạng/máy chủ → hiện thông báo, giữ nguyên chữ đã gõ, aria nối với lỗi, vẫn cho thử lại', async () => {
    mocks.recordReferralTouch.mockRejectedValueOnce(new Error('boom'));
    const { container, onApplied } = mount();
    openForm(container);
    typeInto(input(container), 'AB12CD34');
    submitForm(container);
    await flush();
    expect(alertEl(container)).not.toBeNull();
    expect(input(container).getAttribute('aria-invalid')).toBe('true');
    expect(input(container).getAttribute('aria-describedby')).toBe('referral-code-error');
    expect(input(container).value).toBe('AB12CD34');
    expect(onApplied).not.toHaveBeenCalled();

    mocks.recordReferralTouch.mockResolvedValueOnce({ ok: true });
    submitForm(container);
    await flush();
    expect(onApplied).toHaveBeenCalledWith('AB12CD34');
  });

  it('gõ lại thì lỗi và hai thuộc tính aria biến mất', () => {
    const { container } = mount();
    openForm(container);
    submitForm(container);
    expect(alertEl(container)).not.toBeNull();
    typeInto(input(container), 'a');
    expect(alertEl(container)).toBeNull();
    expect(input(container).hasAttribute('aria-invalid')).toBe(false);
    expect(input(container).hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('ReferralCodeBox web — khoá bận khi đang kiểm tra mã', () => {
  it('đang chờ server: ô nhập + Huỷ + Áp dụng khoá, nút báo aria-busy; gửi lại không gọi server lần hai', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    const { container, onApplied } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    submitForm(container);
    await flush();

    expect(input(container).disabled).toBe(true);
    expect(button(container, 'Huỷ').disabled).toBe(true);
    expect(submitButton(container).disabled).toBe(true);
    expect(submitButton(container).getAttribute('aria-busy')).toBe('true');
    expect(submitButton(container).textContent).toContain('Đang kiểm tra');

    submitForm(container);
    click(button(container, 'Huỷ'));
    await flush();
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    expect(input(container)).not.toBeNull();

    await act(async () => {
      gate.resolve({ ok: true });
    });
    await flush();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith('AB12CD34');
  });

  it('server báo lỗi thì mở khoá lại: ô nhập gõ được, Huỷ bấm được, hết aria-busy', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    const { container } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    submitForm(container);
    await flush();
    expect(input(container).disabled).toBe(true);

    await act(async () => {
      gate.reject(new Error('boom'));
    });
    await flush();
    expect(input(container).disabled).toBe(false);
    expect(button(container, 'Huỷ').disabled).toBe(false);
    expect(submitButton(container).disabled).toBe(false);
    expect(submitButton(container).hasAttribute('aria-busy')).toBe(false);
    expect(submitButton(container).textContent).toContain('Áp dụng');
  });

  it('lỗi xong thì focus về ô nhập (Chromium thả focus khi ô bị khoá lúc kiểm tra; jsdom không, nên đẩy focus sang nút phụ)', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    const { container } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    input(container).focus();
    submitForm(container);
    await flush();
    expect(input(container).disabled).toBe(true);
    const sink = dropFocusElsewhere();
    expect(document.activeElement).toBe(sink);

    await act(async () => {
      gate.resolve({ ok: false });
    });
    await flush();
    expect(alertEl(container)).not.toBeNull();
    expect(document.activeElement).toBe(input(container));
    sink.remove();
  });

  it('nút Áp dụng lúc rảnh không mang aria-busy', () => {
    const { container } = mount();
    openForm(container);
    expect(submitButton(container).hasAttribute('aria-busy')).toBe(false);
  });

  it('Huỷ lúc rảnh đóng ô nhập, về dòng mời nhập', () => {
    const { container } = mount();
    openForm(container);
    click(button(container, 'Huỷ'));
    expect(input(container)).toBeNull();
    expect(button(container, 'Nhập mã')).toBeDefined();
  });
});

describe('ReferralCodeBox web — khoá đồng bộ chống bấm đúp', () => {
  // Hai cú bấm trong CÙNG một act: React chưa vẽ lại giữa chúng nên `checking` (state) vẫn còn false ở cả hai.
  const twice = (...actions: (() => void)[]) =>
    act(() => {
      actions.forEach((a) => a());
    });

  it('hai cú bấm "Áp dụng" sát nhau, chưa kịp vẽ lại: chỉ gọi /affiliate/touch một lần, nút báo aria-busy', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    const { container, onApplied } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    const submit = submitButton(container);
    twice(() => submit.click(), () => submit.click());
    await flush();
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    expect(submitButton(container).getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      gate.resolve({ ok: true });
    });
    await flush();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('bấm "Áp dụng" rồi Enter (gửi form) sát nhau: chỉ gọi một lần', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    const { container } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    twice(
      () => submitButton(container).click(),
      () => form(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await flush();
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ ok: false });
    });
    await flush();
  });

  it('Enter hai lần liền (không phải giữ phím) trong cùng một khung hình: chỉ gọi một lần', async () => {
    const gate = deferred<{ ok: boolean }>();
    mocks.recordReferralTouch.mockReturnValue(gate.promise);
    const { container } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    const send = () => form(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    twice(send, send);
    await flush();
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ ok: false });
    });
    await flush();
  });

  it('lỗi mạng thì nhả khoá, mã không tìm thấy (ok:false) cũng nhả: bấm lại gọi lần hai rồi lần ba, lần ba thành công', async () => {
    mocks.recordReferralTouch
      .mockRejectedValueOnce(new Error('mạng'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });
    const { container, onApplied } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    click(submitButton(container));
    await flush();
    expect(alertEl(container)).not.toBeNull();
    click(submitButton(container));
    await flush();
    expect(alertEl(container)!.textContent).toContain('Không tìm thấy mã này');
    click(submitButton(container));
    await flush();
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(3);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith('AB12CD34');
  });

  it('ô trống không giữ khoá: gõ mã rồi bấm lại thì gọi được', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    const { container } = mount();
    openForm(container);
    twice(() => submitButton(container).click());
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
    expect(alertEl(container)).not.toBeNull();
    typeInto(input(container), 'ab12cd34');
    click(submitButton(container));
    await flush();
    expect(mocks.recordReferralTouch).toHaveBeenCalledTimes(1);
  });
});

describe('ReferralCodeBox web — prop disabled khi đơn đang gửi', () => {
  it('thu gọn: nút Nhập mã bị khoá, bấm không mở ô nhập', () => {
    const { container } = mount({ disabled: true });
    expect(button(container, 'Nhập mã').disabled).toBe(true);
    click(button(container, 'Nhập mã'));
    expect(input(container)).toBeNull();
  });

  it('mặc định không khoá: nút Nhập mã bấm được', () => {
    const { container } = mount();
    expect(button(container, 'Nhập mã').disabled).toBe(false);
  });

  it('đã áp dụng: nút Đổi bị khoá, bấm không mở ô nhập; mã vẫn hiện', () => {
    const { container } = mount({ appliedCode: 'AB12CD34', disabled: true });
    expect(button(container, 'Đổi').disabled).toBe(true);
    click(button(container, 'Đổi'));
    expect(input(container)).toBeNull();
    expect(container.textContent).toContain('AB12CD34');
  });

  it('đã áp dụng, không khoá: nút Đổi bấm được', () => {
    const { container } = mount({ appliedCode: 'AB12CD34' });
    expect(button(container, 'Đổi').disabled).toBe(false);
  });

  it('đang mở ô nhập mà đơn bắt đầu gửi: ô nhập + Huỷ + Áp dụng khoá, gửi form không gọi server; hết gửi thì mở lại', () => {
    const { container, rerender } = mount();
    openForm(container);
    typeInto(input(container), 'ab12cd34');
    rerender({ disabled: true });

    expect(input(container).disabled).toBe(true);
    expect(button(container, 'Huỷ').disabled).toBe(true);
    expect(submitButton(container).disabled).toBe(true);
    submitForm(container);
    click(button(container, 'Huỷ'));
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
    expect(input(container)).not.toBeNull();

    rerender({ disabled: false });
    expect(input(container).disabled).toBe(false);
    expect(button(container, 'Huỷ').disabled).toBe(false);
    expect(submitButton(container).disabled).toBe(false);
  });
});
