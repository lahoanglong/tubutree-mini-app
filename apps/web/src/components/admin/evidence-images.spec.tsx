// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EvidenceImages, safeEvidenceImage } from './evidence-images';
import { byText, click, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const HTTPS = 'https://res.cloudinary.com/demo/image/upload/v1/returns/a.jpg';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

// C-050 (A5N-05): ảnh minh chứng đổi trả do khách gửi được render và bấm window.open(img) — "javascript:" chạy
// mã trong phiên admin. Hàng cũ trong DB vẫn có thể chứa URL xấu dù API đã chặn từ nay.
describe('safeEvidenceImage', () => {
  it('https → hiện ảnh + link mở tab mới', () => {
    expect(safeEvidenceImage(HTTPS)).toEqual({ src: HTTPS, href: HTTPS });
  });

  it('ảnh base64 raster (fallback miniapp) → hiện ảnh, KHÔNG link', () => {
    expect(safeEvidenceImage(JPEG)).toEqual({ src: JPEG, href: null });
  });

  it.each([
    'javascript:alert(document.cookie)',
    ' JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'http://res.cloudinary.com/a.jpg',
    'vbscript:x',
    '//evil.example/a.jpg',
    '',
  ])('từ chối %s', (url) => {
    expect(safeEvidenceImage(url)).toBeNull();
  });
});

describe('EvidenceImages', () => {
  it('chỉ render ảnh an toàn; không có href javascript:/data:; link https mở tab mới có noopener', () => {
    const r = render(<EvidenceImages images={[HTTPS, 'javascript:alert(1)', JPEG, 'data:text/html,<b>x</b>']} />);
    mounted.push(r);
    click(byText(r.container, 'button', /ảnh minh chứng/));
    const imgs = Array.from(r.container.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(imgs).toEqual([HTTPS, JPEG]);
    const hrefs = Array.from(r.container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([HTTPS]);
    const a = r.container.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(r.container.textContent).toMatch(/2 ảnh không hợp lệ/);
  });

  it('không có ảnh → không render gì', () => {
    const r = render(<EvidenceImages images={[]} />);
    mounted.push(r);
    expect(r.container.textContent).toBe('');
  });
});
