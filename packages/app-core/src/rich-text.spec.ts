import { describe, expect, it } from 'vitest';
import { decodeEntities, hasHtmlTags, parseRichText, richTextPlain } from './rich-text';

const text = (input: string) => richTextPlain(parseRichText(input));

describe('hasHtmlTags', () => {
  it('nhận thẻ thật, bỏ qua dấu < đứng một mình', () => {
    expect(hasHtmlTags('<p>Xin chào</p>')).toBe(true);
    expect(hasHtmlTags('Dùng cho bé < 5 tuổi')).toBe(false);
    expect(hasHtmlTags('')).toBe(false);
    expect(hasHtmlTags(null)).toBe(false);
  });
});

describe('parseRichText: chữ thường', () => {
  it('tách đoạn theo dòng trống, giữ xuống dòng trong đoạn', () => {
    expect(parseRichText('Dòng 1\nDòng 2\n\nĐoạn 2')).toEqual([
      { kind: 'p', inlines: [{ text: 'Dòng 1\nDòng 2' }] },
      { kind: 'p', inlines: [{ text: 'Đoạn 2' }] },
    ]);
  });
  it('rỗng', () => {
    expect(parseRichText('')).toEqual([]);
    expect(parseRichText(null)).toEqual([]);
    expect(parseRichText('   \n\n  ')).toEqual([]);
  });
});

describe('parseRichText: HTML', () => {
  it('đoạn, đậm, nghiêng, xuống dòng', () => {
    expect(parseRichText('<p>Nước rửa <strong>an toàn</strong><br>cho <em>bé</em></p><p>Đoạn 2</p>')).toEqual([
      { kind: 'p', inlines: [{ text: 'Nước rửa ' }, { text: 'an toàn', bold: true }, { text: '\ncho ' }, { text: 'bé', italic: true }] },
      { kind: 'p', inlines: [{ text: 'Đoạn 2' }] },
    ]);
  });
  it('không bao giờ còn thẻ dạng chữ', () => {
    const out = text('<p>Mô tả</p><div><span style="color:red">đỏ</span></div><h3>Công dụng</h3>');
    expect(out).not.toMatch(/<|>/);
    expect(out).toBe('Mô tả\n\nđỏ\n\nCông dụng');
  });
  it('tiêu đề thành khối h', () => {
    expect(parseRichText('<h2>Công dụng</h2><p>Sạch</p>')).toEqual([
      { kind: 'h', inlines: [{ text: 'Công dụng' }] },
      { kind: 'p', inlines: [{ text: 'Sạch' }] },
    ]);
  });
  it('danh sách có thứ tự và không thứ tự; danh sách lồng gộp vào ngoài', () => {
    expect(parseRichText('<ul><li>Một</li><li><b>Hai</b></li></ul><ol><li>A<ul><li>A1</li></ul></li><li>B</li></ol>')).toEqual([
      { kind: 'ul', items: [[{ text: 'Một' }], [{ text: 'Hai', bold: true }]] },
      { kind: 'ol', items: [[{ text: 'A' }], [{ text: 'A1' }], [{ text: 'B' }]] },
    ]);
  });
  it('li không có ul bọc ngoài vẫn thành danh sách', () => {
    expect(parseRichText('<li>Một</li><li>Hai</li>')).toEqual([{ kind: 'ul', items: [[{ text: 'Một' }], [{ text: 'Hai' }]] }]);
  });
  it('giải mã thực thể', () => {
    expect(text('<p>A &amp; B &lt;3 &quot;x&quot; &#39;y&#39; &#x1F33F; &nbsp;z</p>')).toBe('A & B <3 "x" \'y\' 🌿 z');
  });
  it('gộp khoảng trắng như trình duyệt', () => {
    expect(text('<p>  Nhiều \n   khoảng   trắng  </p>')).toBe('Nhiều khoảng trắng');
  });
  it('dấu < lẻ trong HTML giữ như chữ', () => {
    expect(text('<p>Bé < 5 tuổi</p>')).toBe('Bé < 5 tuổi');
  });
});

describe('parseRichText: bộ lọc an toàn', () => {
  it('bỏ script và style cả nội dung', () => {
    const out = text('<p>Trước</p><script>alert(1)</script><style>p{color:red}</style><p>Sau</p>');
    expect(out).toBe('Trước\n\nSau');
    expect(out).not.toContain('alert');
  });
  it('bỏ mọi thuộc tính on* và javascript:', () => {
    const blocks = parseRichText('<p onclick="steal()">Bấm <a href="javascript:alert(1)" onmouseover="x()">đây</a><img src=x onerror="alert(\'>\')"></p>');
    const out = richTextPlain(blocks);
    expect(out).toBe('Bấm đây');
    expect(JSON.stringify(blocks)).not.toMatch(/javascript:|onerror|onclick|onmouseover|alert|steal/);
  });
  it('bỏ iframe, svg, comment, CDATA', () => {
    const out = text('<p>A</p><iframe src="https://x"><p>trong iframe</p></iframe><svg><script>bad()</script></svg><!-- ghi chú --><![CDATA[x]]><p>B</p>');
    expect(out).toBe('A\n\nB');
  });
  it('script không đóng thì bỏ tới hết', () => {
    expect(text('<p>A</p><script>alert(1)')).toBe('A');
  });
  it('mã thực thể điều khiển bị bỏ', () => {
    expect(decodeEntities('a&#0;b&#x7;c')).toBe('abc');
  });
});

describe('parseRichText: chữ thường lẫn thẻ, ngoặc nhọn trong chữ, mã hoá hai lần', () => {
  it('chữ thường có vài thẻ đậm: giữ xuống dòng và đoạn của chữ', () => {
    expect(text('Dòng 1\nMàu <b>đỏ</b>\nDòng 3')).toBe('Dòng 1\nMàu đỏ\nDòng 3');
    expect(text('Đoạn 1 có <i>nghiêng</i>\n\nĐoạn 2')).toBe('Đoạn 1 có nghiêng\n\nĐoạn 2');
    expect(parseRichText('Màu <b>đỏ</b>')[0]).toEqual({ kind: 'p', inlines: [{ text: 'Màu ' }, { text: 'đỏ', bold: true }] });
  });
  it('có thẻ khối thì xuống dòng trong chữ là khoảng trắng như trình duyệt', () => {
    expect(text('<p>Một\nhai</p>')).toBe('Một hai');
  });
  it('chữ trong ngoặc nhọn không phải thẻ thì giữ nguyên', () => {
    expect(hasHtmlTags('Hương: <Sả chanh>')).toBe(false);
    expect(text('Hương: <Sả chanh>\n\nĐoạn 2')).toBe('Hương: <Sả chanh>\n\nĐoạn 2');
    expect(text('<p>Mùi <Sa chanh> dịu</p>')).toBe('Mùi <Sa chanh> dịu');
  });
  it('mô tả bị mã hoá hai lần: đọc ra HTML, không hiện thẻ dạng chữ', () => {
    const out = text('&lt;p&gt;Nước rửa chén&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Sạch&lt;/li&gt;&lt;/ul&gt;');
    expect(out).toBe('Nước rửa chén\n\nSạch');
    expect(text('a &lt; 5 tuổi')).toBe('a < 5 tuổi');
  });
});
