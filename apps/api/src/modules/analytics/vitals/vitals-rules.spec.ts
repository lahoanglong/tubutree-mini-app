import { isPlausibleVital, isVitalRoute, normalizeSamplePct } from './vitals-rules';
import { checkEventProps } from '../event-props';

describe('isVitalRoute', () => {
  it.each(['/', '/san-pham', '/san-pham/:slug', '/tai-khoan/don-hang/:code', '/vuon-xanh/choi/:game', '/product/:slug', '/game/play/:game', '/x/:x'])(
    'nhận mẫu route %s',
    (r) => expect(isVitalRoute(r)).toBe(true),
  );

  it.each([
    '/san-pham/nuoc-giat-cho-be-pineboo-2-1l-22a73c',
    '/tai-khoan/don-hang/TT2511160912',
    '/san-pham?q=nuoc',
    '/san-pham#top',
    'https://tubutree.com/san-pham',
    '//evil.example/x',
    '/san-pham/%E1%BA%A1',
    '/order/20261118',
    '/a/b/c/d/e/f/g',
    'san-pham',
    '',
    '/San-Pham',
    42,
  ])('từ chối URL thô hay sai khuôn %p', (r) => expect(isVitalRoute(r)).toBe(false));
});

describe('isPlausibleVital', () => {
  const web = (props: Record<string, unknown>) => ({ eventName: 'web_vital', platform: 'web', props });
  const mini = (props: Record<string, unknown>) => ({ eventName: 'mini_vital', platform: 'miniapp', props });

  it('nhận số trong khoảng đúng tên của nền tảng', () => {
    expect(isPlausibleVital(web({ name: 'LCP', value: 2400 }))).toBe(true);
    expect(isPlausibleVital(web({ name: 'CLS', value: 0.12 }))).toBe(true);
    expect(isPlausibleVital(web({ name: 'INP', value: 0 }))).toBe(true);
    expect(isPlausibleVital(mini({ name: 'READY', value: 90_000 }))).toBe(true);
  });

  it('từ chối giá trị vô lý, tên của nền tảng khác và nền tảng sai', () => {
    expect(isPlausibleVital(web({ name: 'LCP', value: 60_001 }))).toBe(false);
    expect(isPlausibleVital(web({ name: 'CLS', value: 11 }))).toBe(false);
    expect(isPlausibleVital(web({ name: 'LCP', value: -1 }))).toBe(false);
    expect(isPlausibleVital(web({ name: 'LCP', value: Number.NaN }))).toBe(false);
    expect(isPlausibleVital(web({ name: 'LCP', value: '2400' }))).toBe(false);
    expect(isPlausibleVital(web({ name: 'READY', value: 1000 }))).toBe(false);
    expect(isPlausibleVital(mini({ name: 'INP', value: 100 }))).toBe(false);
    expect(isPlausibleVital({ eventName: 'web_vital', platform: 'miniapp', props: { name: 'LCP', value: 1 } })).toBe(false);
    expect(isPlausibleVital({ eventName: 'mini_vital', platform: 'web', props: { name: 'LCP', value: 1 } })).toBe(false);
  });

  it('không đụng sự kiện khác', () => {
    expect(isPlausibleVital({ eventName: 'screen_viewed', platform: 'web', props: { route: '/' } })).toBe(true);
  });
});

describe('props của web_vital / mini_vital', () => {
  const ok = { name: 'LCP', value: 2400, rating: 'good', route: '/san-pham/:slug', vp: 's', et: '4g', nav: 'navigate' };

  it('nhận đủ lược đồ', () => {
    expect(checkEventProps('web_vital', ok)).toBe('ok');
    expect(checkEventProps('mini_vital', { ...ok, name: 'READY' })).toBe('ok');
  });

  it('thiếu khoá bắt buộc, khoá lạ hay URL thô đều bị bỏ', () => {
    expect(checkEventProps('web_vital', { name: 'LCP', value: 1, route: '/' })).toBe('missing_key');
    expect(checkEventProps('web_vital', { ...ok, url: 'https://tubutree.com/' })).toBe('unknown_key');
    expect(checkEventProps('web_vital', { ...ok, userId: 'u1' })).toBe('unknown_key');
    expect(checkEventProps('web_vital', { ...ok, route: '/san-pham/nuoc-giat-cho-be-pineboo-2-1l-22a73c' })).toBe('bad_value');
    expect(checkEventProps('web_vital', { ...ok, vp: 'xl' })).toBe('bad_value');
    expect(checkEventProps('mini_vital', { ...ok, name: 'TTFB' })).toBe('bad_value');
  });
});

describe('normalizeSamplePct', () => {
  it('chỉ nhận số 0–100, còn lại là 0 (không đo)', () => {
    expect(normalizeSamplePct(100)).toBe(100);
    expect(normalizeSamplePct(12.5)).toBe(12.5);
    expect(normalizeSamplePct(0)).toBe(0);
    expect(normalizeSamplePct(101)).toBe(0);
    expect(normalizeSamplePct('100')).toBe(0);
    expect(normalizeSamplePct(null)).toBe(0);
  });
});
