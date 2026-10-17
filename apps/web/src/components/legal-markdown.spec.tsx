import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalMarkdown } from './legal-markdown';

const html = (md: string) => renderToStaticMarkup(<LegalMarkdown source={md} />);

describe('LegalMarkdown — hiển thị nội dung admin dán vào (D5-01)', () => {
  it('tiêu đề # và ## thành h2, ### thành h3 (h1 là tên trang)', () => {
    const out = html('# Một\n\n## Hai\n\n### Ba');
    expect(out).toContain('<h2');
    expect(out.match(/<h2/g)).toHaveLength(2);
    expect(out).toContain('<h3');
    expect(out).not.toContain('<h1');
  });

  it('đoạn văn tách bằng dòng trống; xuống dòng đơn trong đoạn được giữ', () => {
    const out = html('Dòng một\nDòng hai\n\nĐoạn hai');
    expect(out.match(/<p/g)).toHaveLength(2);
    expect(out).toContain('Dòng một<br/>Dòng hai');
  });

  it('danh sách gạch đầu dòng và danh sách đánh số', () => {
    const out = html('- a\n- b\n\n1. x\n2. y');
    expect(out).toMatch(/<ul[^>]*><li[^>]*>a<\/li><li[^>]*>b<\/li><\/ul>/);
    expect(out).toMatch(/<ol[^>]*><li[^>]*>x<\/li><li[^>]*>y<\/li><\/ol>/);
  });

  it('chữ đậm **...**', () => {
    expect(html('Có **quan trọng** đây')).toContain('<strong>quan trọng</strong>');
  });

  it('liên kết nội bộ (/...) và https:// và mailto: thành thẻ a; liên kết ngoài mở tab mới có noopener', () => {
    const out = html('[Đổi trả](/chinh-sach/doi-tra) và [Zalo](https://zalo.me/x) và [Mail](mailto:a@b.vn)');
    expect(out).toContain('href="/chinh-sach/doi-tra"');
    expect(out).not.toMatch(/href="\/chinh-sach\/doi-tra"[^>]*target=/);
    expect(out).toMatch(/href="https:\/\/zalo.me\/x"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(out).toContain('href="mailto:a@b.vn"');
  });

  it('liên kết javascript:, data: hoặc // giả giao thức không thành thẻ a (chỉ còn chữ)', () => {
    const out = html('[x](javascript:alert(1)) [y](data:text/html;base64,AAA) [z](//evil.example)');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href=');
    expect(out).toContain('x');
    expect(out).toContain('y');
    expect(out).toContain('z');
  });

  it('đường dẫn có dấu gạch chéo ngược (trình duyệt đọc "/\\host" như "//host") không thành thẻ a', () => {
    const out = html('[a](/\\evil.example) [b](\\\\evil.example) [c](https://ok.example\\@evil.example) [d](/chinh-sach/doi-tra\\x)');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href=');
    for (const label of ['a', 'b', 'c', 'd']) expect(out).toContain(label);
  });

  it('HTML thô bị escape, không chạy được script', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('chỗ trống [Tên công ty] giữ nguyên là chữ, không thành liên kết', () => {
    const out = html('Đơn vị: [Tên công ty]');
    expect(out).toContain('[Tên công ty]');
    expect(out).not.toContain('<a');
  });

  it('đường kẻ --- thành hr; nội dung rỗng không vỡ', () => {
    expect(html('a\n\n---\n\nb')).toContain('<hr');
    expect(html('')).toBe('');
    expect(html('   \n\n  ')).toBe('');
  });

  it('xuống dòng kiểu Windows (CRLF) vẫn tách đúng đoạn và mục', () => {
    const out = html('## A\r\n\r\n- x\r\n- y\r\n\r\nĐoạn');
    expect(out).toContain('<h2');
    expect(out.match(/<li/g)).toHaveLength(2);
    expect(out).toContain('<p');
  });
});
