import { createHmac } from 'node:crypto';
import { deviceHash, matchCardId, readGuestRound, signGuestRound } from './game-mini-crypto';

const SECRET = 'secret-thu-nghiem-0123456789';
const OTHER_SECRET = 'secret-khac-9876543210';
const ISSUED_AT = Date.parse('2026-11-17T03:00:00.000Z');
const ROUND = { game: 'daily_quiz' as const, issuedAt: ISSUED_AT, contentIds: ['q-01', 'q-02', 'gq:abc'] };

/** Đổi đúng một ký tự (sang ký tự khác hẳn) ở vị trí `at`. */
function flipChar(s: string, at: number): string {
  const c = s[at] === 'A' ? 'B' : 'A';
  return s.slice(0, at) + c + s.slice(at + 1);
}

describe('signGuestRound / readGuestRound', () => {
  it('khứ hồi: ký rồi đọc lại đúng game, thời điểm phát, danh sách mục và nonce', () => {
    const { token, nonce } = signGuestRound(ROUND, SECRET);
    expect(readGuestRound(token, SECRET)).toEqual({ ...ROUND, nonce });
  });

  it('mã có dạng m1.<thân>.<chữ ký> và nonce mặc định ngẫu nhiên giữa hai ván', () => {
    const a = signGuestRound(ROUND, SECRET);
    const b = signGuestRound(ROUND, SECRET);
    expect(a.token.split('.')).toHaveLength(3);
    expect(a.token.startsWith('m1.')).toBe(true);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.token).not.toBe(b.token);
  });

  it('nhận nonce do nơi gọi truyền vào và ký cùng nonce đó', () => {
    const { token, nonce } = signGuestRound(ROUND, SECRET, 'nonce-co-dinh');
    expect(nonce).toBe('nonce-co-dinh');
    expect(readGuestRound(token, SECRET)?.nonce).toBe('nonce-co-dinh');
  });

  it('không có secret thì dùng khoá dev: khứ hồi vẫn chạy, nhưng không đọc được bằng secret thật', () => {
    const { token } = signGuestRound(ROUND, undefined);
    expect(readGuestRound(token, undefined)?.game).toBe('daily_quiz');
    expect(readGuestRound(token, SECRET)).toBeNull();
    expect(readGuestRound(signGuestRound(ROUND, SECRET).token, undefined)).toBeNull();
  });

  it('sửa một ký tự ở thân (payload) thì null', () => {
    const { token } = signGuestRound(ROUND, SECRET);
    const [v, body, sig] = token.split('.') as [string, string, string];
    for (const at of [0, 5, Math.floor(body.length / 2), body.length - 1]) {
      expect(readGuestRound(`${v}.${flipChar(body, at)}.${sig}`, SECRET)).toBeNull();
    }
  });

  it('sửa một ký tự ở chữ ký thì null (cả ký tự đầu lẫn cuối)', () => {
    const { token } = signGuestRound(ROUND, SECRET);
    const [v, body, sig] = token.split('.') as [string, string, string];
    for (const at of [0, 10, sig.length - 1]) {
      expect(readGuestRound(`${v}.${body}.${flipChar(sig, at)}`, SECRET)).toBeNull();
    }
  });

  it('chữ ký cắt ngắn hoặc kéo dài thì null', () => {
    const { token } = signGuestRound(ROUND, SECRET);
    expect(readGuestRound(token.slice(0, -1), SECRET)).toBeNull();
    expect(readGuestRound(`${token}A`, SECRET)).toBeNull();
  });

  it('thân đổi thật sự (đổi game hay thêm mục) mà giữ chữ ký cũ thì null', () => {
    const { token } = signGuestRound(ROUND, SECRET);
    const [v, , sig] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ g: 'sort', i: ISSUED_AT, c: ['q-01'], n: 'x' })).toString('base64url');
    expect(readGuestRound(`${v}.${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('khác secret thì null', () => {
    const { token } = signGuestRound(ROUND, SECRET);
    expect(readGuestRound(token, OTHER_SECRET)).toBeNull();
  });

  it('chữ ký của mục đích khác (cùng bí mật gốc) không dùng chéo sang mã ván', () => {
    const body = Buffer.from(JSON.stringify({ g: 'sort', i: ISSUED_AT, c: ['a'], n: 'n' })).toString('base64url');
    const purposeKey = createHmac('sha256', SECRET).update('game-mini|device|v1').digest();
    const sig = createHmac('sha256', purposeKey).update(body).digest('base64url');
    expect(readGuestRound(`m1.${body}.${sig}`, SECRET)).toBeNull();
  });

  it('quá 20 mục thì null, đúng 20 mục thì đọc được', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
    expect(readGuestRound(signGuestRound({ ...ROUND, contentIds: ids(21) }, SECRET).token, SECRET)).toBeNull();
    expect(readGuestRound(signGuestRound({ ...ROUND, contentIds: ids(20) }, SECRET).token, SECRET)?.contentIds).toHaveLength(20);
  });

  it('danh sách mục rỗng hoặc có mục rỗng/không phải chuỗi thì null', () => {
    expect(readGuestRound(signGuestRound({ ...ROUND, contentIds: [] }, SECRET).token, SECRET)).toBeNull();
    expect(readGuestRound(signGuestRound({ ...ROUND, contentIds: ['a', ''] }, SECRET).token, SECRET)).toBeNull();
    expect(readGuestRound(signGuestRound({ ...ROUND, contentIds: ['a', 5 as unknown as string] }, SECRET).token, SECRET)).toBeNull();
  });

  it('game lạ, thời điểm không nguyên hoặc nonce rỗng thì null dù chữ ký đúng', () => {
    expect(readGuestRound(signGuestRound({ ...ROUND, game: 'arcade' as never }, SECRET).token, SECRET)).toBeNull();
    expect(readGuestRound(signGuestRound({ ...ROUND, issuedAt: 1.5 }, SECRET).token, SECRET)).toBeNull();
    expect(readGuestRound(signGuestRound({ ...ROUND, issuedAt: Number.NaN }, SECRET).token, SECRET)).toBeNull();
    expect(readGuestRound(signGuestRound(ROUND, SECRET, '').token, SECRET)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['số', 12345],
    ['đối tượng', { token: 'm1.a.b' }],
    ['chuỗi rỗng', ''],
    ['không đủ 3 phần', 'm1.abc'],
    ['quá 3 phần', 'm1.a.b.c'],
    ['sai tiền tố phiên bản', 'm2.a.b'],
  ])('mã không hợp lệ: %s → null', (_n, token) => {
    expect(readGuestRound(token, SECRET)).toBeNull();
  });

  it('mã đúng phiên bản nhưng đổi tiền tố thì null', () => {
    const { token } = signGuestRound(ROUND, SECRET);
    expect(readGuestRound(token.replace(/^m1\./, 'm2.'), SECRET)).toBeNull();
  });

  it('mã dài quá 4000 ký tự thì null', () => {
    expect(readGuestRound(`m1.${'a'.repeat(4000)}.sig`, SECRET)).toBeNull();
  });

  it('thân không phải JSON (nhưng chữ ký khớp thân đó) thì null, không ném lỗi', () => {
    const body = Buffer.from('khong-phai-json').toString('base64url');
    const purposeKey = createHmac('sha256', SECRET).update('game-mini|guest-round|v1').digest();
    const sig = createHmac('sha256', purposeKey).update(body).digest('base64url');
    expect(readGuestRound(`m1.${body}.${sig}`, SECRET)).toBeNull();
  });
});

describe('matchCardId', () => {
  it('ổn định trong một ván: cùng đầu vào cho cùng mã', () => {
    expect(matchCardId(SECRET, 'round-1', 'match-01', 'ingredient')).toBe(matchCardId(SECRET, 'round-1', 'match-01', 'ingredient'));
  });

  it('khác giữa hai ván', () => {
    expect(matchCardId(SECRET, 'round-1', 'match-01', 'ingredient')).not.toBe(matchCardId(SECRET, 'round-2', 'match-01', 'ingredient'));
  });

  it('hai thẻ của cùng một cặp mang mã khác nhau, các cặp khác nhau cũng khác nhau', () => {
    const a = matchCardId(SECRET, 'round-1', 'match-01', 'ingredient');
    const b = matchCardId(SECRET, 'round-1', 'match-01', 'use');
    const c = matchCardId(SECRET, 'round-1', 'match-02', 'ingredient');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('không lộ contentId: mã ngắn 16 ký tự base64url, không chứa id cặp', () => {
    const contentIds = ['match-01', 'match-abc-123', 'gq:xyz', 'item-zz9'];
    for (const id of contentIds) {
      for (const side of ['ingredient', 'use'] as const) {
        const code = matchCardId(SECRET, 'round-1', id, side);
        expect(code).toMatch(/^[A-Za-z0-9_-]{16}$/);
        expect(code).not.toContain(id);
        expect(code).not.toContain(side);
      }
    }
  });

  it('khác secret thì khác mã', () => {
    expect(matchCardId(SECRET, 'round-1', 'match-01', 'use')).not.toBe(matchCardId(OTHER_SECRET, 'round-1', 'match-01', 'use'));
    expect(matchCardId(undefined, 'round-1', 'match-01', 'use')).not.toBe(matchCardId(SECRET, 'round-1', 'match-01', 'use'));
  });

  it('ranh giới ghép chuỗi: (round "a|b", id "c") khác (round "a", id "b|c")', () => {
    expect(matchCardId('s', 'a|b', 'c', 'use')).not.toBe(matchCardId('s', 'a', 'b|c', 'use'));
  });

  it('id thật (không chứa "|") thì 50 ván khác nhau không trùng mã trên cùng một mục', () => {
    const codes = new Set<string>();
    for (let r = 0; r < 50; r++) codes.add(matchCardId(SECRET, `round-${r}`, 'match-01', 'use'));
    expect(codes.size).toBe(50);
  });
});

describe('deviceHash', () => {
  it('cùng secret và cùng thiết bị thì cùng kết quả (hex 64 ký tự, không chứa mã thiết bị)', () => {
    const h = deviceHash(SECRET, 'thiet-bi-abcdef123');
    expect(h).toBe(deviceHash(SECRET, 'thiet-bi-abcdef123'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('abcdef123');
  });

  it('khác secret thì khác kết quả', () => {
    expect(deviceHash(SECRET, 'thiet-bi-1')).not.toBe(deviceHash(OTHER_SECRET, 'thiet-bi-1'));
    expect(deviceHash(undefined, 'thiet-bi-1')).not.toBe(deviceHash(SECRET, 'thiet-bi-1'));
  });

  it('khác thiết bị thì khác kết quả', () => {
    expect(deviceHash(SECRET, 'thiet-bi-1')).not.toBe(deviceHash(SECRET, 'thiet-bi-2'));
  });
});
