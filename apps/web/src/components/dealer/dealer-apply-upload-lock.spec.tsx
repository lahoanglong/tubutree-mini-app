// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Khoá nút Gửi hồ sơ đại lý lúc ảnh CCCD còn đang lên (Mini ↔ web, Wave 85B ↔ Wave 90A): ô ảnh thật, chỉ giả lượt đọc ảnh.

const m = vi.hoisted(() => ({
  post: vi.fn(),
  reads: [] as { resolve: (url: string) => void }[],
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: m.post, get: vi.fn() } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }), usePathname: () => '/dai-ly', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/image-compress', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readAndCompressImage: () => new Promise<string>((resolve) => m.reads.push({ resolve })),
}));

import { DealerApply } from './dealer-apply';

let mounted: Rendered | null = null;
beforeEach(() => {
  m.post.mockReset().mockResolvedValue({ ok: true });
  m.reads.length = 0;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const mount = () => {
  mounted = render(<DealerApply rejected={false} rejectionReason={null} />);
  return mounted.container;
};
const form = (c: HTMLElement) => c.querySelector('form')!;
// Ô ảnh đang tải cũng mang chữ "Đang tải ảnh…": chọn nút gửi theo type, không theo chữ.
const submitBtn = (c: HTMLElement) => form(c).querySelector<HTMLButtonElement>('button[type="submit"]')!;
const fillText = (c: HTMLElement) => {
  const inputs = Array.from(form(c).querySelectorAll<HTMLInputElement>('input:not([type="file"])'));
  const [business, , owner, phone, address] = inputs;
  typeInto(business!, 'Cửa hàng A');
  typeInto(owner!, 'Nguyễn A');
  typeInto(phone!, '0900000000');
  typeInto(address!, '1 Lê Lợi');
};
const pick = (c: HTMLElement, side: 'trước' | 'sau') => {
  const input = c.querySelector<HTMLInputElement>(`input[aria-label="Chọn ảnh CCCD mặt ${side}"]`)!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], `${side}.jpg`, { type: 'image/jpeg' })] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const finish = async (index: number, url: string) => {
  await act(async () => m.reads[index]!.resolve(url));
  await flush();
};
const submitForm = async (c: HTMLElement) => {
  act(() => {
    form(c).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
};

describe('DealerApply — nút Gửi hồ sơ khoá lúc ảnh CCCD còn đang lên', () => {
  it('một ảnh đang lên: nút báo aria-busy + aria-disabled, đổi chữ; bấm nút và gửi form bằng Enter đều không gọi API; xong thì gửi đủ hai ảnh', async () => {
    const c = mount();
    fillText(c);
    pick(c, 'trước');
    pick(c, 'sau');
    await flush();
    await finish(0, 'data:image/jpeg;base64,TRUOC');
    // Ảnh sau còn lên: đủ chữ, một ảnh đã có, nhưng vẫn khoá.
    const busy = submitBtn(c);
    expect(busy.textContent).toBe('Đang tải ảnh…');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    click(busy);
    await submitForm(c);
    expect(m.post).not.toHaveBeenCalled();

    await finish(1, 'data:image/jpeg;base64,SAU');
    const idle = submitBtn(c);
    expect(idle.textContent).toBe('Gửi hồ sơ đăng ký');
    expect(idle.hasAttribute('aria-busy')).toBe(false);
    click(idle);
    await flush();
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(m.post).toHaveBeenCalledWith('/dealer/apply', expect.objectContaining({ cccdFrontUrl: 'data:image/jpeg;base64,TRUOC', cccdBackUrl: 'data:image/jpeg;base64,SAU' }));
  });

  it('hai ảnh tải cùng lúc: ảnh đầu xong vẫn khoá, chỉ nhả khi ảnh cuối xong', async () => {
    const c = mount();
    fillText(c);
    pick(c, 'trước');
    pick(c, 'sau');
    await flush();
    await finish(1, 'data:image/jpeg;base64,SAU');
    expect(submitBtn(c).textContent).toBe('Đang tải ảnh…');
    await finish(0, 'data:image/jpeg;base64,TRUOC');
    expect(submitBtn(c).textContent).toBe('Gửi hồ sơ đăng ký');
  });

  it('đang gửi: ô ảnh khoá (aria-disabled) để ảnh đổi lúc này không lọt vào hồ sơ đang gửi', async () => {
    m.post.mockReturnValue(new Promise(() => undefined));
    const c = mount();
    fillText(c);
    pick(c, 'trước');
    pick(c, 'sau');
    await flush();
    await finish(0, 'data:image/jpeg;base64,TRUOC');
    await finish(1, 'data:image/jpeg;base64,SAU');
    click(submitBtn(c));
    await flush();
    expect(submitBtn(c).textContent).toBe('Đang gửi…');
    expect(c.querySelector('button[aria-label="Đổi ảnh CCCD mặt trước"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(c.querySelector('button[aria-label="Đổi ảnh CCCD mặt sau"]')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('hồ sơ đã đủ hai ảnh, chọn lại ảnh mờ: Enter (gửi form) lúc ảnh mới còn lên không gửi ảnh cũ; xong thì gửi ảnh mới', async () => {
    const c = mount();
    fillText(c);
    pick(c, 'trước');
    pick(c, 'sau');
    await flush();
    await finish(0, 'data:image/jpeg;base64,TRUOC');
    await finish(1, 'data:image/jpeg;base64,SAU');
    pick(c, 'trước');
    await flush();
    expect(submitBtn(c).textContent).toBe('Đang tải ảnh…');
    await submitForm(c);
    expect(m.post).not.toHaveBeenCalled();
    await finish(2, 'data:image/jpeg;base64,TRUOC2');
    await submitForm(c);
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(m.post).toHaveBeenCalledWith('/dealer/apply', expect.objectContaining({ cccdFrontUrl: 'data:image/jpeg;base64,TRUOC2', cccdBackUrl: 'data:image/jpeg;base64,SAU' }));
  });
});
