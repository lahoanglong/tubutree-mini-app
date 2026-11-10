// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';
import { loadErrorText } from '@/lib/error-text';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// Gửi hồ sơ đại lý web ↔ Mini (Wave 103A ↔ 89B), trang /dai-ly thật: nút và hai ô ảnh giữ khoá tới khi trạng thái hồ sơ làm mới về (tối đa 4 giây,
// không bao giờ ném); DEALER_APPLICATION_PENDING (hồ sơ đã nhận nhưng mất phản hồi) báo mức thông tin rồi làm mới để sang màn chờ duyệt.

const h = vi.hoisted(() => ({
  calls: [] as string[],
  me: (() => Promise.resolve(null)) as () => Promise<unknown>,
  post: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: null }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dai-ly',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/image-compress', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readAndCompressImage: async () => 'data:image/jpeg;base64,AAAA',
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: (path: string) => {
      h.calls.push(path);
      if (path === '/dealer/me') return h.me();
      return Promise.reject(new Error(`chưa mock ${path}`));
    },
    post: (path: string, body?: unknown) => h.post(path, body),
  },
}));

import DealerPage from '@/app/dai-ly/page';

const NOT_DEALER = { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 };
const PENDING_ME = { ...NOT_DEALER, status: 'PENDING' };
const PENDING_CODE = 'DEALER_APPLICATION_PENDING';
const PENDING_MESSAGE = 'Bạn đã có đơn đăng ký đang chờ duyệt.';

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
/** Mỗi lần gọi trả phần tử kế tiếp (hàm thì gọi để lấy Promise treo/lỗi); hết thì lặp lại phần tử cuối. */
const script = (...replies: unknown[]) => {
  let i = 0;
  return () => {
    const r = replies[Math.min(i++, replies.length - 1)];
    return typeof r === 'function' ? (r as () => Promise<unknown>)() : Promise.resolve(r);
  };
};
const never = () => new Promise<unknown>(() => undefined);

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<DealerPage />);
  await flush(8);
  return mounted.container;
};
const posts = () => h.post.mock.calls.length;
const meGets = () => h.calls.filter((p) => p === '/dealer/me').length;
const submitBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
const field = (c: HTMLElement, label: string) => {
  const l = Array.from(c.querySelectorAll('label')).find((x) => x.textContent === label)!;
  return document.getElementById(l.getAttribute('for')!) as HTMLInputElement;
};
const pickImage = async (c: HTMLElement, side: 'trước' | 'sau') => {
  const input = c.querySelector<HTMLInputElement>(`input[aria-label="Chọn ảnh CCCD mặt ${side}"]`)!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], `${side}.jpg`, { type: 'image/jpeg' })] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush(3);
};
const imageButtons = (c: HTMLElement) => ['trước', 'sau'].map((s) => c.querySelector<HTMLButtonElement>(`button[aria-label="Đổi ảnh CCCD mặt ${s}"]`)!);
/** Điền đủ hồ sơ để nút Gửi không còn `disabled` cứng. */
const fill = async (c: HTMLElement) => {
  typeInto(field(c, 'Tên doanh nghiệp / cửa hàng *'), 'Cửa hàng An');
  typeInto(field(c, 'Người đại diện *'), 'Nguyễn An');
  typeInto(field(c, 'Số điện thoại *'), '0901234567');
  typeInto(field(c, 'Địa chỉ kinh doanh *'), '1 Lê Lợi');
  await pickImage(c, 'trước');
  await pickImage(c, 'sau');
};
const tapTogether = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const e of els) e.click();
  });
};
const statusText = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="status"]')).map((e) => e.textContent).join('|');

