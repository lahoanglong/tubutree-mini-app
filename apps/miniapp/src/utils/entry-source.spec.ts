import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ENTRY_TOKEN_PATTERN,
  __resetEntrySourceForTest,
  getSessionAttribution,
  normalizeEntryToken,
  parseEntryParams,
  parseLaunchUrl,
  sessionEntrySource,
} from './entry-source';

const parse = (qs: string) => parseEntryParams(new URLSearchParams(qs));

describe('normalizeEntryToken', () => {
  it.each([
    ['shopee', 'shopee'],
    ['  Shopee ', 'shopee'],
    ['card-2610', 'card-2610'],
    ['a', 'a'],
    ['x'.repeat(40), 'x'.repeat(40)],
  ])('%j → %j', (raw, out) => {
    expect(normalizeEntryToken(raw)).toBe(out);
  });

  it.each([[''], ['  '], ['-x'], ['_x'], ['x'.repeat(41)], ['a b'], ['sàn'], ['<b>'], ['a/b'], ['a;b'], [null], [undefined]])(
    'giá trị bẩn %j → undefined',
    (raw) => {
      expect(normalizeEntryToken(raw)).toBeUndefined();
    },
  );

  it('khuôn trùng với API: chữ thường/số/_/-, bắt đầu bằng chữ hoặc số, tối đa 40', () => {
    expect(ENTRY_TOKEN_PATTERN.source).toBe('^[a-z0-9][a-z0-9_-]{0,39}$');
  });
});

describe('parseEntryParams', () => {
  it.each([
    ['src=shopee', 'shopee'],
    ['src=lazada', 'lazada'],
    ['src=tiktok', 'tiktok'],
    ['src=fb', 'fb'],
    ['src=oa', 'oa'],
    ['src=linkbio', 'linkbio'],
    ['src=ctv', 'ctv'],
    ['src=card-2610', 'card-2610'],
    ['src=SHOPEE', 'shopee'],
    ['src=mot_kenh-moi', 'mot_kenh-moi'],
  ])('%s → nguồn %s', (qs, source) => {
    expect(parse(qs)?.source).toBe(source);
  });

  it('utm_source khi không có src', () => {
    expect(parse('utm_source=facebook&utm_medium=social&utm_campaign=live-1026')).toEqual({
      source: 'facebook',
      medium: 'social',
      campaign: 'live-1026',
    });
  });

  it('src thắng utm_source', () => {
    expect(parse('src=shopee&utm_source=facebook')?.source).toBe('shopee');
  });

  it('card=<đợt> → nguồn card-<đợt>', () => {
    expect(parse('card=2610')?.source).toBe('card-2610');
    expect(parse('card=card-2610')?.source).toBe('card-2610');
  });

  it('card đi cùng src → src là nguồn, thẻ thành chiến dịch (nếu chưa có chiến dịch)', () => {
    expect(parse('src=shopee&card=2610')).toEqual({ source: 'shopee', campaign: 'card-2610' });
    expect(parse('src=shopee&card=2610&utm_campaign=hop-hang')).toEqual({ source: 'shopee', campaign: 'hop-hang' });
  });

  it('link gian hàng CTV ?s= không có src → ngầm hiểu nguồn ctv', () => {
    expect(parse('s=abcd1234')?.source).toBe('ctv');
  });

  it('chỉ có ?ref= → ngầm hiểu nguồn ref, mang mã giới thiệu', () => {
    expect(parse('ref=ABCD1234')).toEqual({ source: 'ref', refCode: 'ABCD1234' });
  });

  it('src thắng s và ref; ref vẫn được giữ làm mã', () => {
    expect(parse('src=oa&s=abcd1234&ref=ABCD1234')).toEqual({ source: 'oa', refCode: 'ABCD1234' });
    expect(parse('card=2610&ref=ABCD1234')).toEqual({ source: 'card-2610', refCode: 'ABCD1234' });
  });

  it('l= (mã link CTV) được giữ cho việc đếm click và ngầm hiểu nguồn ctv', () => {
    expect(parse('ref=ABCD1234&l=aB3_x-9')).toEqual({ source: 'ctv', refCode: 'ABCD1234', linkCode: 'aB3_x-9' });
    expect(parse('src=oa&l=aB3_x-9')?.source).toBe('oa');
  });

  it.each([
    [''],
    ['utm_campaign=x'],
    ['utm_medium=social'],
    ['src='],
    ['src=a b'],
    ['src=' + 'x'.repeat(41)],
    ['src=<script>'],
    ['card=%20'],
    ['card=' + 'x'.repeat(40)],
    ['ref=' + 'x'.repeat(65)],
    ['ref=a b'],
  ])('không có nguồn dùng được (%s) → null', (qs) => {
    expect(parse(qs)).toBeNull();
  });

  it('nguồn bẩn bị bỏ nhưng nguồn hợp lệ phía sau vẫn dùng: src bẩn + utm_source tốt', () => {
    expect(parse('src=a b&utm_source=facebook')?.source).toBe('facebook');
  });

  it('chiến dịch/medium bẩn → bỏ riêng chúng, giữ nguồn', () => {
    expect(parse('src=fb&utm_campaign=a b&utm_medium=<b>')).toEqual({ source: 'fb' });
  });

  it('mã ref/link bẩn → bỏ riêng chúng', () => {
    expect(parse('src=fb&ref=a b&l=<x>')).toEqual({ source: 'fb' });
  });
});

describe('parseLaunchUrl — tham số nằm ở search hoặc sau dấu ? của hash (ZMPRouter dùng hash)', () => {
  it('search', () => {
    expect(parseLaunchUrl('?src=shopee&utm_campaign=c1', '')).toEqual({ source: 'shopee', campaign: 'c1' });
  });

  it('hash', () => {
    expect(parseLaunchUrl('', '#/product/x?src=tiktok')).toEqual({ source: 'tiktok' });
  });

  it('cả hai: search thắng nhưng khoá còn thiếu lấy từ hash', () => {
    expect(parseLaunchUrl('?src=shopee', '#/?utm_campaign=c1')).toEqual({ source: 'shopee', campaign: 'c1' });
  });

  it('không có tham số → null', () => {
    expect(parseLaunchUrl('', '#/home')).toBeNull();
    expect(parseLaunchUrl('', '')).toBeNull();
  });
});

describe('phiên hiện tại', () => {
  afterEach(() => {
    __resetEntrySourceForTest();
    vi.unstubAllGlobals();
  });
  const stubWindow = (search: string, hash = '') => vi.stubGlobal('window', { location: { search, hash } });

  it('đọc URL khi mở app, nguồn của phiên = nguồn đọc được', () => {
    stubWindow('?src=shopee&utm_campaign=c1');
    expect(getSessionAttribution()).toEqual({ source: 'shopee', campaign: 'c1' });
    expect(sessionEntrySource()).toBe('shopee');
  });

  it('không có tham số → organic', () => {
    stubWindow('');
    expect(getSessionAttribution()).toBeNull();
    expect(sessionEntrySource()).toBe('organic');
  });

  it('chỉ đọc MỘT lần: điều hướng trong app làm đổi URL cũng không đổi nguồn của phiên', () => {
    stubWindow('?src=shopee');
    expect(sessionEntrySource()).toBe('shopee');
    stubWindow('', '#/cart');
    expect(sessionEntrySource()).toBe('shopee');
  });

  it('không có window (môi trường lạ) → organic, không ném', () => {
    vi.stubGlobal('window', undefined);
    expect(sessionEntrySource()).toBe('organic');
  });
});
