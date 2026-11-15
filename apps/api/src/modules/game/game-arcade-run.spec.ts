import { readArcadeRun, signArcadeRun } from './game-arcade-run';

const SECRET = 'a-very-long-test-secret-for-arcade-runs';
const AT = 1_763_190_000_000;

describe('mã ván (runId) ký HMAC không trạng thái', () => {
  it('ký rồi đọc lại đúng game và giờ cấp', () => {
    const id = signArcadeRun('refill_rush', AT, SECRET);
    expect(readArcadeRun(id, SECRET)).toEqual({ gameId: 'refill_rush', issuedAt: AT });
  });

  it('hai mã cấp cùng mili giây vẫn khác nhau (nonce), nhưng nonce cố định thì mã ổn định', () => {
    expect(signArcadeRun('dew_catcher', AT, SECRET)).not.toBe(signArcadeRun('dew_catcher', AT, SECRET));
    expect(signArcadeRun('dew_catcher', AT, SECRET, 'n1')).toBe(signArcadeRun('dew_catcher', AT, SECRET, 'n1'));
  });

  it('sai bí mật, sửa giờ cấp, đổi game hay sửa chữ ký: đều null', () => {
    const id = signArcadeRun('dew_catcher', AT, SECRET, 'n1');
    expect(readArcadeRun(id, 'another-secret-another-secret-123456')).toBeNull();
    expect(readArcadeRun(id.replace(String(AT), String(AT + 60_000)), SECRET)).toBeNull();
    expect(readArcadeRun(id.replace('dew_catcher', 'refill_rush'), SECRET)).toBeNull();
    expect(readArcadeRun(id.slice(0, -2), SECRET)).toBeNull();
    expect(readArcadeRun(`${id}x`, SECRET)).toBeNull();
  });

  it.each([undefined, null, 5, '', 'abc', 'r1.a.b.c.d', 'r2.dew_catcher.1763190000000.n.sig', 'r1.tetris.1763190000000.n.sig', 'r1.dew_catcher.12.n.sig', 'r1.dew_catcher.1763190000000..sig'])(
    'định dạng lạ %j: null',
    (v) => {
      expect(readArcadeRun(v, SECRET)).toBeNull();
    },
  );

  it('không có bí mật cấu hình thì dùng khoá dev nhất quán, và khoá dev không đọc được mã của bí mật thật', () => {
    const dev = signArcadeRun('dew_catcher', AT, undefined, 'n1');
    expect(readArcadeRun(dev, undefined)).toEqual({ gameId: 'dew_catcher', issuedAt: AT });
    expect(readArcadeRun(dev, SECRET)).toBeNull();
  });
});
