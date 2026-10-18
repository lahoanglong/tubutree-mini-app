import { describe, it, expect } from 'vitest';
import { buildQueryString, withQuery } from './core-query';

// Chuỗi kỳ vọng lấy từ chính axios 1.16 của Mini App (api.getUri), để API nhận cùng một query từ hai nền tảng.
describe('core-query — cùng chuỗi query với axios của Mini App', () => {
  it('bỏ khoá null/undefined, giữ chuỗi rỗng, false và 0', () => {
    expect(buildQueryString({ q: 'x', z: null, u: undefined, e: '', b: false, n: 0 })).toBe('q=x&e=&b=false&n=0');
  });

  it('không có tham số nào thì rỗng', () => {
    expect(buildQueryString(undefined)).toBe('');
    expect(buildQueryString({})).toBe('');
    expect(buildQueryString({ a: null })).toBe('');
  });

  it('mã hoá như axios: cách = +, giữ nguyên : $ , còn lại percent-encode', () => {
    expect(buildQueryString({ q: 'áo thun & nón: $1,2' })).toBe('q=%C3%A1o+thun+%26+n%C3%B3n:+$1,2');
    expect(buildQueryString({ d: 'a+b' })).toBe('d=a%2Bb');
    expect(buildQueryString({ v: "!'()~*-._ @/?#=;&[]{}|^`%\\" })).toBe(
      "v=!'()~*-._+%40%2F%3F%23%3D%3B%26%5B%5D%7B%7D%7C%5E%60%25%5C",
    );
    expect(buildQueryString({ 'k y[1]!': 1, 'a:b$c,d': 2 })).toBe('k+y%5B1%5D!=1&a:b$c,d=2');
  });

  it('chuỗi đã nối bằng dấu phẩy (itemIds, slugs) giữ dấu phẩy thô như Mini App', () => {
    expect(buildQueryString({ itemIds: 'a,b,c', limit: 3 })).toBe('itemIds=a,b,c&limit=3');
  });

  it('mảng mã hoá kiểu axios: key[]=a&key[]=b, mảng rỗng bị bỏ, phần tử null bị bỏ', () => {
    expect(buildQueryString({ arr: ['a b', 'c'] } as never)).toBe('arr%5B%5D=a+b&arr%5B%5D=c');
    expect(buildQueryString({ arr: [] } as never)).toBe('');
    expect(buildQueryString({ arr: ['a', null, 'c'] } as never)).toBe('arr%5B%5D=a&arr%5B%5D=c');
  });

  it('withQuery nối vào đường dẫn, dùng & khi đã có ?', () => {
    expect(withQuery('/p', { a: 1 })).toBe('/p?a=1');
    expect(withQuery('/p?x=1', { y: 2 })).toBe('/p?x=1&y=2');
    expect(withQuery('/p', undefined)).toBe('/p');
    expect(withQuery('/p', { a: null })).toBe('/p');
  });
});
