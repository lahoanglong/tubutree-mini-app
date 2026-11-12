import { describe, expect, it } from 'vitest';
import { MEDICAL_CLAIMS, PROOF_CLAIMS, claimsIn, normalizeCopyText, sanitizeCopyText } from './copy-claims-guard';

describe('claimsIn', () => {
  it('nhận diện từng nhóm tuyên bố', () => {
    expect(claimsIn('Giúp điều trị mụn')).toEqual(['medical']);
    expect(claimsIn('Có chứng nhận USDA')).toEqual(['proof']);
    expect(claimsIn('Giảm 30% rác nhựa')).toEqual(['proof']);
    expect(claimsIn('Điều trị mụn, đạt chuẩn quốc tế')).toEqual(['medical', 'proof']);
  });

  it('chữ sạch không có nhóm nào, chuỗi rỗng cũng vậy', () => {
    expect(claimsIn('Nước rửa chén dùng enzyme lên men từ vỏ dứa.')).toEqual([]);
    expect(claimsIn('')).toEqual([]);
  });

  it('hai mức: "tự nhiên" và "thân tre" chỉ bị bắt ở mức strict (mặc định)', () => {
    expect(claimsIn('Làm từ nguyên liệu tự nhiên', 'claims')).toEqual([]);
    expect(claimsIn('Làm từ nguyên liệu tự nhiên', 'strict')).toEqual(['natural']);
    expect(claimsIn('Làm từ nguyên liệu tự nhiên')).toEqual(['natural']);
    expect(claimsIn('Chiết xuất thiên nhiên')).toEqual(['natural']);
    expect(claimsIn('Cán bằng thân tre', 'claims')).toEqual([]);
    expect(claimsIn('Cán bằng thân tre', 'strict')).toEqual(['bamboo']);
  });

  it('mức claims vẫn bắt nhóm y tế và chứng nhận', () => {
    expect(claimsIn('Diệt khuẩn 99%', 'claims')).toEqual(['medical', 'proof']);
  });
});

describe('sanitizeCopyText', () => {
  it('không vi phạm thì giữ nguyên chữ, không câu nào bị bỏ', () => {
    const r = sanitizeCopyText('Chai 500ml. Dùng cho bồn rửa chén.');
    expect(r).toEqual({ text: 'Chai 500ml. Dùng cho bồn rửa chén.', removed: [] });
  });

  it('rỗng hoặc chỉ khoảng trắng thì trả rỗng', () => {
    expect(sanitizeCopyText('')).toEqual({ text: '', removed: [] });
    expect(sanitizeCopyText('   \n  ')).toEqual({ text: '', removed: [] });
  });

  it('bỏ thẻ HTML, thực thể &nbsp; và &amp;, giữ chữ', () => {
    expect(sanitizeCopyText('<p>Chai&nbsp;500ml</p><p>Rửa chén &amp; bát</p>').text).toBe('Chai 500ml Rửa chén & bát');
    expect(sanitizeCopyText('<ul><li>Một</li><li>Hai</li></ul>').text).toBe('Một Hai');
  });

  it('thẻ <br> tách câu như xuống dòng', () => {
    expect(sanitizeCopyText('Dòng một<br/>Dòng hai<br>Dòng ba').text).toBe('Dòng một Dòng hai Dòng ba');
  });

  it('bỏ nguyên CÂU vi phạm, giữ các câu sạch quanh nó', () => {
    const r = sanitizeCopyText('Chai 500ml. Điều trị mụn hiệu quả. Dùng hằng ngày.');
    expect(r.text).toBe('Chai 500ml. Dùng hằng ngày.');
    expect(r.removed).toEqual(['Điều trị mụn hiệu quả.']);
  });

  it('câu cuối không có dấu chấm vẫn được xét như một câu', () => {
    const r = sanitizeCopyText('Chai 500ml. Có chứng nhận USDA');
    expect(r.text).toBe('Chai 500ml.');
    expect(r.removed).toEqual(['Có chứng nhận USDA']);
    expect(sanitizeCopyText('Chai 500ml. Dùng hằng ngày').text).toBe('Chai 500ml. Dùng hằng ngày');
  });

  it('xuống dòng cũng ngăn câu: câu vi phạm ở dòng riêng chỉ bỏ dòng đó', () => {
    const r = sanitizeCopyText('Dòng sạch\nSản phẩm tốt nhất thị trường\nDòng sạch khác');
    expect(r.text).toBe('Dòng sạch Dòng sạch khác');
    expect(r.removed).toEqual(['Sản phẩm tốt nhất thị trường']);
  });

  it('hai mức khác nhau: "tự nhiên" bị bỏ ở strict (mặc định) nhưng giữ ở claims', () => {
    const text = 'Chai 500ml. Làm từ nguyên liệu tự nhiên. Có thân tre.';
    const strict = sanitizeCopyText(text);
    expect(strict.text).toBe('Chai 500ml.');
    expect(strict.removed).toEqual(['Làm từ nguyên liệu tự nhiên.', 'Có thân tre.']);
    expect(sanitizeCopyText(text, 'strict')).toEqual(strict);
    const claims = sanitizeCopyText(text, 'claims');
    expect(claims.text).toBe(text);
    expect(claims.removed).toEqual([]);
  });

  it('mức claims vẫn bỏ câu y tế và chứng nhận', () => {
    const r = sanitizeCopyText('Chai 500ml. Diệt khuẩn 99%. Làm từ nguyên liệu tự nhiên.', 'claims');
    expect(r.text).toBe('Chai 500ml. Làm từ nguyên liệu tự nhiên.');
    expect(r.removed).toEqual(['Diệt khuẩn 99%.']);
  });

  it('mọi câu đều vi phạm thì text rỗng và removed đủ các câu', () => {
    const r = sanitizeCopyText('Chữa bệnh. Số 1 thị trường.');
    expect(r.text).toBe('');
    expect(r.removed).toEqual(['Chữa bệnh.', 'Số 1 thị trường.']);
  });

  it('removed cắt ở 120 ký tự: câu dài thành 119 ký tự kèm "…", câu đúng 120 ký tự giữ nguyên', () => {
    const long = `Điều trị mụn ${'a'.repeat(200)}.`;
    const [cut] = sanitizeCopyText(long).removed;
    expect(cut).toHaveLength(120);
    expect(cut!.endsWith('…')).toBe(true);
    expect(cut!.startsWith('Điều trị mụn ')).toBe(true);
    const exact = `Điều trị mụn ${'b'.repeat(120 - 'Điều trị mụn '.length)}`;
    expect(exact).toHaveLength(120);
    expect(sanitizeCopyText(exact).removed).toEqual([exact]);
  });

  it('ký tự điều khiển được đổi thành dấu cách và gộp khoảng trắng', () => {
    expect(sanitizeCopyText('Chai\u0007500ml   dùng \t tốt').text).toBe('Chai 500ml dùng tốt');
  });
});

