// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedCategory } from '@tubutree/app-core/api/feed';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unlabeledFields } from '@/test-utils/a11y';

// Chép ý post-composer.spec.tsx (Mini App): nút Đăng khoá tới khi đủ tiêu đề + nội dung, body gửi đúng (trim, thẻ tách dấu phẩy,
// bỏ # và trùng, ảnh + sản phẩm + danh mục), loại Trải nghiệm không có tiêu đề, bấm lại danh mục thì bỏ chọn, bài chờ duyệt,
// dự thi gửi kèm eventId, gỡ thẻ nhập.

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post, get: vi.fn() } }));
vi.mock('./image-upload', () => ({
  ImageUpload: ({ onChange, onBusyChange, disabled }: { onChange: (v: string[]) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => (
    <>
      <button type="button" onClick={() => onChange(['https://img/1.jpg'])}>
        stub-them-anh
      </button>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        stub-bat-dau-tai
      </button>
      <button type="button" onClick={() => onBusyChange?.(false)}>
        stub-tai-xong
      </button>
      <output data-testid="slot-disabled">{String(disabled)}</output>
    </>
  ),
}));
vi.mock('./product-picker', () => ({
  ProductPicker: ({ onChange }: { onChange: (v: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange([{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén', thumbnail: null, basePrice: 89_000 }])}>
      stub-gan-san-pham
    </button>
  ),
}));

import { PostComposer } from './post-composer';

const CATS: FeedCategory[] = [
  { id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null },
  { id: 'c2', slug: 'vuon', name: 'Vườn', icon: null },
];

let mounted: Rendered[] = [];
const onPosted = vi.fn();
const onClose = vi.fn();
const mount = (props: Partial<Parameters<typeof PostComposer>[0]> = {}) => {
  const r = render(<PostComposer open onClose={onClose} categories={CATS} onPosted={onPosted} {...props} />);
  mounted.push(r);
  return r;
};
const dlg = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const titleInput = () => dlg().querySelector<HTMLInputElement>('input[aria-label^="Tiêu đề câu hỏi"]');
const bodyInput = () => dlg().querySelector<HTMLTextAreaElement>('textarea')!;
const tagsInput = () => dlg().querySelector<HTMLInputElement>('input[aria-label="Thẻ (hashtag)"]')!;
const submitBtn = () => byText(dlg(), 'button', 'Đăng') as HTMLButtonElement;
const chip = (text: string) => Array.from(dlg().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text)!;

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({ id: 'p1', status: 'APPROVED' });
  onPosted.mockReset();
  onClose.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PostComposer', () => {
  it('mở ở loại Hỏi đáp: có ô tiêu đề, nút Đăng khoá tới khi có tiêu đề + nội dung', () => {
    mount();
    expect(titleInput()).not.toBeNull();
    expect(submitBtn().disabled).toBe(true);
    typeInto(bodyInput(), 'Nội dung');
    expect(submitBtn().disabled).toBe(true);
    expect(dlg().textContent).toContain('Câu hỏi cần có tiêu đề');
    typeInto(titleInput(), 'Tiêu đề');
    expect(submitBtn().disabled).toBe(false);
  });

  it('đăng câu hỏi gửi đúng body: trim, thẻ tách dấu phẩy bỏ # và trùng, kèm ảnh, sản phẩm, danh mục', async () => {
    mount();
    typeInto(titleInput(), '  Tiêu đề  ');
    typeInto(bodyInput(), '  Nội dung  ');
    typeInto(tagsInput(), '#da nhạy cảm, Da Nhạy Cảm, đồ cho bé ,, ');
    click(chip('Nhà bếp'));
    click(byText(dlg(), 'button', 'stub-them-anh'));
    click(byText(dlg(), 'button', 'stub-gan-san-pham'));
    click(submitBtn());
    await flush();
    expect(mocks.post).toHaveBeenCalledWith('/feed', {
      kind: 'QUESTION',
      categoryId: 'c1',
      title: 'Tiêu đề',
      body: 'Nội dung',
      images: ['https://img/1.jpg'],
      productSlugs: ['nuoc-rua-chen'],
      tagSlugs: ['da nhạy cảm', 'đồ cho bé'],
      eventId: undefined,
    });
    expect(onPosted).toHaveBeenCalledWith('Đã đăng bài 🌿');
  });

  it('tối đa 5 thẻ', async () => {
    mount();
    typeInto(titleInput(), 'T');
    typeInto(bodyInput(), 'N');
    typeInto(tagsInput(), 'a,b,c,d,e,f,g');
    click(submitBtn());
    await flush();
    expect(mocks.post.mock.calls[0]![1].tagSlugs).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('đổi sang Trải nghiệm: ẩn ô tiêu đề, chỉ cần nội dung, không gửi tiêu đề', async () => {
    mount();
    click(chip('Trải nghiệm'));
    expect(titleInput()).toBeNull();
    typeInto(bodyInput(), 'Khoe vườn');
    click(submitBtn());
    await flush();
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ kind: 'SHOWCASE', title: undefined, body: 'Khoe vườn', images: undefined, tagSlugs: undefined, productSlugs: [] });
  });

  it('bấm lại danh mục đang chọn thì bỏ chọn', async () => {
    mount();
    typeInto(titleInput(), 'T');
    typeInto(bodyInput(), 'N');
    click(chip('Vườn'));
    expect(chip('Vườn').getAttribute('aria-pressed')).toBe('true');
    click(chip('Vườn'));
    expect(chip('Vườn').getAttribute('aria-pressed')).toBe('false');
    click(submitBtn());
    await flush();
    expect(mocks.post.mock.calls[0]![1].categoryId).toBeUndefined();
  });

  it('bài chờ duyệt: báo "Bài đang chờ duyệt…"', async () => {
    mocks.post.mockResolvedValue({ id: 'p2', status: 'PENDING' });
    mount();
    typeInto(titleInput(), 'T');
    typeInto(bodyInput(), 'N');
    click(submitBtn());
    await flush();
    expect(onPosted).toHaveBeenCalledWith('Bài đang chờ duyệt, sẽ hiện sau khi được duyệt 🌱');
  });

  it('mở từ sự kiện: mặc định Trải nghiệm, hiện "Dự thi: …" và gửi kèm eventId', async () => {
    mount({ eventId: 'e1', eventTitle: 'Thi vườn xanh' });
    expect(dlg().textContent).toContain('Dự thi: Thi vườn xanh');
    expect(chip('Trải nghiệm').getAttribute('aria-pressed')).toBe('true');
    typeInto(bodyInput(), 'Bài dự thi');
    click(submitBtn());
    await flush();
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ kind: 'SHOWCASE', eventId: 'e1' });
  });

  it('thẻ nhập có nút gỡ', async () => {
    mount();
    typeInto(titleInput(), 'T');
    typeInto(bodyInput(), 'N');
    typeInto(tagsInput(), 'sen đá, bonsai');
    click(dlg().querySelector('button[aria-label="Gỡ thẻ sen đá"]'));
    click(submitBtn());
    await flush();
    expect(mocks.post.mock.calls[0]![1].tagSlugs).toEqual(['bonsai']);
  });

  it('lỗi gửi: hiện lỗi trong khung soạn, giữ nội dung, không gọi onPosted', async () => {
    mocks.post.mockRejectedValue(new Error('Bài viết chứa nội dung không được phép'));
    mount();
    typeInto(titleInput(), 'T');
    typeInto(bodyInput(), 'N');
    click(submitBtn());
    await flush();
    expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('Bài viết chứa nội dung không được phép');
    expect(bodyInput().value).toBe('N');
    expect(onPosted).not.toHaveBeenCalled();
  });

  it('đóng khung soạn khi open=false', () => {
    mount({ open: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a11y: sheet có tiêu đề "Đăng bài", loại bài và danh mục là nút aria-pressed 44px, ô nhập có nhãn', () => {
    mount();
    expect(dlg().querySelector('h2')?.textContent).toBe('Đăng bài');
    for (const t of ['Hỏi đáp', 'Trải nghiệm', 'Mẹo hay', 'Nhà bếp']) expect(chip(t).hasAttribute('aria-pressed')).toBe(true);
    expect(unlabeledFields(dlg())).toEqual([]);
    const small = smallTouchTargets(dlg()).filter((s) => !s.includes('stub-') && !s.includes('type="file"') && !s.includes('hidden'));
    expect(small).toEqual([]);
  });
});

describe('PostComposer — khoá đồng bộ chống đăng hai bài, nút bận giữ focus', () => {
  const fill = () => {
    typeInto(titleInput(), 'Tiêu đề');
    typeInto(bodyInput(), 'Nội dung');
  };
  // mutationFn chạy sau vài microtask: đếm lời gọi API phải đợi `flush`, nếu không ca "chỉ một lần" đậu suông.
  const twice = async (el: HTMLElement) => {
    act(() => {
      el.click();
      el.click();
    });
    await flush(2);
  };
  const sendingBtn = () => byText(dlg(), 'button', /^(Đăng|Đang đăng…)$/) as HTMLButtonElement;

  it('chạm đúp "Đăng" cùng khung hình chỉ đăng MỘT bài; nút báo aria-busy, không disabled, giữ focus', async () => {
    mocks.post.mockReturnValue(new Promise(() => {}));
    mount();
    fill();
    submitBtn().focus();
    await twice(submitBtn());
    expect(mocks.post).toHaveBeenCalledTimes(1);
    const b = sendingBtn();
    expect(b.textContent).toBe('Đang đăng…');
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    expect(document.activeElement).toBe(b);
  });

  it('đang đăng thì không đóng được khung (không có nút Đóng, Esc không đóng) để lỗi không rơi vào khung đã đóng', async () => {
    mocks.post.mockReturnValue(new Promise(() => {}));
    mount();
    fill();
    expect(dlg().querySelector('button[aria-label="Đóng"]')).not.toBeNull();
    click(submitBtn());
    await flush(2);
    expect(dlg().querySelector('button[aria-label="Đóng"]')).toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('đăng xong: gọi onPosted đúng một lần, nội dung được xoá, nút về "Đăng" và khoá', async () => {
    mount();
    fill();
    await twice(submitBtn());
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(onPosted).toHaveBeenCalledTimes(1);
    expect(bodyInput().value).toBe('');
    expect(submitBtn().disabled).toBe(true);
    expect(submitBtn().hasAttribute('aria-busy')).toBe(false);
  });

  it('lỗi nhả khoá: lỗi hiện trên cùng vùng alert, giữ nội dung, bấm lại đăng lần hai thành công', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Máy chủ bận'));
    mount();
    const alertBox = dlg().querySelector('[role="alert"]')!;
    expect(alertBox.textContent).toBe('');
    fill();
    click(submitBtn());
    await flush(4);
    expect(dlg().querySelector('[role="alert"]')).toBe(alertBox);
    expect(alertBox.textContent).toContain('Máy chủ bận');
    expect(bodyInput().value).toBe('Nội dung');
    expect(sendingBtn().hasAttribute('aria-busy')).toBe(false);
    expect(dlg().querySelector('button[aria-label="Đóng"]')).not.toBeNull();
    await twice(submitBtn());
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(onPosted).toHaveBeenCalledTimes(1);
  });

  it('bài dự thi: chạm đúp cùng khung hình chỉ gửi MỘT bài kèm eventId', async () => {
    mocks.post.mockReturnValue(new Promise(() => {}));
    mount({ eventId: 'e1', eventTitle: 'Thi vườn xanh' });
    typeInto(bodyInput(), 'Bài dự thi');
    await twice(submitBtn());
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ kind: 'SHOWCASE', eventId: 'e1' });
  });
});

describe('PostComposer — nút Đăng khoá lúc ảnh còn đang lên', () => {
  const fill = () => {
    typeInto(titleInput(), 'Tiêu đề');
    typeInto(bodyInput(), 'Nội dung');
  };
  // Nút Đăng đổi chữ theo trạng thái; ô ảnh giả có nút "stub-*" nên chọn theo đúng ba chữ của nút Đăng.
  const postBtn = () => Array.from(dlg().querySelectorAll<HTMLButtonElement>('button')).find((b) => /^(Đăng|Đang đăng…|Đang tải ảnh…)$/.test(b.textContent?.trim() ?? ''))!;
  const stub = (name: string) => click(byText(dlg(), 'button', name));

  it('ảnh đang lên: nút báo aria-busy + aria-disabled, đổi chữ, bấm không gọi API; ảnh xong thì nhả và đăng kèm ảnh', async () => {
    mount();
    fill();
    stub('stub-them-anh');
    stub('stub-bat-dau-tai');
    const busy = postBtn();
    expect(busy.textContent).toBe('Đang tải ảnh…');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    click(busy);
    await flush(2);
    expect(mocks.post).not.toHaveBeenCalled();

    stub('stub-tai-xong');
    const idle = postBtn();
    expect(idle.textContent).toBe('Đăng');
    expect(idle.hasAttribute('aria-busy')).toBe(false);
    click(idle);
    await flush(2);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/feed', expect.objectContaining({ images: ['https://img/1.jpg'] }));
  });

  it('hai lượt tải chồng nhau: lượt đầu xong vẫn khoá, chỉ nhả khi lượt cuối xong', async () => {
    mount();
    fill();
    stub('stub-bat-dau-tai');
    stub('stub-bat-dau-tai');
    stub('stub-tai-xong');
    expect(postBtn().textContent).toBe('Đang tải ảnh…');
    click(postBtn());
    await flush(2);
    expect(mocks.post).not.toHaveBeenCalled();
    stub('stub-tai-xong');
    expect(postBtn().textContent).toBe('Đăng');
  });

  it('đang đăng: ô ảnh nhận disabled để ảnh thêm lúc này không lọt vào bài đang gửi', async () => {
    mocks.post.mockReturnValue(new Promise(() => {}));
    mount();
    fill();
    expect(dlg().querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('false');
    click(postBtn());
    await flush(2);
    expect(dlg().querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('true');
  });
});
