// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

// Khoá nút Tạo sự kiện lúc ảnh bìa còn đang lên (Mini ↔ web, Wave 85B ↔ Wave 90A): ImageUrlField và ô ảnh thật, chỉ giả lượt tải lên Cloudinary.

const m = vi.hoisted(() => ({ uploads: [] as { resolve: (url: string | null) => void }[] }));
vi.mock('@/components/account/cloudinary-upload', () => ({
  uploadToCloudinary: () => new Promise<string | null>((resolve) => m.uploads.push({ resolve })),
}));

import { EventsPanel } from './community-events-panel';

let mounted: Rendered | null = null;
let api: ReturnType<typeof mockFetch>;
beforeEach(() => {
  m.uploads.length = 0;
  api = mockFetch({
    '/feed/admin/events': { body: [] },
    '/feed/events': { body: { id: 'e9' } },
    '/config/public': { body: {} },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const created = () => api.calls.filter((c) => c.url.endsWith('/feed/events') && c.init?.method === 'POST');
const mount = async () => {
  mounted = render(<EventsPanel />);
  await flush();
  return mounted.container;
};
const form = (c: HTMLElement) => c.querySelector('form')!;
const createBtn = (c: HTMLElement) => form(c).querySelector<HTMLButtonElement>('button[type="submit"]')!;
const fill = (c: HTMLElement) => {
  typeInto(c.querySelector('[name="eventTitle"]'), 'Thi ảnh');
  typeInto(c.querySelector('[name="eventStart"]'), '2026-12-01T10:00');
  typeInto(c.querySelector('[name="eventEnd"]'), '2026-12-01T12:00');
};
const pickCover = (c: HTMLElement) => {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'bia.jpg', { type: 'image/jpeg' })] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const submitForm = async (c: HTMLElement) => {
  act(() => {
    form(c).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
};

describe('EventsPanel — nút Tạo sự kiện khoá lúc ảnh bìa còn đang lên', () => {
  it('ảnh bìa đang lên: nút khoá và đổi chữ; gửi form (Enter) không tạo; ảnh về thì nhả và tạo kèm đúng ảnh bìa', async () => {
    const c = await mount();
    fill(c);
    expect(createBtn(c).disabled).toBe(false);
    pickCover(c);
    await flush();
    const busy = createBtn(c);
    expect(busy.textContent).toBe('Đang tải ảnh…');
    expect(busy.disabled).toBe(true);
    await submitForm(c);
    expect(created()).toHaveLength(0);

    await act(async () => m.uploads[0]!.resolve('https://res.cloudinary.com/x/bia.jpg'));
    await flush();
    const idle = createBtn(c);
    expect(idle.textContent).toBe('Tạo sự kiện');
    expect(idle.disabled).toBe(false);
    await submitForm(c);
    expect(created()).toHaveLength(1);
    expect(JSON.parse(String(created()[0]!.init!.body))).toMatchObject({ title: 'Thi ảnh', coverUrl: 'https://res.cloudinary.com/x/bia.jpg' });
  });

  it('ảnh bìa tải lỗi: nhả khoá, tạo sự kiện không bìa được', async () => {
    const c = await mount();
    fill(c);
    pickCover(c);
    await flush();
    expect(createBtn(c).textContent).toBe('Đang tải ảnh…');
    await act(async () => m.uploads[0]!.resolve(null));
    await flush();
    expect(createBtn(c).textContent).toBe('Tạo sự kiện');
    expect(createBtn(c).disabled).toBe(false);
  });

  it('đang tạo: ô ảnh bìa khoá (aria-disabled), chọn ảnh lúc này không tải lên', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => (init?.method === 'POST' && url.endsWith('/feed/events') ? new Promise<Response>(() => undefined) : api.fn(url, init))),
    );
    const c = await mount();
    fill(c);
    await submitForm(c);
    expect(createBtn(c).textContent).toBe('Đang tạo…');
    expect(c.querySelector('button[aria-label="Tải ảnh bìa sự kiện lên"]')!.getAttribute('aria-disabled')).toBe('true');
    pickCover(c);
    await flush();
    expect(m.uploads).toHaveLength(0);
  });
});
