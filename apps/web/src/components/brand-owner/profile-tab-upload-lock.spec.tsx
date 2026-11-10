// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { OwnedBrand } from '@tubutree/app-core/api/brand-owner';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Khoá nút Lưu của tab Hồ sơ chủ nhãn lúc ảnh còn đang lên (Mini ↔ web, Wave 85B ↔ Wave 90A): ô ảnh thật, chỉ giả lượt tải lên Cloudinary.

const m = vi.hoisted(() => ({
  patch: vi.fn(),
  uploads: [] as { resolve: (url: string | null) => void }[],
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { patch: m.patch, get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/components/account/cloudinary-upload', () => ({
  uploadToCloudinary: () => new Promise<string | null>((resolve) => m.uploads.push({ resolve })),
}));

import { ProfileTab } from './profile-tab';

const brand: OwnedBrand = {
  id: 'b1',
  slug: 'nhan-mot',
  name: 'Nhãn một',
  logoUrl: 'https://cdn/cu-logo.jpg',
  coverUrl: 'https://cdn/cu-bia.jpg',
  tagline: 'Cũ',
  story: null,
  origin: null,
  isVerified: false,
  isPublished: true,
  followerCount: 0,
  promotions: [],
};

let mounted: Rendered | null = null;
beforeEach(() => {
  m.patch.mockReset().mockResolvedValue(brand);
  m.uploads.length = 0;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const mount = () => {
  mounted = render(<ProfileTab brand={brand} />);
  return mounted.container;
};
// Ô ảnh đang tải cũng mang chữ "Đang tải ảnh…": nút Lưu là nút cuối của thẻ Hồ sơ, không chọn theo chữ.
const saveBtn = (c: HTMLElement) => Array.from(c.querySelector('section')!.querySelectorAll<HTMLButtonElement>('button')).at(-1)!;
const pick = (c: HTMLElement, label: string) => {
  const input = c.querySelector<HTMLInputElement>(`input[aria-label="Chọn ảnh ${label}"]`)!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], `${label}.jpg`, { type: 'image/jpeg' })] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const finish = async (index: number, url: string) => {
  await act(async () => m.uploads[index]!.resolve(url));
  await flush();
};
const input = (c: HTMLElement, label: string) => c.querySelector<HTMLInputElement>(`input[value="${label}"]`)!;

describe('ProfileTab — nút Lưu khoá lúc ảnh còn đang lên', () => {
  it('ảnh đang lên: nút báo aria-busy + aria-disabled, đổi chữ, bấm không gửi; ảnh về thì nhả và gửi đúng ảnh mới', async () => {
    const c = mount();
    await flush();
    pick(c, 'logo');
    await flush();
    const save = saveBtn(c);
    expect(save.textContent).toBe('Đang tải ảnh…');
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(save.getAttribute('aria-disabled')).toBe('true');
    click(save);
    await flush();
    expect(m.patch).not.toHaveBeenCalled();

    await finish(0, 'https://res.cloudinary.com/x/moi-logo.jpg');
    const idle = saveBtn(c);
    expect(idle.textContent).toBe('Lưu thông tin');
    expect(idle.hasAttribute('aria-busy')).toBe(false);
    click(idle);
    await flush();
    expect(m.patch).toHaveBeenCalledTimes(1);
    expect(m.patch).toHaveBeenCalledWith('/brand/owner/me', expect.objectContaining({ logoUrl: 'https://res.cloudinary.com/x/moi-logo.jpg', coverUrl: 'https://cdn/cu-bia.jpg' }));
  });

  it('hai ô ảnh tải cùng lúc: ô đầu xong vẫn khoá, chỉ nhả khi ô cuối xong; bấm Lưu giữa chừng không gửi', async () => {
    const c = mount();
    await flush();
    pick(c, 'logo');
    pick(c, 'bìa');
    await flush();
    expect(m.uploads).toHaveLength(2);
    await finish(0, 'https://res.cloudinary.com/x/logo.jpg');
    expect(saveBtn(c).textContent).toBe('Đang tải ảnh…');
    click(saveBtn(c));
    await flush();
    expect(m.patch).not.toHaveBeenCalled();
    await finish(1, 'https://res.cloudinary.com/x/bia.jpg');
    expect(saveBtn(c).textContent).toBe('Lưu thông tin');
    click(saveBtn(c));
    await flush();
    expect(m.patch).toHaveBeenCalledWith('/brand/owner/me', expect.objectContaining({ logoUrl: 'https://res.cloudinary.com/x/logo.jpg', coverUrl: 'https://res.cloudinary.com/x/bia.jpg' }));
  });

  it('chữ gõ lúc ảnh còn đang lên không bị ảnh về muộn ghi đè; ảnh kia vẫn giữ', async () => {
    const c = mount();
    await flush();
    pick(c, 'logo');
    await flush();
    typeInto(input(c, 'Cũ'), 'Câu mới gõ lúc đợi');
    pick(c, 'bìa');
    await flush();
    await finish(0, 'https://res.cloudinary.com/x/logo.jpg');
    await finish(1, 'https://res.cloudinary.com/x/bia.jpg');
    click(saveBtn(c));
    await flush();
    expect(m.patch).toHaveBeenCalledWith(
      '/brand/owner/me',
      expect.objectContaining({ tagline: 'Câu mới gõ lúc đợi', logoUrl: 'https://res.cloudinary.com/x/logo.jpg', coverUrl: 'https://res.cloudinary.com/x/bia.jpg' }),
    );
  });

  it('đang lưu: ô ảnh khoá (aria-disabled), chọn ảnh lúc này không tải lên', async () => {
    m.patch.mockReturnValue(new Promise(() => undefined));
    const c = mount();
    await flush();
    click(saveBtn(c));
    await flush();
    expect(saveBtn(c).textContent).toBe('Đang lưu…');
    expect(c.querySelector('button[aria-label="Đổi ảnh logo"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(c.querySelector('button[aria-label="Đổi ảnh bìa"]')!.getAttribute('aria-disabled')).toBe('true');
    pick(c, 'logo');
    await flush();
    expect(m.uploads).toHaveLength(0);
  });

  it('ảnh tải lỗi: nhả khoá, nút Lưu dùng lại được', async () => {
    const c = mount();
    await flush();
    pick(c, 'logo');
    await flush();
    expect(saveBtn(c).textContent).toBe('Đang tải ảnh…');
    await act(async () => m.uploads[0]!.resolve(null));
    await flush();
    expect(saveBtn(c).textContent).toBe('Lưu thông tin');
  });

  // Ảnh vừa về và phím gõ rơi vào CÙNG một đợt vẽ: bộ xử lý gõ còn là bản của lần vẽ trước nên chỉ cập nhật dạng hàm mới giữ được ảnh.
  it.each(['tagline', 'origin', 'story'] as const)('gõ %s đúng lúc ảnh vừa về (cùng một đợt vẽ) không làm mất ảnh', async (field) => {
    const c = mount();
    await flush();
    const card = c.querySelector('section')!;
    const fields = {
      tagline: card.querySelectorAll<HTMLInputElement>('input:not([type="file"])')[0]!,
      origin: card.querySelectorAll<HTMLInputElement>('input:not([type="file"])')[1]!,
      story: card.querySelector<HTMLTextAreaElement>('textarea')!,
    };
    const rawType = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    pick(c, 'logo');
    await flush();
    await act(async () => {
      m.uploads[0]!.resolve('https://res.cloudinary.com/x/logo.jpg');
      await new Promise((r) => setTimeout(r, 0));
      rawType(fields[field], 'chữ mới');
    });
    await flush();
    click(saveBtn(c));
    await flush();
    expect(m.patch).toHaveBeenCalledWith('/brand/owner/me', expect.objectContaining({ logoUrl: 'https://res.cloudinary.com/x/logo.jpg', [field]: 'chữ mới' }));
  });
});
