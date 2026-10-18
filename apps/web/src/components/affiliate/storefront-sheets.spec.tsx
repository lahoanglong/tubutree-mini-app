// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, typeInto, type Rendered } from '@/test-utils/dom';
import { NewCollectionForm } from './storefront-sheets';

let mounted: Rendered | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const nameInput = () => mounted!.container.querySelector<HTMLInputElement>('input[aria-label^="Tên bộ sưu tập"]')!;
const createBtn = () => Array.from(mounted!.container.querySelectorAll('button')).find((b) => /Tạo bộ sưu tập/.test(b.textContent ?? ''))!;

describe('NewCollectionForm', () => {
  it('tên giới hạn 80 ký tự như DTO', () => {
    mounted = render(<NewCollectionForm onCreate={vi.fn()} pending={false} />);
    expect(nameInput().maxLength).toBe(80);
  });

  it('máy chủ từ chối (không gọi onSuccess): giữ nguyên tên đã gõ để sửa', () => {
    const onCreate = vi.fn();
    mounted = render(<NewCollectionForm onCreate={onCreate} pending={false} />);
    typeInto(nameInput(), 'Bộ sưu tập mùa hè');
    click(createBtn());
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(nameInput().value).toBe('Bộ sưu tập mùa hè');
  });

  it('tạo xong (onSuccess) mới xoá tên', () => {
    const onCreate = vi.fn((_dto: unknown, onSuccess: () => void) => onSuccess());
    mounted = render(<NewCollectionForm onCreate={onCreate} pending={false} />);
    typeInto(nameInput(), 'Bộ sưu tập mùa hè');
    click(createBtn());
    expect(nameInput().value).toBe('');
  });
});
