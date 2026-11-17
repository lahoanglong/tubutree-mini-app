import { sanitizeMssHtml } from './mss-catalog-html';

const clean = (s: string, max = 10_000) => sanitizeMssHtml(s, max);

describe('sanitizeMssHtml: lọc description_html của MSS lúc ghi', () => {
  it('giữ thẻ cho phép, đổi b/i/h1/div sang thẻ chuẩn, bỏ mọi thuộc tính', () => {
    expect(clean('<div class="x"><b>Đậm</b> <i>nghiêng</i></div><h1 id="t">Tựa</h1><ul><li style="color:red">Một</li></ul><br/>')).toBe(
      '<p><strong>Đậm</strong> <em>nghiêng</em></p><h2>Tựa</h2><ul><li>Một</li></ul><br>',
    );
  });

  it.each([
    ['<script>alert(1)</script>Chữ', 'Chữ'],
    ['<SCRIPT type="text/javascript">alert(1)</SCRIPT>Chữ', 'Chữ'],
    ['<style>body{}</style><p>Chữ</p>', '<p>Chữ</p>'],
    ['<p><img src="x" onerror="alert(1)">Chữ</p>', '<p>Chữ</p>'],
    ['<p onmouseover="alert(1)">Chữ</p>', '<p>Chữ</p>'],
    ['<a href="javascript:alert(1)">Bấm</a>', 'Bấm'],
    ['<iframe src="https://evil.test"></iframe><p>Chữ</p>', '<p>Chữ</p>'],
    ['<svg><script>alert(1)</script></svg>Chữ', 'Chữ'],
    ['<!-- <script>alert(1)</script> -->Chữ', 'Chữ'],
    ['<p>a<form action="x"><input name=y></form>b</p>', '<p>ab</p>'],
  ])('bỏ mã chạy được: %s', (input, out) => {
    const html = clean(input);
    expect(html).toBe(out);
    expect(html).not.toMatch(/<script|on\w+=|javascript:|<iframe|<svg|<img|<a\b/i);
  });

  it('chữ được thoát lại; thực thể giải một lần rồi thoát lại (không mở thẻ từ &lt;)', () => {
    expect(clean('<p>5 &lt; 6 &amp; "x" &lt;script&gt;</p>')).toBe('<p>5 &lt; 6 &amp; "x" &lt;script&gt;</p>');
    expect(clean('< 5 tuổi')).toBe('&lt; 5 tuổi');
  });

  it('thẻ mở thiếu đóng được đóng; thẻ đóng lạc bị bỏ; thẻ rỗng bị bỏ', () => {
    expect(clean('<p><strong>Đậm')).toBe('<p><strong>Đậm</strong></p>');
    expect(clean('</p>Chữ</li>')).toBe('Chữ');
    expect(clean('<p></p><p> </p><p>Có</p>')).toBe('<p>Có</p>');
  });

  it('cắt theo trần, kể cả thẻ đóng, không để lại nửa thực thể', () => {
    const out = clean(`<p>${'a'.repeat(30)}&amp;${'b'.repeat(30)}</p>`, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.startsWith('<p>') && out.endsWith('</p>')).toBe(true);
    expect(out).not.toMatch(/&[a-z]*$|&[a-z]*<\//);
  });

  it('ký tự điều khiển bị bỏ', () => {
    expect(clean('<p>a\u0000b\u0007c</p>')).toBe('<p>abc</p>');
  });
});
