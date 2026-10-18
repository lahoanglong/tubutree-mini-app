import { MIN_NOTE_CHARS, noteContentLength, stripInvisible } from './external-claim-note';

describe('ghi chú duyệt: ký t\u1EF1 vô hình không tính', () => {
  const groups: [string, string[]][] = [
    ['zero-width', ['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']],
    ['đánh dấu chiều chữ', ['\u200E', '\u200F', '\u202A', '\u202E']],
    ['soft hyphen và ký hiệu toán ẩn', ['\u00AD', '\u2061', '\u2064']],
    ['Mông Cổ, Khmer', ['᠎', '឴', '឵']],
    ['Hangul trống', ['ᅟ', 'ᅠ', '\u3164', '\uFFA0']],
    ['Braille trống và combining joiner', ['\u2800', '͏']],
  ];
  it.each(groups)('%s: ghi chú chỉ gồm nhóm này tính 0 ký t\u1EF1', (_n, chars) => {
    for (const c of chars) {
      expect(noteContentLength(`${c}${c} \t${c}`)).toBe(0);
      expect(stripInvisible(`a${c}b`)).toBe('ab');
    }
  });
  it('chữ thật còn nguyên, đủ 3 ký t\u1EF1 thì đạt', () => {
    expect(noteContentLength('Đã gọi')).toBe(5);
    expect(noteContentLength(' a\u200Bb ')).toBe(2);
    expect(noteContentLength('abc')).toBeGreaterThanOrEqual(MIN_NOTE_CHARS);
  });
});
