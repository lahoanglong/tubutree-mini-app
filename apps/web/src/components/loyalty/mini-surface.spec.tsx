// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { miniBtnSecondary, miniCard, miniOutline, MiniTitleBar } from './mini-surface';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('bề mặt kiểu Mini App ở điện thoại', () => {
  it('thẻ: nền trắng, đổ bóng, viền chỉ từ md', () => {
    expect(miniCard).toContain('bg-stone-0');
    expect(miniCard).toContain('shadow-card');
    expect(miniCard).toContain('md:border');
    expect(miniCard.split(' ')).not.toContain('border');
  });

  it('thẻ viền: có viền, bóng chỉ từ md', () => {
    expect(miniOutline.split(' ')).toContain('border');
    expect(miniOutline).toContain('max-md:shadow-none');
  });

  it('nút phụ: giữ nút viền của máy tính, dưới md đổi sang nền xanh nhạt không viền như ZaUI secondary', () => {
    expect(miniBtnSecondary).toContain('border-stone-450');
    expect(miniBtnSecondary).toContain('max-md:border-transparent');
    expect(miniBtnSecondary).toContain('max-md:bg-forest-50');
    expect(miniBtnSecondary).toContain('max-md:text-forest-700');
  });

  it('thanh tiêu đề: nền trắng tràn ngang dưới md, chừa chỗ cho nút lùi', () => {
    const r = render(
      <MiniTitleBar>
        <h1>Ví</h1>
      </MiniTitleBar>,
    );
    mounted.push(r);
    const bar = r.container.firstElementChild!;
    expect(bar.className).toContain('max-md:bg-stone-0');
    expect(bar.className).toContain('max-md:pl-16');
  });
});
