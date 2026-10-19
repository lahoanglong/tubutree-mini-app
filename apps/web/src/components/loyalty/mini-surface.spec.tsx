// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { miniBleed, miniBtnSecondary, miniCard, miniOutline, miniSectionTitle, MiniBar, MiniTitleBar } from './mini-surface';

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

  it('khối tràn ngang: bỏ bo, viền, bóng và bù lề cha ở điện thoại', () => {
    for (const c of ['max-md:-mx-4', 'max-md:rounded-none', 'max-md:border-0', 'max-md:shadow-none']) expect(miniBleed).toContain(c);
  });

  it('nút phụ: giữ nút viền của máy tính, dưới md đổi sang nền xanh nhạt không viền như ZaUI secondary', () => {
    expect(miniBtnSecondary).toContain('border-stone-450');
    expect(miniBtnSecondary).toContain('max-md:border-transparent');
    expect(miniBtnSecondary).toContain('max-md:bg-forest-50');
    expect(miniBtnSecondary).toContain('max-md:text-forest-700');
    expect(miniBtnSecondary).toContain('max-md:disabled:bg-stone-200');
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

  it('thanh nền trắng cho tiêu đề tự đệm: không thêm đệm dọc hay đệm trái', () => {
    const r = render(
      <MiniBar>
        <h1>Hoàn tiền</h1>
      </MiniBar>,
    );
    mounted.push(r);
    const bar = r.container.firstElementChild!;
    expect(bar.className).toContain('max-md:bg-stone-0');
    expect(bar.className).not.toContain('max-md:py-3');
    expect(bar.className).not.toContain('max-md:pl-16');
  });
});

describe('tiêu đề khối và MiniBar chừa chỗ nút lùi', () => {
  it('tiêu đề khối cỡ title-sm ở điện thoại', () => {
    expect(miniSectionTitle).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });

  it('MiniBar clearBack chừa 64px bên trái cho nút lùi nổi khi tiêu đề chưa tự chừa', () => {
    const r = render(
      <MiniBar clearBack>
        <h1>Cộng đồng</h1>
      </MiniBar>,
    );
    mounted.push(r);
    const cls = r.container.firstElementChild!.className;
    expect(cls).toContain('max-md:pl-16');
    expect(cls).not.toContain('max-md:px-4');
  });
});
