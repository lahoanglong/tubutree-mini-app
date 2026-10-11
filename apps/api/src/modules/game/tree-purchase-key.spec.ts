import { BadRequestException } from '@nestjs/common';
import { parseTreeBuyKey, treeCertificateCodeFor } from './tree-purchase-key';

describe('parseTreeBuyKey', () => {
  it('không có header → undefined (hành vi cũ, không idempotent)', () => {
    expect(parseTreeBuyKey(undefined)).toBeUndefined();
  });

  it.each(['abcdefgh', 'A1_-b2C3', 'x'.repeat(128), 'tree-buy-key-0001'])('nhận key hợp lệ %s', (key) => {
    expect(parseTreeBuyKey(key)).toBe(key);
  });

  it.each([
    ['rỗng', ''],
    ['chỉ khoảng trắng', '        '],
    ['7 ký tự', 'abcdefg'],
    ['129 ký tự', 'x'.repeat(129)],
    ['khoảng trắng ở giữa', 'abcd efgh'],
    ['khoảng trắng ở cuối', 'abcdefgh '],
    ['xuống dòng ở cuối', 'abcdefgh\n'],
    ['dấu hai chấm', 'abcd:efgh'],
    ['dấu phẩy (header lặp bị gộp)', 'abcdefgh, abcdefgh'],
    ['dấu chấm', 'abcd.efgh'],
    ['ký tự ngoài ASCII', 'abcdefgđ'],
    ['mảng', ['abcdefgh'] as unknown],
    ['null', null as unknown],
    ['số', 12345678 as unknown],
  ])('từ chối key %s bằng BadRequestException tiếng Việt', (_name, bad) => {
    let err: unknown;
    try {
      parseTreeBuyKey(bad);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe('Idempotency-Key không hợp lệ: cần 8 đến 128 ký tự gồm chữ cái, chữ số, dấu gạch dưới (_) hoặc gạch nối (-).');
  });
});

describe('treeCertificateCodeFor', () => {
  it('tất định: cùng (user, key) luôn ra cùng mã', () => {
    expect(treeCertificateCodeFor('u1', 'tree-buy-key-0001')).toBe(treeCertificateCodeFor('u1', 'tree-buy-key-0001'));
  });

  it('dạng TUBU- + 12 ký tự hex in hoa (dài hơn mã ngẫu nhiên 8 ký tự để va chạm unique toàn cục không đáng kể)', () => {
    expect(treeCertificateCodeFor('u1', 'tree-buy-key-0001')).toMatch(/^TUBU-[0-9A-F]{12}$/);
  });

  it('khác user cùng key → khác mã (khoá gắn userId)', () => {
    expect(treeCertificateCodeFor('userA', 'shared-key-0001')).not.toBe(treeCertificateCodeFor('userB', 'shared-key-0001'));
  });

  it('cùng user khác key → khác mã', () => {
    expect(treeCertificateCodeFor('u1', 'tree-buy-key-0001')).not.toBe(treeCertificateCodeFor('u1', 'tree-buy-key-0002'));
  });

  it('không nhập nhằng ranh giới user/key: ("ab","c-key-000") ≠ ("a","bc-key-000")', () => {
    expect(treeCertificateCodeFor('ab', 'c-key-000')).not.toBe(treeCertificateCodeFor('a', 'bc-key-000'));
  });
});
