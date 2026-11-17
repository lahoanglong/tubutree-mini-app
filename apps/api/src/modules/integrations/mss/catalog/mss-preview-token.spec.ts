import { createHmac } from 'node:crypto';
import { MSS_PREVIEW_TTL_S, readMssPreviewToken, signMssPreviewToken } from './mss-preview-token';

const SECRET = 'i'.repeat(43);
const NOW = Date.parse('2026-11-17T03:00:00Z');
const nowS = Math.floor(NOW / 1000);
const claims = { pid: 'a1b2c3', ver: 4, exp: nowS + MSS_PREVIEW_TTL_S };

describe('readMssPreviewToken: đọc claims token xem trước MSS (hợp đồng mục 1.5)', () => {
  it('đúng dạng, còn hạn: trả claims', () => {
    expect(readMssPreviewToken(signMssPreviewToken(claims, SECRET), NOW)).toEqual(claims);
  });

  it('không kiểm chữ ký (khoá ở MSS): chữ ký hex hay chữ ký bằng khoá khác vẫn đọc được, MSS kiểm khi trả bản nháp', () => {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    expect(readMssPreviewToken(`${body}.${createHmac('sha256', SECRET).update(body).digest('hex')}`, NOW)).toEqual(claims);
    expect(readMssPreviewToken(signMssPreviewToken(claims, 'khoa-cua-mss-khac'), NOW)).toEqual(claims);
  });

  it.each([
    ['hết hạn', () => signMssPreviewToken({ ...claims, exp: nowS - 120 }, SECRET)],
    ['hạn quá 15 phút (token sống lâu bất thường)', () => signMssPreviewToken({ ...claims, exp: nowS + 3600 }, SECRET)],
    ['pid sai dạng', () => signMssPreviewToken({ ...claims, pid: '../x' }, SECRET)],
    ['ver âm', () => signMssPreviewToken({ ...claims, ver: -1 }, SECRET)],
    ['ver không phải số nguyên', () => `${Buffer.from(JSON.stringify({ ...claims, ver: '4' })).toString('base64url')}.${'a'.repeat(43)}`],
    ['payload không phải JSON', () => `${Buffer.from('xin chao').toString('base64url')}.${'a'.repeat(43)}`],
    ['thiếu chữ ký', () => Buffer.from(JSON.stringify(claims)).toString('base64url')],
    ['chữ ký có ký tự lạ', () => `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${'a'.repeat(20)}<script>`],
    ['không phải token', () => 'abc'],
  ])('từ chối: %s', (_label, make) => {
    expect(readMssPreviewToken(make(), NOW)).toBeNull();
  });

  it('không phải chuỗi: null', () => {
    expect(readMssPreviewToken(undefined, NOW)).toBeNull();
    expect(readMssPreviewToken(['x'], NOW)).toBeNull();
  });
});
