// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { productTrustStrip } from '@tubutree/app-core/commerce/product-trust-strip';
import { describe, expect, it } from 'vitest';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { mount } from './harness';
import { ProductTrustStrip } from './product-trust-strip';

const view = (returnWindowDays: unknown = 7) => productTrustStrip({ fulfillerKind: 'TUBU', returnWindowDays })!;
const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('ProductTrustStrip (web)', () => {
  it('view null (hàng gian hàng tự giao): không vẽ gì', () => {
    expect(mount(<ProductTrustStrip view={null} />).container.innerHTML).toBe('');
  });

  it('một vùng có tên "Cam kết của Tubu Tree…" và ba trụ cột theo thứ tự, chữ lấy từ app-core (cùng chữ với Mini)', () => {
    const { container } = mount(<ProductTrustStrip view={view()} />);
    const strip = q(container, 'product-trust-strip')!;
    expect(strip.tagName).toBe('SECTION');
    expect(strip.getAttribute('aria-label')).toBe('Cam kết của Tubu Tree khi mua sản phẩm này');
    const items = Array.from(strip.querySelectorAll('li'));
    expect(items.map((li) => li.dataset.testid)).toEqual(['trust-pillar-origin', 'trust-pillar-delivery', 'trust-pillar-returns']);
    expect(items.map((li) => li.textContent)).toEqual([
      'Nguồn gốc rõ ràngChọn lọc kỹ từng thương hiệu',
      'Giao hàng cẩn thậnĐóng gói kỹ trước khi giao',
      'Đổi trả dễ dàngHỗ trợ nhanh nếu sản phẩm lỗi',
    ]);
    for (const li of items) expect(li.querySelector('.tubu-trust-icon')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('lối xem chính sách là liên kết thật tới /chinh-sach/doi-tra, tên truy cập đầy đủ, có lớp vùng chạm 44', () => {
    const { container } = mount(<ProductTrustStrip view={view()} />);
    const cta = q(container, 'product-trust-cta') as HTMLAnchorElement;
    expect(cta.tagName).toBe('A');
    expect(cta.getAttribute('href')).toBe('/chinh-sach/doi-tra');
    expect(cta.getAttribute('aria-label')).toBe('Xem chính sách đổi trả của Tubu Tree');
    expect(cta.textContent).toBe('Xem chính sách đổi trả');
    expect(cta.className).toContain('tubu-hit-44');
  });

  it('đổi trả tắt: hai trụ cột, liên kết chuyển sang /chinh-sach/van-chuyen', () => {
    const { container } = mount(<ProductTrustStrip view={view(0)} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('ul')!.dataset.count).toBe('2');
    expect(q(container, 'product-trust-cta')!.getAttribute('href')).toBe('/chinh-sach/van-chuyen');
  });

  it('mọi điều khiển có tên truy cập; không style px, không màu thô, không chữ cấm hay dấu chấm than', () => {
    const { container } = mount(<ProductTrustStrip view={view()} />);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
    expect(container.querySelectorAll('[style]').length).toBe(0);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(container.textContent).not.toContain('!');
    expect(container.textContent).not.toMatch(/hữu cơ|đúng hẹn|chuẩn mát/i);
  });

  describe('cùng số đo với Mini (apps/miniapp/src/css/product-trust.css)', () => {
    const webCss = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const miniCss = readFileSync(resolve(__dirname, '../../../../miniapp/src/css/product-trust.css'), 'utf8');
    // Gộp khoảng trắng trước khi khớp để luật nhóm viết nhiều dòng (`.a,\n.b {`) cũng so được; ký tự đứng trước (`}` hoặc `/` của chú thích) chặn khớp nhầm đuôi của selector dài hơn.
    const flat = (css: string) => css.replace(/\s+/g, ' ');
    const norm = (css: string, sel: string) =>
      (new RegExp(`(?:^|[}/]) ?${sel.replace(/[.[\]()']/g, '\\$&')} \\{([^}]*)\\}`).exec(flat(css))?.[1] ?? '').trim();

    it.each(['.tubu-trust-list', ".tubu-trust-list[data-count='2']", '.tubu-trust-item', '.tubu-trust-icon', '.tubu-trust-title, .tubu-trust-sub', '.tubu-trust-title', '.tubu-trust-sub', '.tubu-trust-cta'])(
      '%s giống hệt Mini',
      (sel) => {
        const web = norm(webCss, sel);
        expect(web).not.toBe('');
        expect(web).toBe(norm(miniCss, sel));
      },
    );

    it('dải điện thoại cùng số đo; từ md bỏ nền và đệm ngang, giữ vùng chạm 44 và chữ không tràn', () => {
      expect(norm(webCss, '.tubu-trust')).toBe(norm(miniCss, '.tubu-trust'));
      expect(webCss).toMatch(/@media \(min-width: 768px\)\s*\{\s*\.tubu-trust\s*\{[^}]*padding:\s*0;[^}]*background:\s*none/);
      expect(norm(webCss, '.tubu-trust-cta')).toContain('min-height: 44px');
      expect(webCss).toMatch(/\.tubu-trust-title,\s*\.tubu-trust-sub\s*\{[^}]*overflow-wrap:\s*anywhere/);
    });
  });
});
