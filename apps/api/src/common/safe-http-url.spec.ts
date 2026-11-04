import { safeHttpUrl } from './safe-http-url';

describe('safeHttpUrl', () => {
  it('http(s) hợp lệ → chuẩn hoá', () => {
    expect(safeHttpUrl('https://tracking.ghn.vn/?code=GHN1')).toBe('https://tracking.ghn.vn/?code=GHN1');
    expect(safeHttpUrl('http://viettelpost.vn')).toBe('http://viettelpost.vn/');
  });
  it.each([['javascript:alert(1)'], ['data:text/html,<h1>'], ['ftp://x/a'], ['https://u:p@x.vn/'], ['không phải url'], [''], [null], [123], [`https://x.vn/${'a'.repeat(2100)}`]])(
    '%p → null',
    (v) => {
      expect(safeHttpUrl(v)).toBeNull();
    },
  );
});
