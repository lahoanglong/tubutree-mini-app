// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ImageUrlField, previewableImageUrl } from './image-url-field';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function Harness({ initial = '', shape = 'avatar', onChange }: { initial?: string; shape?: 'avatar' | 'cover'; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ImageUrlField
      id="logo"
      label="URL Logo thương hiệu"
      value={value}
      shape={shape}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const mount = (props: Parameters<typeof Harness>[0] = {}) => {
  mounted = render(<Harness {...props} />);
  return mounted.container;
};
const img = (root: ParentNode) => root.querySelector('img');
const hintText = (root: ParentNode) => root.querySelector('#logo-hint')?.textContent ?? '';

describe('previewableImageUrl', () => {
  it.each([
    ['https://res.cloudinary.com/x/logo.png', 'https://res.cloudinary.com/x/logo.png'],
    ['  https://cdn.tubutree.com/a.jpg  ', 'https://cdn.tubutree.com/a.jpg'],
  ])('%s xem trước được', (raw, expected) => {
    expect(previewableImageUrl(raw)).toBe(expected);
  });

  it.each(['', '   ', 'logo.png', 'http://cdn.tubutree.com/a.jpg', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://x.com/a.png', '//x.com/a.png'])(
    '%j không xem trước',
    (raw) => {
      expect(previewableImageUrl(raw)).toBeNull();
    },
  );
});

describe('ImageUrlField', () => {
  it('nhãn gắn đúng ô nhập theo id, ô nhập chiếm vùng chạm 44px và mở bàn phím URL', () => {
    const root = mount();
    const input = root.querySelector<HTMLInputElement>('input#logo')!;
    expect(root.querySelector('label[for="logo"]')?.textContent).toBe('URL Logo thương hiệu');
    expect(input.className).toContain('min-h-[44px]');
    expect(input.getAttribute('inputmode')).toBe('url');
    expect(input.placeholder).toBe('https://...');
  });

  it('chưa có liên kết: không có thẻ img, có dòng gợi ý và không có nút xoá', () => {
    const root = mount();
    expect(img(root)).toBeNull();
    expect(hintText(root)).toContain('Chưa có ảnh');
    expect(root.querySelector('button')).toBeNull();
  });

  it('liên kết hợp lệ: hiện ảnh xem trước (alt theo nhãn, không gửi referrer), ô nhập trỏ tới dòng chú thích', () => {
    const root = mount({ initial: 'https://cdn.tubutree.com/logo.png' });
    const preview = img(root)!;
    expect(preview.getAttribute('src')).toBe('https://cdn.tubutree.com/logo.png');
    expect(preview.getAttribute('alt')).toBe('Xem trước: URL Logo thương hiệu');
    expect(preview.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(root.querySelector('input')!.getAttribute('aria-describedby')).toBe('logo-hint');
  });

  it('gõ liên kết mới thì ảnh xem trước đổi theo, onChange nhận đúng chuỗi người dùng gõ (không cắt khoảng trắng)', () => {
    const onChange = vi.fn();
    const root = mount({ onChange });
    typeInto(root.querySelector('input'), ' https://cdn.tubutree.com/b.png');
    expect(onChange).toHaveBeenLastCalledWith(' https://cdn.tubutree.com/b.png');
    expect(img(root)!.getAttribute('src')).toBe('https://cdn.tubutree.com/b.png');
  });

  it('liên kết http:// bị từ chối (web chạy https nên ảnh http bị chặn mixed content): không dựng img, hiện gợi ý cần https://', () => {
    const root = mount();
    typeInto(root.querySelector('input'), 'http://cdn.tubutree.com/logo.png');
    expect(img(root)).toBeNull();
    expect(hintText(root)).toContain('Liên kết chưa hợp lệ');
    expect(hintText(root)).toContain('https://');
  });

  it('chuỗi không phải liên kết https: không dựng img, báo cần bắt đầu bằng https://', () => {
    const root = mount();
    typeInto(root.querySelector('input'), 'javascript:alert(1)');
    expect(img(root)).toBeNull();
    expect(hintText(root)).toContain('https://');
    expect(hintText(root)).toContain('Liên kết chưa hợp lệ');
  });

  it('ảnh không tải được: báo lỗi thay cho ảnh vỡ; đổi liên kết thì thử tải lại', async () => {
    const root = mount({ initial: 'https://cdn.tubutree.com/hong.png' });
    act(() => {
      img(root)!.dispatchEvent(new Event('error'));
    });
    await flush(1);
    expect(img(root)).toBeNull();
    expect(hintText(root)).toContain('Không tải được ảnh từ liên kết này');

    typeInto(root.querySelector('input'), 'https://cdn.tubutree.com/tot.png');
    expect(img(root)!.getAttribute('src')).toBe('https://cdn.tubutree.com/tot.png');
    expect(hintText(root)).not.toContain('Không tải được');
  });

  it('nút "Xoá ảnh" chỉ có khi đã nhập, xoá sạch ô nhập và trả về dòng gợi ý ban đầu', () => {
    const onChange = vi.fn();
    const root = mount({ initial: 'https://cdn.tubutree.com/logo.png', onChange });
    const btn = root.querySelector<HTMLButtonElement>('button')!;
    expect(btn.textContent).toBe('Xoá ảnh');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.className).toContain('min-h-[44px]');
    click(btn);
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(root.querySelector<HTMLInputElement>('input')!.value).toBe('');
    expect(img(root)).toBeNull();
    expect(root.querySelector('button')).toBeNull();
  });

  it('ảnh bìa dùng khung ngang, logo dùng khung vuông', () => {
    const cover = mount({ initial: 'https://cdn.tubutree.com/c.png', shape: 'cover' });
    expect(cover.querySelector('[data-preview]')!.className).toContain('aspect-[3/1]');
    mounted!.unmount();
    mounted = null;
    const avatar = mount({ initial: 'https://cdn.tubutree.com/a.png', shape: 'avatar' });
    expect(avatar.querySelector('[data-preview]')!.className).toContain('h-16');
    expect(avatar.querySelector('[data-preview]')!.className).toContain('w-16');
  });
});