describe('tên SKU thật: tuyên bố y tế và chứng nhận không còn lọt', () => {
  const MEDICAL = [
    'sâm Visante trị gàu, giảm bết dầu',
    'Giảm gãy rụng cho tóc yếu',
    'Nước uống sáng da Hector White Collagen',
    'Kháng nấm, trị nấm',
    'Trị chàm, hết ngứa, khỏi hẳn',
    'Ngừa hăm',
    'Phòng ngừa cảm cúm',
    'Dầu gội ngăn rụng tóc',
    'Liệu trình trị liệu da đầu',
    'Chăm sóc nấm da, nấm móng',
    'Trị tróc da',
    'Gội đầu trị.',
  ];
  const PROOF = ['Chuẩn FDA', 'Có ecocert', 'sạch 99 phần trăm', 'Hiệu quả gấp 3 lần'];

  it.each(MEDICAL)('"%s" bị bắt ở nhóm medical và bị bỏ khỏi văn bản', (s) => {
    expect(claimsIn(s)).toContain('medical');
    expect(sanitizeCopyText(s)).toEqual({ text: '', removed: [s] });
    expect(sanitizeCopyText(s, 'claims').removed).toEqual([s]);
  });

  it.each(PROOF)('"%s" bị bắt ở nhóm proof và bị bỏ khỏi văn bản', (s) => {
    expect(claimsIn(s)).toContain('proof');
    expect(sanitizeCopyText(s, 'claims')).toEqual({ text: '', removed: [s] });
  });

  it('chữ "trị" đứng riêng bị bắt, kể cả chữ hoa và đầu/cuối câu', () => {
    for (const s of ['TRỊ gàu', 'Sản phẩm giúp trị', 'trị', 'Dùng để trị, không để ăn']) expect(claimsIn(s, 'claims')).toContain('medical');
  });

  it('cụm hợp lệ có "trị" không bị bắt: giá trị, quản trị, chính trị, trị giá', () => {
    for (const s of ['Giá trị dinh dưỡng', 'Quản trị viên', 'Sản phẩm trị giá 50.000đ', 'GIÁ TRỊ cốt lõi', 'Chính trị gia']) {
      expect(claimsIn(s)).toEqual([]);
      expect(sanitizeCopyText(s)).toEqual({ text: s, removed: [] });
    }
  });

  it('chữ "trị" trong cụm hợp lệ vẫn bị bắt khi còn "trị" riêng ở chỗ khác', () => {
    expect(claimsIn('Giá trị dinh dưỡng, trị gàu')).toContain('medical');
  });

  it('mẫu mới vẫn export dạng regex (spec khác import trực tiếp)', () => {
    expect(MEDICAL_CLAIMS).toBeInstanceOf(RegExp);
    expect(PROOF_CLAIMS).toBeInstanceOf(RegExp);
    expect(MEDICAL_CLAIMS.test('trị liệu')).toBe(true);
    expect(PROOF_CLAIMS.test('gấp 3 lần')).toBe(true);
  });

  it('mẫu hẹp không chặn nhầm từ thường gặp', () => {
    for (const s of ['Gầu xách nước', 'Khăm khẳm', 'Ngựa gỗ', 'Phòng khách', 'Gấp đôi tờ giấy', 'Nhận FDAX']) expect(claimsIn(s, 'claims')).toEqual([]);
  });
});

