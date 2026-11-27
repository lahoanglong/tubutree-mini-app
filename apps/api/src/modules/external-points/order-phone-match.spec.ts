import { orderPhoneMatch, parseOrderPhoneForMatch, phoneMatchesOrderMask, visibleDigits, type OrderPhoneMatch } from './order-phone-match';

const USER = '0981234526';

describe('parseOrderPhoneForMatch + phoneMatchesOrderMask: SĐT che số trên đơn sàn (W42)', () => {
  const rows: [raw: unknown, kind: 'FULL' | 'MASK' | 'NONE', match: OrderPhoneMatch, why: string][] = [
    ['0981234526', 'FULL', 'MATCH', 'số đầy đủ khớp'],
    ['+84981234526', 'FULL', 'MATCH', '+84 chuẩn hoá về 0'],
    ['84981234526', 'FULL', 'MATCH', '84 chuẩn hoá về 0'],
    ['0981 234 526', 'FULL', 'MATCH', 'khoảng trắng bị bỏ'],
    ['0981234527', 'FULL', 'MISMATCH', 'số đầy đủ khác 1 số'],
    ['098*****26', 'MASK', 'MATCH', 'Shopee: 3 đầu + 2 cuối'],
    ['******26', 'MASK', 'MATCH', 'chỉ 2 số cuối'],
    ['+84******26', 'MASK', 'MATCH', '+84 rồi che, chỉ đuôi'],
    ['84******26', 'MASK', 'MATCH', '84 rồi che'],
    ['09*****126', 'MASK', 'MISMATCH', '3 số cuối 126 khác 526'],
    ['098*****27', 'MASK', 'MISMATCH', '2 số cuối khác'],
    ['091*****26', 'MASK', 'MISMATCH', 'đầu số khác theo vị trí'],
    ['0912*26', 'MASK', 'MISMATCH', 'cụm đầu (không đủ 10 ký tự) khác đầu SĐT'],
    ['0981234*26', 'MASK', 'MATCH', 'che 1 số ở giữa, đúng vị trí'],
    ['098xxxxx26', 'MASK', 'MATCH', 'x là dấu che'],
    ['098•••••26', 'MASK', 'MATCH', '• là dấu che'],
    ['098●●●●●26', 'MASK', 'MATCH', '● là dấu che'],
    ['(098) ***-**26', 'MASK', 'MATCH', 'ngoặc, gạch, khoảng trắng bị bỏ'],
    ['981*****26', 'MASK', 'MATCH', 'cụm đầu không bắt đầu bằng 0: chỉ tin đuôi'],
    ['***26', 'MASK', 'MATCH', 'đuôi 2 số, phần che ngắn'],
    ['*******6', 'NONE', 'NO_DATA', 'đuôi 1 số không đủ tin'],
    ['098*****2', 'NONE', 'NO_DATA', 'đuôi 1 số không đủ tin'],
    ['09812345**', 'NONE', 'NO_DATA', 'che đuôi: không có đuôi để so'],
    ['*********', 'NONE', 'NO_DATA', 'che hết'],
    ['', 'NONE', 'NO_DATA', 'rỗng'],
    [null, 'NONE', 'NO_DATA', 'null'],
    [undefined, 'NONE', 'NO_DATA', 'undefined'],
    [981234526, 'NONE', 'NO_DATA', 'không phải chuỗi'],
    ['   ', 'NONE', 'NO_DATA', 'chỉ khoảng trắng'],
    ['09812345*2611', 'NONE', 'NO_DATA', 'cụm đầu + đuôi dài hơn 10 số'],
    ['+1******26', 'NONE', 'NO_DATA', 'mã quốc gia khác 84'],
    ['09*+****26', 'NONE', 'NO_DATA', '+ nằm giữa'],
    ['098*****26abc', 'NONE', 'NO_DATA', 'ký tự lạ'],
    ['0981234526*', 'NONE', 'NO_DATA', 'nhiều ký tự hơn một SĐT, đuôi rỗng'],
    ['123', 'NONE', 'NO_DATA', 'không phải SĐT, không có dấu che'],
  ];

  it.each(rows)('%p → %s / %s (%s)', (raw, kind, match) => {
    const p = parseOrderPhoneForMatch(raw);
    expect(p.kind).toBe(kind);
    expect(phoneMatchesOrderMask(USER, p)).toBe(match);
  });

  it('có ít nhất 25 dòng kiểm', () => {
    expect(rows.length).toBeGreaterThanOrEqual(25);
  });

  it('mẫu che giữ vị trí khi dài đúng 10 ký tự, không thì lưu dạng cụm đầu*đuôi', () => {
    expect(parseOrderPhoneForMatch('098*****26')).toEqual({ kind: 'MASK', lead: '098', tail: '26', positional: '098*****26', mask: '098*****26' });
    expect(parseOrderPhoneForMatch('+84******26')).toEqual({ kind: 'MASK', lead: '0', tail: '26', positional: null, mask: '0*26' });
    expect(parseOrderPhoneForMatch('981*****26')).toEqual({ kind: 'MASK', lead: '', tail: '26', positional: null, mask: '*26' });
  });

  it('84 không có + và ngắn hơn 84 + 9 ký tự: có thể là số nội địa mất số 0 đầu, chỉ tin đuôi; đủ 11 ký tự thì là mã nước', () => {
    expect(parseOrderPhoneForMatch('843****26')).toEqual({ kind: 'MASK', lead: '', tail: '26', positional: null, mask: '*26' });
    expect(phoneMatchesOrderMask('0843123426', parseOrderPhoneForMatch('843****26'))).toBe('MATCH');
    expect(parseOrderPhoneForMatch('84981****26')).toMatchObject({ kind: 'MASK', positional: '0981****26' });
    expect(phoneMatchesOrderMask(USER, parseOrderPhoneForMatch('84981****26'))).toBe('MATCH');
    expect(phoneMatchesOrderMask('0912345626', parseOrderPhoneForMatch('84981****26'))).toBe('MISMATCH');
  });

  it('0084 đầu chuỗi che là mã nước (W44): 0084*****526 thành 0*****526, chỉ tin đuôi; số đầy đủ 0084… vẫn NONE như trước', () => {
    expect(parseOrderPhoneForMatch('0084*****526')).toEqual({ kind: 'MASK', lead: '0', tail: '526', positional: null, mask: '0*526' });
    expect(phoneMatchesOrderMask(USER, parseOrderPhoneForMatch('0084*****526'))).toBe('MATCH');
    expect(phoneMatchesOrderMask('0912345527', parseOrderPhoneForMatch('0084*****526'))).toBe('MISMATCH');
    expect(parseOrderPhoneForMatch('0084981***526')).toMatchObject({ kind: 'MASK', positional: '0981***526' });
    expect(phoneMatchesOrderMask(USER, parseOrderPhoneForMatch('0084 981 *** 526'))).toBe('MATCH');
    expect(parseOrderPhoneForMatch('0084981234526')).toEqual({ kind: 'NONE' });
    expect(parseOrderPhoneForMatch('+0084*****526')).toEqual({ kind: 'NONE' });
  });

  it('SĐT khách thiếu hoặc sai dạng: NO_DATA, không bao giờ MISMATCH', () => {
    for (const u of [null, undefined, '', 'abc', '12345']) {
      expect(phoneMatchesOrderMask(u, parseOrderPhoneForMatch('098*****27'))).toBe('NO_DATA');
    }
    expect(phoneMatchesOrderMask('+84981234526', parseOrderPhoneForMatch('098*****26'))).toBe('MATCH');
  });

  it('mẫu đã lưu ở external_orders.phoneMask đối chiếu lại đúng như lúc ingest', () => {
    for (const raw of ['098*****26', '+84******26', '981*****26', '09*****126']) {
      const p = parseOrderPhoneForMatch(raw);
      if (p.kind !== 'MASK') throw new Error(raw);
      expect(orderPhoneMatch(USER, { phone: null, phoneMask: p.mask })).toBe(phoneMatchesOrderMask(USER, p));
    }
  });

  it('orderPhoneMatch: số đầy đủ thắng mẫu che; không có gì → NO_DATA', () => {
    expect(orderPhoneMatch(USER, { phone: '0981234526', phoneMask: '098*****27' })).toBe('MATCH');
    expect(orderPhoneMatch(USER, { phone: '0911111111', phoneMask: '098*****26' })).toBe('MISMATCH');
    expect(orderPhoneMatch(USER, { phone: null, phoneMask: null })).toBe('NO_DATA');
    expect(orderPhoneMatch(USER, { phone: null })).toBe('NO_DATA');
  });

  it('visibleDigits: FULL thắng mọi mẫu che, mẫu nhiều số hơn thắng', () => {
    const full = visibleDigits(parseOrderPhoneForMatch('0981234526'));
    const lead3 = visibleDigits(parseOrderPhoneForMatch('098*****26'));
    const tail2 = visibleDigits(parseOrderPhoneForMatch('******26'));
    expect(full).toBeGreaterThan(lead3);
    expect(lead3).toBe(5);
    expect(tail2).toBe(2);
    expect(visibleDigits(parseOrderPhoneForMatch('*********'))).toBe(0);
  });
});
