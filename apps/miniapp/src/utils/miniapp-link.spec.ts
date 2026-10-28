import { describe, expect, it } from 'vitest';
import { DEFAULT_MINIAPP_ID, miniAppLink, resolveMiniAppId } from './miniapp-link';

describe('resolveMiniAppId', () => {
  it('rỗng, thiếu hoặc không phải số thì dùng ID chính thức', () => {
    for (const raw of [undefined, '', '  ', 'abc', '12 34']) expect(resolveMiniAppId(raw)).toBe(DEFAULT_MINIAPP_ID);
  });
  it('nhận ID số, bỏ khoảng trắng', () => {
    expect(resolveMiniAppId(' 123 ')).toBe('123');
  });
});

describe('miniAppLink', () => {
  it('ghép đường dẫn và mã giới thiệu vào link zalo.me/s', () => {
    expect(miniAppLink('/s/an-lanh?ref=CTV1', '99')).toBe('https://zalo.me/s/99/s/an-lanh?ref=CTV1');
    expect(miniAppLink('/?ref=CTV1', '99')).toBe('https://zalo.me/s/99/?ref=CTV1');
  });
  it('thiếu dấu / đầu thì tự thêm', () => {
    expect(miniAppLink('brand/xyz', '99')).toBe('https://zalo.me/s/99/brand/xyz');
  });
});
