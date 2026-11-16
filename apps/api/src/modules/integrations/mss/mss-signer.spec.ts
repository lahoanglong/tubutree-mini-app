import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMssSignature, signMssRequest, verifyMssSignature, MSS_TIMESTAMP_TOLERANCE_SEC } from './mss-signer';

const FIXTURES = join(__dirname, '../../../../test/fixtures/mss');

interface Vectors {
  secret: string;
  previousSecret: string;
  keyId: string;
  timestamp: number;
  cases: { name: string; bodyFile: string | null; secret: 'current' | 'previous'; signature: string }[];
}

const vectors = JSON.parse(readFileSync(join(FIXTURES, 'signature-vectors.json'), 'utf8')) as Vectors;
const bodyOf = (file: string | null): Buffer => (file ? readFileSync(join(FIXTURES, file)) : Buffer.alloc(0));
const secretOf = (which: 'current' | 'previous') => (which === 'current' ? vectors.secret : vectors.previousSecret);
const TS = vectors.timestamp;
const ORDER_EVENT = bodyOf('order-event.json');

describe('MssSigner: vector tính độc lập bằng openssl', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(computeMssSignature(secretOf(c.secret), TS, bodyOf(c.bodyFile))).toBe(c.signature);
  });

  it('thân chuỗi và Buffer cùng byte cho cùng chữ ký; null/undefined là thân rỗng', () => {
    expect(computeMssSignature(vectors.secret, TS, ORDER_EVENT.toString('utf8'))).toBe(vectors.cases[0]!.signature);
    const emptyCase = vectors.cases.find((c) => c.bodyFile === null)!;
    expect(computeMssSignature(vectors.secret, TS, undefined)).toBe(emptyCase.signature);
    expect(computeMssSignature(vectors.secret, TS, null)).toBe(emptyCase.signature);
    expect(computeMssSignature(vectors.secret, TS, '')).toBe(emptyCase.signature);
  });

  it('ba header X-Tubu-* với chữ ký v1=<hex chữ thường>', () => {
    const h = signMssRequest({ keyId: vectors.keyId, secret: vectors.secret, rawBody: ORDER_EVENT, timestamp: TS });
    expect(h).toEqual({ 'X-Tubu-Key-Id': vectors.keyId, 'X-Tubu-Timestamp': String(TS), 'X-Tubu-Signature': vectors.cases[0]!.signature });
    expect(h['X-Tubu-Signature']).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it('không truyền timestamp thì dùng giây unix hiện tại', () => {
    const before = Math.floor(Date.now() / 1000);
    const h = signMssRequest({ keyId: 'k', secret: vectors.secret, rawBody: '' });
    const ts = Number(h['X-Tubu-Timestamp']);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(before + 2);
  });
});

describe('verifyMssSignature', () => {
  const verify = (over: Partial<Parameters<typeof verifyMssSignature>[0]> = {}) =>
    verifyMssSignature({
      timestamp: String(TS),
      signature: vectors.cases[0]!.signature,
      rawBody: ORDER_EVENT,
      secrets: [vectors.secret, vectors.previousSecret],
      nowSec: TS,
      ...over,
    });

  it('đúng chữ ký, đúng giờ: nhận, không dùng khoá trước', () => {
    expect(verify()).toEqual({ ok: true, usedPreviousSecret: false });
  });

  it('ký bằng bí mật trước (đang xoay khoá): nhận và báo usedPreviousSecret', () => {
    expect(verify({ signature: vectors.cases[1]!.signature })).toEqual({ ok: true, usedPreviousSecret: true });
  });

  it('lệch đúng 300 giây vẫn nhận; lệch 301 giây (cả hai chiều) thì từ chối', () => {
    expect(verify({ nowSec: TS + MSS_TIMESTAMP_TOLERANCE_SEC }).ok).toBe(true);
    expect(verify({ nowSec: TS - MSS_TIMESTAMP_TOLERANCE_SEC }).ok).toBe(true);
    expect(verify({ nowSec: TS + 301 })).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verify({ nowSec: TS - 301 })).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('đổi 1 byte của thân thì từ chối', () => {
    const tampered = Buffer.from(ORDER_EVENT);
    const i = tampered.indexOf('385000');
    tampered[i] = '4'.charCodeAt(0);
    expect(verify({ rawBody: tampered })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('parse rồi stringify lại (mất \\/ và khoảng trắng) thì chữ ký không còn khớp', () => {
    const reserialized = JSON.stringify(JSON.parse(ORDER_EVENT.toString('utf8')));
    expect(verify({ rawBody: reserialized })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('đổi timestamp (giữ chữ ký cũ) thì từ chối', () => {
    expect(verify({ timestamp: String(TS + 1), nowSec: TS + 1 })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('thân rỗng: ký "<ts>." và kiểm được', () => {
    const empty = vectors.cases.find((c) => c.bodyFile === null)!;
    expect(verify({ rawBody: undefined, signature: empty.signature }).ok).toBe(true);
    expect(verify({ rawBody: Buffer.alloc(0), signature: empty.signature }).ok).toBe(true);
    expect(verify({ rawBody: '{}', signature: empty.signature })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('nhận hex hoa và thiếu tiền tố v1=; từ chối dạng sai', () => {
    const hex = vectors.cases[0]!.signature.slice(3);
    expect(verify({ signature: hex.toUpperCase() }).ok).toBe(true);
    expect(verify({ signature: hex }).ok).toBe(true);
    expect(verify({ signature: `v2=${hex}` })).toEqual({ ok: false, reason: 'malformed' });
    expect(verify({ signature: `v1=${hex.slice(1)}` })).toEqual({ ok: false, reason: 'malformed' });
    expect(verify({ timestamp: '1794839400.5' })).toEqual({ ok: false, reason: 'malformed' });
    expect(verify({ timestamp: '-1794839400' })).toEqual({ ok: false, reason: 'malformed' });
  });

  it('thiếu header: missing_header; không có bí mật nào: not_configured (trước mọi kiểm khác)', () => {
    expect(verify({ signature: undefined })).toEqual({ ok: false, reason: 'missing_header' });
    expect(verify({ timestamp: '' })).toEqual({ ok: false, reason: 'missing_header' });
    expect(verify({ secrets: [] })).toEqual({ ok: false, reason: 'not_configured' });
    expect(verify({ secrets: [null, undefined, ''] })).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('chỉ bí mật khác: từ chối', () => {
    expect(verify({ secrets: ['another-secret-not-for-prod-0123456789abc'] })).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
