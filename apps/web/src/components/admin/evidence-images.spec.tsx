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
const REF = '/returns/cmabc123xyz/images/0?v=0123456789abcdef0123456789abcdef';
const REF_URL = `http://localhost:3001/api${REF}`;

// C-050 (A5N-05): ảnh minh chứng đổi trả do khách gửi được render và bấm window.open(img) — "javascript:" chạy
// mã trong phiên admin. Hàng cũ trong DB vẫn có thể chứa URL xấu dù API đã chặn từ nay.
describe('safeEvidenceImage', () => {
  it('https → hiện ảnh + link mở tab mới', () => {
    expect(safeEvidenceImage(HTTPS)).toEqual({ src: HTTPS, href: HTTPS });
  });

  it('ảnh base64 raster (fallback miniapp) → hiện ảnh, KHÔNG link', () => {
    expect(safeEvidenceImage(JPEG)).toEqual({ src: JPEG, href: null });
  });

  // R3-UI-1: danh sách API không nhúng base64 nữa mà trả đường dẫn tương đối tới ảnh; ghép với gốc API cho thẻ img.
  it('đường dẫn ảnh do API phục vụ → ghép gốc API, có link mở ảnh lớn', () => {
    expect(safeEvidenceImage(REF)).toEqual({ src: REF_URL, href: REF_URL });
    expect(safeEvidenceImage('/reviews/r1/images/2?v=0123456789')).toEqual({
      src: 'http://localhost:3001/api/reviews/r1/images/2?v=0123456789',
      href: 'http://localhost:3001/api/reviews/r1/images/2?v=0123456789',
    });
  });

  it.each([
    '/returns/../admin/users',
    '/admin/users',
    '/returns/r1/images/0',
    '/returns/r1/images/0?v=ZZZ',
    '/returns/r1/images/0?v=0123456789abcdef&x=1',
    '/returns/r1/images/0?v=0123456789abcdef#frag',
    '//evil.example/returns/r1/images/0?v=0123456789abcdef',
    '/returns/r 1/images/0?v=0123456789abcdef',
  ])('từ chối đường dẫn lạ %s', (url) => {
    expect(safeEvidenceImage(url)).toBeNull();
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

  it('ảnh là đường dẫn API: chỉ nạp khi mở thẻ, ghép gốc API, tải lười', () => {
    const r = render(<EvidenceImages images={[REF]} />);
    mounted.push(r);
    expect(r.container.querySelector('img')).toBeNull();
    click(byText(r.container, 'button', /1 ảnh minh chứng/));
    const img = r.container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(REF_URL);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(r.container.querySelector('a')!.getAttribute('href')).toBe(REF_URL);
  });

  it('không có ảnh → không render gì', () => {
    const r = render(<EvidenceImages images={[]} />);
    mounted.push(r);
    expect(r.container.textContent).toBe('');
  });
});
