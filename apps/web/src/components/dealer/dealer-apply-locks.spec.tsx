// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  user: null as { id: string; fullName: string; phone: string } | null,
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: h.user }) }));
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

import DealerPage from '@/app/dai-ly/dealer-page';

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
  sessionStorage.clear();
  h.calls = [];
  h.user = null;
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

  it('làm mới hỏng rồi gửi lại bị lỗi 500: dòng "Đã gửi hồ sơ" của lần trước được xoá, chỉ còn alert lỗi', async () => {
    h.me = script(NOT_DEALER, () => Promise.reject(new Error('mất mạng')));
    h.post.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new ApiError('Máy chủ bận', 500));
    const c = await mount();
    await fill(c);
    click(submitBtn(c));
    await flush(8);
    expect(statusText(c)).toContain('Đã gửi hồ sơ đăng ký đại lý!');
    click(submitBtn(c));
    await flush(8);
    expect(posts()).toBe(2);
    expect(statusText(c)).not.toContain('Đã gửi hồ sơ đăng ký đại lý!');
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
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

describe('Đăng ký đại lý — nháp trong phiên và gợi ý MST/SĐT', () => {
  const DRAFT_KEY = 'tubu_dealer_apply_draft';
  const blurField = (el: HTMLElement) =>
    act(() => {
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
  const errorOf = (el: HTMLElement) => {
    const id = el.getAttribute('aria-describedby');
    return id ? (document.getElementById(id)?.textContent ?? '') : '';
  };

  it('nháp cũ trong phiên được điền lại; ảnh CCCD không nằm trong nháp', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ businessName: 'Tạp hoá Xanh', taxCode: '0312345678', phone: '0912345678', cccdFrontUrl: 'data:x' }));
    const c = await mount();
    expect(field(c, 'Tên doanh nghiệp / cửa hàng *').value).toBe('Tạp hoá Xanh');
    expect(field(c, 'Mã số thuế').value).toBe('0312345678');
    expect(field(c, 'Số điện thoại *').value).toBe('0912345678');
    expect(c.querySelector('img[src="data:x"]')).toBeNull();
  });

  it('đổi tài khoản trong cùng tab: chữ người trước bị xoá, tên/SĐT của tài khoản mới được điền lại kể cả khi trùng tài khoản cũ', async () => {
    h.user = { id: 'u-a', fullName: 'Nguyễn An', phone: '0901234567' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    mounted = render(<DealerPage />, client);
    await flush(8);
    const c = mounted.container;
    expect(field(c, 'Người đại diện *').value).toBe('Nguyễn An');
    expect(field(c, 'Số điện thoại *').value).toBe('0901234567');
    typeInto(field(c, 'Tên doanh nghiệp / cửa hàng *'), 'Cửa hàng An');
    h.user = { id: 'u-b', fullName: 'Nguyễn An', phone: '0901234567' };
    act(() => mounted!.root.render(<QueryClientProvider client={client}><DealerPage /></QueryClientProvider>));
    await flush(8);
    expect(field(c, 'Tên doanh nghiệp / cửa hàng *').value).toBe('');
    expect(field(c, 'Người đại diện *').value).toBe('Nguyễn An');
    expect(field(c, 'Số điện thoại *').value).toBe('0901234567');
  });

  it('gõ thì lưu nháp chữ; gửi thành công thì xoá nháp', async () => {
    const c = await mount();
    await fill(c);
    await flush(2);
    const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, string>;
    expect(saved).toEqual({ businessName: 'Cửa hàng An', ownerName: 'Nguyễn An', phone: '0901234567', address: '1 Lê Lợi' });
    expect(JSON.stringify(saved)).not.toContain('base64');
    click(submitBtn(c));
    await flush(6);
    expect(posts()).toBe(1);
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('MST sai dáng: gõ dở chưa báo, rời ô thì báo; SĐT sai thì chặn gửi và hiện gợi ý; MST 13 số gửi đi dạng 10-3', async () => {
    const c = await mount();
    await fill(c);
    const tax = field(c, 'Mã số thuế');
    typeInto(tax, '031234');
    await flush(1);
    expect(errorOf(tax)).toBe('');
    blurField(tax);
    await flush(1);
    expect(errorOf(tax)).toContain('Mã số thuế gồm 10 số');
    expect(tax.getAttribute('aria-invalid')).toBe('true');

    typeInto(tax, '0312345678001');
    typeInto(field(c, 'Số điện thoại *'), '0112345678');
    await flush(1);
    expect(errorOf(field(c, 'Số điện thoại *'))).toContain('Số điện thoại chưa đúng');
    click(submitBtn(c));
    await flush(3);
    expect(posts()).toBe(0);

    typeInto(field(c, 'Số điện thoại *'), '0912345678');
    await flush(1);
    expect(errorOf(field(c, 'Số điện thoại *'))).toBe('');
    click(submitBtn(c));
    await flush(6);
    expect(posts()).toBe(1);
    expect(h.post.mock.calls[0]![1]).toMatchObject({ taxCode: '0312345678-001', phone: '0912345678' });
  });
});
