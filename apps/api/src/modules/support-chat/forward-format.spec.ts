import { formatForward, maskPhone } from './forward-format';

const HEAD_RE = /^#[A-HJ-NP-Z2-9]{4} · /;

describe('formatForward', () => {
  it('đúng mẫu ở spec 4.3', () => {
    const text = formatForward({
      code: 'K7Q2',
      name: 'Lan',
      phone: '0901234234',
      tier: 'Hạng Vàng',
      context: { orderCode: 'TT12345' },
      items: [{ body: 'Chị ơi đơn em bao giờ giao ạ?', imageUrl: 'https://res.cloudinary.com/x/a.jpg' }],
    });
    expect(text).toBe(
      [
        '#K7Q2 · Lan · 09•••••234 · Hạng Vàng',
        'Về đơn TT12345',
        '—',
        'Chị ơi đơn em bao giờ giao ạ?',
        'Ảnh: https://res.cloudinary.com/x/a.jpg',
        '(Trả lời tin này, hoặc gõ #K7Q2 ở đầu câu, để gửi cho khách)',
      ].join('\n'),
    );
  });

  it('không có SĐT thì bỏ phần SĐT', () => {
    const text = formatForward({ code: 'K7Q2', name: 'Lan', phone: null, tier: 'Hạng Vàng', context: null, items: [{ body: 'a', imageUrl: null }] });
    expect(text.split('\n')[0]).toBe('#K7Q2 · Lan · Hạng Vàng');
    expect(text).not.toContain('Về ');
  });

  it('dòng đầu khớp regex đầu tin chuyển, dòng cuối nêu mã', () => {
    const text = formatForward({ code: 'K7Q2', name: 'Lan', phone: null, tier: null, context: null, items: [{ body: 'a', imageUrl: null }] });
    expect(text.split('\n')[0]).toMatch(HEAD_RE);
    expect(text.split('\n').at(-1)).toBe('(Trả lời tin này, hoặc gõ #K7Q2 ở đầu câu, để gửi cho khách)');
  });

  it('tin chỉ có ảnh không để dòng trống', () => {
    const text = formatForward({ code: 'K7Q2', name: 'Lan', phone: null, tier: null, context: null, items: [{ body: '', imageUrl: 'https://res.cloudinary.com/x/a.jpg' }] });
    expect(text).toContain('—\nẢnh: https://res.cloudinary.com/x/a.jpg\n(Trả lời');
  });
});

describe('maskPhone', () => {
  it('che giữa, giữ 2 số đầu và 3 số cuối', () => {
    expect(maskPhone('0901234234')).toBe('09•••••234');
  });
});
