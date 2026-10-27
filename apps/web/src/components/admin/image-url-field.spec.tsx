// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ImageUrlField } from './image-url-field';
import { click, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <ImageUrlField
      label="Ảnh bìa"
      value={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
    />
  );
}

describe('ImageUrlField', () => {
  it('có nút tải ảnh lên và vẫn có ô dán link', () => {
    const r = render(<Harness onChange={() => undefined} />);
    mounted.push(r);
    expect(r.container.querySelector('input[type=file]')).not.toBeNull();
    expect(r.container.textContent).toContain('Chạm để tải ảnh lên');
    expect(r.container.querySelector('input[type=url]')).not.toBeNull();
  });

  it('dán link thì báo giá trị mới; Bỏ ảnh xoá về rỗng', () => {
    const onChange = vi.fn();
    const r = render(<Harness onChange={onChange} />);
    mounted.push(r);
    typeInto(r.container.querySelector('input[type=url]'), 'https://cdn.example.com/a.png');
    expect(onChange).toHaveBeenLastCalledWith('https://cdn.example.com/a.png');
    const clear = [...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Bỏ ảnh');
    click(clear ?? null);
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
