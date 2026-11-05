import { decodeServedImage, hasServedImagePrefix, SERVED_IMAGE_MIMES, servedImagePrefix } from './served-image';

describe('served-image: một danh sách mime cho regex và tiền tố', () => {
  it('mỗi mime trong danh sách giải mã được; mime ngoài danh sách thì không', () => {
    for (const m of SERVED_IMAGE_MIMES) expect(decodeServedImage(`${servedImagePrefix(m)}AAAA`)?.mime).toBe(m);
    expect(decodeServedImage('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(decodeServedImage('data:text/html;base64,AAAA')).toBeNull();
  });
  it('hasServedImagePrefix khớp đúng các tiền tố của danh sách (kể cả khi chỉ có đầu chuỗi)', () => {
    for (const m of SERVED_IMAGE_MIMES) expect(hasServedImagePrefix(`${servedImagePrefix(m)}QUJD`)).toBe(true);
    expect(hasServedImagePrefix('data:image/svg+xml;base64,PHN2')).toBe(false);
    expect(hasServedImagePrefix('https://cdn.test/a.jpg')).toBe(false);
    expect(hasServedImagePrefix('')).toBe(false);
  });
  it('danh sách gồm đúng png, jpeg, jpg, webp, gif (đổi ở một chỗ này là regex và tiền tố cùng đổi)', () => {
    expect([...SERVED_IMAGE_MIMES].sort()).toEqual(['image/gif', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
  });
});