describe('qua mặt bằng thẻ, thực thể, NBSP, NFD, ký tự rộng 0', () => {
  it.each([
    ['thẻ rỗng chèn giữa chữ', 'Ch<i></i>ữa viêm da.'],
    ['thực thể số', 'Ch&#7919;a viêm da.'],
    ['thực thể số dạng hex', 'Ch&#x1EEF;a viêm da.'],
    ['thực thể phần trăm', 'Sạch 99&#37;'],
    ['NBSP giữa "an toàn"', 'an\u00a0toàn'],
    ['thực thể NBSP giữa "an toàn"', 'an&nbsp;toàn'],
    ['NFD (dấu tách rời)', 'Chữa bệnh viêm da'.normalize('NFD')],
    ['U+200B chen giữa chữ', 'Ch\u200bữa viêm da'],
    ['U+2060 và BOM chen giữa chữ', 'Điều\u2060 trị\ufeff mụn'],
    ['khoảng em thay dấu cách', 'Kháng\u2003khuẩn'],
    ['thực thể U+200B chen giữa chữ', 'Ch&#8203;ữa viêm da'],
  ])('%s: bị bắt và bỏ cả câu', (_why, input) => {
    expect(claimsIn(input, 'claims').length).toBeGreaterThan(0);
    expect(sanitizeCopyText(input, 'claims').text).toBe('');
    expect(sanitizeCopyText(input, 'claims').removed).toHaveLength(1);
  });

  it('text ra là bản đã chuẩn hoá: thẻ và thực thể đã bỏ, NBSP thành dấu cách', () => {
    expect(sanitizeCopyText('<b>Chai&nbsp;500ml</b>\u00a0dùng&#32;tốt').text).toBe('Chai 500ml dùng tốt');
    expect(sanitizeCopyText('Chai\u200b 500ml').text).toBe('Chai 500ml');
  });

  it('thực thể giải mã MỘT lượt như web: &amp;#7919; vẫn là chữ "&#7919;", không thành "ữ"', () => {
    expect(sanitizeCopyText('Ch&amp;#7919;a bình').text).toBe('Ch&#7919;a bình');
    expect(normalizeCopyText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('thẻ khối thành xuống dòng, thẻ khác xoá hẳn không chèn dấu cách', () => {
    expect(normalizeCopyText('<p>Một</p><p>Hai</p>')).toBe('Một\nHai');
    expect(normalizeCopyText('Dòng<br>hai<b>ba</b>')).toBe('Dòng\nhaiba');
    expect(normalizeCopyText('A<span>B</span>C')).toBe('ABC');
  });

  it('thực thể không giải mã được (ngoài khoảng mã) giữ nguyên chữ', () => {
    expect(normalizeCopyText('a &#0; b &#1114112; c &eacute;')).toBe('a &#0; b &#1114112; c &eacute;');
  });

  it('chữ sạch có NFD vẫn qua và ra dạng NFC', () => {
    const nfd = 'Nước rửa chén từ vỏ dứa'.normalize('NFD');
    expect(sanitizeCopyText(nfd)).toEqual({ text: 'Nước rửa chén từ vỏ dứa', removed: [] });
  });

  it('chuỗi "1.000đ" và "v2.0" không bị tách câu giữa chừng', () => {
    expect(sanitizeCopyText('Giá 1.000đ cho chai v2.0. Dùng hằng ngày.').text).toBe('Giá 1.000đ cho chai v2.0. Dùng hằng ngày.');
  });
});