beforeEach(() => {
  h.calls = [];
  h.me = script(NOT_DEALER);
  h.post.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('Gửi hồ sơ đại lý — khoá tới khi trạng thái hồ sơ làm mới về', () => {
  it('thành công: nút và hai ô ảnh giữ khoá (aria-busy/aria-disabled, nút không disabled, vẫn giữ focus) tới khi hồ sơ mới về; chạm thêm không gửi hồ sơ thứ hai; về PENDING thì sang màn chờ duyệt', async () => {
    const refreshed = gate<unknown>();
    h.me = script(NOT_DEALER, () => refreshed.promise);
    const c = await mount();
    await fill(c);
    const submit = submitBtn(c);
    submit.focus();
    click(submit);
    await flush(6);
    expect(posts()).toBe(1);
    expect(meGets()).toBe(2);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe('Đang gửi…');
    expect(document.activeElement).toBe(submit);
    expect(imageButtons(c).map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    expect(statusText(c)).toContain('Đã gửi hồ sơ đăng ký đại lý!');
    await tapTogether(submit, submit);
    expect(posts()).toBe(1);
    expect(meGets()).toBe(2);
    refreshed.resolve(PENDING_ME);
    await flush(8);
    expect(c.textContent).toContain('Hồ sơ đang được duyệt');
    expect(c.querySelector('form')).toBeNull();
    expect(posts()).toBe(1);
  });

  it('hai cú chạm cùng khung hình (và Enter + chạm nút) chỉ gửi một hồ sơ', async () => {
    h.post.mockReturnValue(never());
    const c = await mount();
    await fill(c);
    const submit = submitBtn(c);
    await tapTogether(submit, submit);
    expect(posts()).toBe(1);
    await act(async () => {
      c.querySelector('form')!.requestSubmit();
      submit.click();
    });
    expect(posts()).toBe(1);
  });

  it('làm mới hỏng: không có promise bị từ chối bỏ rơi, khoá nhả, form giữ nguyên chữ đã gõ', async () => {
    h.me = script(NOT_DEALER, () => Promise.reject(new Error('mất mạng')));
    const c = await mount();
    await fill(c);
    const seen = await captureUnhandledRejections(async () => {
      click(submitBtn(c));
      await flush(8);
    });
    expect(seen).toEqual([]);
    expect(meGets()).toBe(2);
    expect(submitBtn(c).hasAttribute('aria-busy')).toBe(false);
    expect(field(c, 'Số điện thoại *').value).toBe('0901234567');
  });

  describe('làm mới không bao giờ về: nhả khoá sau 4 giây', () => {
    beforeEach(() => {
      // shouldAdvanceTime để `flush` (setTimeout 0) và bộ đếm giờ của react-query vẫn chạy; chỉ cần giả setTimeout để tua tới hạn.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });
    afterEach(() => vi.useRealTimers());
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    it('thành công: còn khoá ở 3 giây (chạm thêm không gửi hồ sơ), nhả sau 4 giây dù hồ sơ chưa về', async () => {
      h.me = script(NOT_DEALER, never);
      const c = await mount();
      await fill(c);
      const submit = submitBtn(c);
      click(submit);
      await flush(6);
      expect(posts()).toBe(1);
      await advance(3_000);
      expect(submit.getAttribute('aria-busy')).toBe('true');
      await tapTogether(submit, submit);
      expect(posts()).toBe(1);
      await advance(1_500);
      await flush(4);
      expect(submit.hasAttribute('aria-busy')).toBe(false);
      expect(imageButtons(c).map((b) => b.hasAttribute('aria-disabled'))).toEqual([false, false]);
      expect(statusText(c)).toContain('Đã gửi hồ sơ đăng ký đại lý!');
    });

    it('DEALER_APPLICATION_PENDING: còn khoá ở 3 giây, nhả sau 4 giây dù hồ sơ chưa về', async () => {
      h.me = script(NOT_DEALER, never);
      h.post.mockRejectedValue(new ApiError(PENDING_MESSAGE, 400, PENDING_CODE));
      const c = await mount();
      await fill(c);
      const submit = submitBtn(c);
      click(submit);
      await flush(6);
      expect(posts()).toBe(1);
      expect(meGets()).toBe(2);
      await advance(3_000);
      expect(submit.getAttribute('aria-busy')).toBe('true');
      await tapTogether(submit, submit);
      expect(posts()).toBe(1);
      await advance(1_500);
      await flush(4);
      expect(submit.hasAttribute('aria-busy')).toBe(false);
      // Khoá nhả mà hồ sơ chưa đổi trạng thái: form còn đó với lời báo mức thông tin, không biến thành lỗi.
      expect(c.querySelector('[role="alert"]')).toBeNull();
      expect(statusText(c)).toContain(PENDING_MESSAGE);
    });
  });
});

describe('Gửi hồ sơ đại lý — DEALER_APPLICATION_PENDING (hồ sơ đã nhận nhưng mất phản hồi)', () => {
  it('báo mức thông tin (role="status", không phải alert), làm mới hồ sơ và giữ khoá tới khi sang màn chờ duyệt', async () => {
    const refreshed = gate<unknown>();
    h.me = script(NOT_DEALER, () => refreshed.promise);
    h.post.mockRejectedValue(new ApiError(PENDING_MESSAGE, 400, PENDING_CODE));
    const c = await mount();
    await fill(c);
    const submit = submitBtn(c);
    click(submit);
    await flush(6);
    expect(posts()).toBe(1);
    expect(meGets()).toBe(2);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    const info = Array.from(c.querySelectorAll('[role="status"] p')).find((p) => p.textContent === PENDING_MESSAGE);
    expect(info).toBeDefined();
    expect(info!.className).toContain('text-info-fg');
    expect(statusText(c)).not.toContain('Đã gửi hồ sơ đăng ký đại lý!');
    expect(submit.getAttribute('aria-busy')).toBe('true');
    await tapTogether(submit, submit);
    expect(posts()).toBe(1);
    expect(meGets()).toBe(2);
    refreshed.resolve(PENDING_ME);
    await flush(8);
    expect(c.textContent).toContain('Hồ sơ đang được duyệt');
    expect(c.querySelector('form')).toBeNull();
    expect(posts()).toBe(1);
  });

  it('làm mới hỏng cũng không có promise bị từ chối bỏ rơi, khoá nhả', async () => {
    h.me = script(NOT_DEALER, () => Promise.reject(new Error('mất mạng')));
    h.post.mockRejectedValue(new ApiError(PENDING_MESSAGE, 400, PENDING_CODE));
    const c = await mount();
    await fill(c);
    const seen = await captureUnhandledRejections(async () => {
      click(submitBtn(c));
      await flush(8);
    });
    expect(seen).toEqual([]);
    expect(meGets()).toBe(2);
    expect(submitBtn(c).hasAttribute('aria-busy')).toBe(false);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(statusText(c)).toContain(PENDING_MESSAGE);
  });

  it('gửi lại sau lời báo "đã nhận": lời báo cũ được xoá, thành công thì chỉ còn lời "Đã gửi hồ sơ"', async () => {
    h.post.mockRejectedValueOnce(new ApiError(PENDING_MESSAGE, 400, PENDING_CODE));
    const c = await mount();
    await fill(c);
    click(submitBtn(c));
    await flush(8);
    expect(statusText(c)).toContain(PENDING_MESSAGE);
    expect(submitBtn(c).hasAttribute('aria-busy')).toBe(false);
    click(submitBtn(c));
    await flush(8);
    expect(posts()).toBe(2);
    expect(statusText(c)).not.toContain(PENDING_MESSAGE);
    expect(statusText(c)).toContain('Đã gửi hồ sơ đăng ký đại lý!');
  });
});

describe('Gửi hồ sơ đại lý — lỗi khác: role="alert", không làm mới hồ sơ, nhả khoá để gửi lại', () => {
  it.each([
    ['400 mang mã nghiệp vụ khác', new ApiError('Số điện thoại đã đăng ký đại lý.', 400, 'PHONE_TAKEN')],
    ['400 không có mã', new ApiError('Ảnh CCCD chưa hợp lệ.', 400)],
    ['máy chủ bận (500)', new ApiError('Internal error', 500)],
    ['mất mạng', new NetworkError(false)],
  ])('%s', async (_label, error) => {
    h.post.mockRejectedValue(error);
    const c = await mount();
    await fill(c);
    click(submitBtn(c));
    await flush(8);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(loadErrorText(error));
    expect(statusText(c)).toBe('');
    expect(meGets()).toBe(1);
    const submit = submitBtn(c);
    expect(submit.hasAttribute('aria-busy')).toBe(false);
    click(submit);
    await flush(4);
    expect(posts()).toBe(2);
  });
});

describe('Gửi hồ sơ đại lý — "Thử lại" khi tải hồ sơ lỗi trả Promise', () => {
  it('chạm đúp cùng khung hình chỉ tải lại một lần; nút báo bận tới khi hồ sơ về, rồi hiện form', async () => {
    const retried = gate<unknown>();
    h.me = script(() => Promise.reject(new Error('Máy chủ bận')), () => retried.promise);
    const c = await mount();
    const retry = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Thử lại')!;
    expect(retry).toBeDefined();
    const seen = await captureUnhandledRejections(async () => {
      await tapTogether(retry, retry);
      await flush(2);
      expect(meGets()).toBe(2);
      expect(retry.getAttribute('aria-busy')).toBe('true');
      retried.resolve(NOT_DEALER);
      await flush(8);
    });
    expect(seen).toEqual([]);
    expect(meGets()).toBe(2);
    expect(c.querySelector('form')).not.toBeNull();
  });
});

describe('Hồ sơ đại lý — số dùng chữ số đều (tabular-nums)', () => {
  it('số điện thoại, mã số thuế, câu mời có % giá sỉ và khối điều kiện/quyền lợi có số giờ duyệt', async () => {
    const c = await mount();
    const withClass = (el: Element | null) => expect(el?.closest('.tabular-nums')).not.toBeNull();
    withClass(field(c, 'Số điện thoại *'));
    withClass(field(c, 'Mã số thuế'));
    const pitch = Array.from(c.querySelectorAll('p')).find((p) => p.textContent?.includes('Giá sỉ đến 45%'));
    expect(pitch).toBeDefined();
    withClass(pitch!);
    withClass(c.querySelector('[data-testid="dealer-conditions"]'));
    expect(c.querySelector('[data-testid="dealer-conditions"]')!.textContent).toContain('24 giờ');
  });

  it('màn chờ duyệt: câu nêu số giờ xét duyệt', async () => {
    h.me = script(PENDING_ME);
    const c = await mount();
    const body = Array.from(c.querySelectorAll('p')).find((p) => p.textContent?.includes('24 giờ'));
    expect(body).toBeDefined();
    expect(body!.closest('.tabular-nums')).not.toBeNull();
  });
});
