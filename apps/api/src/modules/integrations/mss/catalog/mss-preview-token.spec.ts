import { createHmac } from 'node:crypto';
import { MSS_PREVIEW_TTL_S, signMssPreviewToken, verifyMssPreviewToken } from './mss-preview-token';

const SECRET = 'i'.repeat(43);
const PREV = 'p'.repeat(43);
const NOW = Date.parse('2026-11-17T03:00:00Z');
const nowS = Math.floor(NOW / 1000);
const claims = { pid: 'a1b2c3', ver: 4, exp: nowS + MSS_PREVIEW_TTL_S };

describe('verifyMssPreviewToken: token xem trước MSS ký (hợp đồng mục 1.5)', () => {
  it('đúng chữ ký, còn hạn: trả claims', () => {
    expect(verifyMssPreviewToken(signMssPreviewToken(claims, SECRET), [SECRET, null], NOW)).toEqual(claims);
  });

  it('nhận chữ ký hex và chữ ký bằng bí mật trước khi xoay', () => {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const hex = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyMssPreviewToken(`${body}.${hex}`, [SECRET], NOW)).toEqual(claims);
    expect(verifyMssPreviewToken(signMssPreviewToken(claims, PREV), [SECRET, PREV], NOW)).toEqual(claims);
  });

  it.each([
    ['sai bí mật', () => signMssPreviewToken(claims, 'x'.repeat(43))],
    ['hết hạn', () => signMssPreviewToken({ ...claims, exp: nowS - 120 }, SECRET)],
    ['hạn quá 15 phút (token sống lâu bất thường)', () => signMssPreviewToken({ ...claims, exp: nowS + 3600 }, SECRET)],
    ['pid sai dạng', () => signMssPreviewToken({ ...claims, pid: '../x' }, SECRET)],
    ['ver âm', () => signMssPreviewToken({ ...claims, ver: -1 }, SECRET)],
    [
      'sửa payload sau khi ký',
      () => {
        const sig = signMssPreviewToken(claims, SECRET).split('.')[1];
        return `${Buffer.from(JSON.stringify({ ...claims, pid: 'zzz' })).toString('base64url')}.${sig}`;
      },
    ],
    ['không phải token', () => 'abc'],
  ])('từ chối: %s', (_label, make) => {
    expect(verifyMssPreviewToken(make(), [SECRET], NOW)).toBeNull();
  });

  it('chưa đặt bí mật: mọi token bị từ chối', () => {
    expect(verifyMssPreviewToken(signMssPreviewToken(claims, SECRET), [null, null], NOW)).toBeNull();
    expect(verifyMssPreviewToken(signMssPreviewToken(claims, SECRET), [], NOW)).toBeNull();
  });

  it('không phải chuỗi: null', () => {
    expect(verifyMssPreviewToken(undefined, [SECRET], NOW)).toBeNull();
    expect(verifyMssPreviewToken(['x'], [SECRET], NOW)).toBeNull();
  });
});
