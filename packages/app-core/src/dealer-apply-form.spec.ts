import { describe, expect, it } from 'vitest';
import {
  DEALER_PHONE_HINT,
  DEALER_TAX_CODE_HINT,
  dealerPhoneHint,
  dealerTaxCodeForSubmit,
  dealerTaxCodeHint,
  isDealerTaxCodeOk,
  parseDealerApplyDraft,
  parseVnBusinessPhone,
  serializeDealerApplyDraft,
} from './dealer-apply-form';
import { FORBIDDEN_TERMS } from './shop-copy';

describe('nháp đăng ký đại lý', () => {
  it('chỉ lưu ô chữ có nội dung; ảnh CCCD và ô lạ không vào nháp', () => {
    const raw = serializeDealerApplyDraft({
      businessName: 'Tạp hoá Xanh',
      taxCode: '',
      ownerName: '  ',
      phone: '0912345678',
      address: '12 Lê Lợi',
      ...({ cccdFrontUrl: 'data:image/jpeg;base64,AAA', notes: 'x' } as object),
    });
    expect(JSON.parse(raw!)).toEqual({ businessName: 'Tạp hoá Xanh', phone: '0912345678', address: '12 Lê Lợi' });
    expect(raw).not.toContain('base64');
  });

  it('mọi ô trống thì null để nơi gọi xoá khoá', () => {
    expect(serializeDealerApplyDraft({ businessName: '', phone: '   ' })).toBeNull();
    expect(serializeDealerApplyDraft({})).toBeNull();
  });

  it('đọc lại: JSON hỏng, mảng, sai kiểu, ô lạ đều bỏ; chuỗi quá dài bị cắt; không bao giờ ném lỗi', () => {
    expect(parseDealerApplyDraft(null)).toEqual({});
    expect(parseDealerApplyDraft('{hỏng')).toEqual({});
    expect(parseDealerApplyDraft('[1,2]')).toEqual({});
    expect(parseDealerApplyDraft('"chuỗi"')).toEqual({});
    expect(parseDealerApplyDraft(JSON.stringify({ businessName: 5, phone: '0912', cccdFrontUrl: 'x', address: 'a'.repeat(500) }))).toEqual({
      phone: '0912',
      address: 'a'.repeat(300),
    });
  });

  it('ghi rồi đọc lại ra đúng nháp', () => {
    const form = { businessName: 'A', taxCode: '0312345678', ownerName: 'B', phone: '0912 345 678', address: 'C' };
    expect(parseDealerApplyDraft(serializeDealerApplyDraft(form))).toEqual(form);
  });
});

describe('SĐT doanh nghiệp (cùng luật API)', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['028 3823 4567', '02838234567'],
  ])('%s → %s', (raw, want) => expect(parseVnBusinessPhone(raw)).toBe(want));

  it.each(['0112345678', '091234567', '09123456789', '0283823456', 'abc', ''])('%s → không hợp lệ', (raw) => expect(parseVnBusinessPhone(raw)).toBeNull());

  it('gợi ý: chưa báo khi đang gõ dở; báo khi đủ 10 số mà sai, có chữ cái, hoặc đã rời ô', () => {
    expect(dealerPhoneHint('', true)).toBeNull();
    expect(dealerPhoneHint('0912345678', true)).toBeNull();
    expect(dealerPhoneHint('09123', false)).toBeNull();
    expect(dealerPhoneHint('09123', true)).toBe(DEALER_PHONE_HINT);
    expect(dealerPhoneHint('0112345678', false)).toBe(DEALER_PHONE_HINT);
    expect(dealerPhoneHint('09a', false)).toBe(DEALER_PHONE_HINT);
  });
});

describe('MST đại lý', () => {
  it('trống là hợp lệ (ô tuỳ chọn); 10 số, 10-3, 12 số hợp lệ', () => {
    for (const ok of ['', '  ', '0312345678', '0312345678-001', '031234567890', '0312 345 678']) expect(isDealerTaxCodeOk(ok)).toBe(true);
    for (const bad of ['031234', 'abc', '03123456789']) expect(isDealerTaxCodeOk(bad)).toBe(false);
  });

  it('gợi ý: gõ dở chưa báo, rời ô thì báo; ký tự lạ báo ngay', () => {
    expect(dealerTaxCodeHint('031234', false)).toBeNull();
    expect(dealerTaxCodeHint('031234', true)).toBe(DEALER_TAX_CODE_HINT);
    expect(dealerTaxCodeHint('03123x', false)).toBe(DEALER_TAX_CODE_HINT);
    expect(dealerTaxCodeHint('0312345678', true)).toBeNull();
  });

  it('gửi lên: bỏ khoảng trắng/dấu chấm, 13 số liền thành 10-3; trống thì không gửi', () => {
    expect(dealerTaxCodeForSubmit('0312 345.678')).toBe('0312345678');
    expect(dealerTaxCodeForSubmit('0312345678001')).toBe('0312345678-001');
    expect(dealerTaxCodeForSubmit('   ')).toBeUndefined();
  });

  it('lời gợi ý không dùng thuật ngữ cấm', () => {
    for (const text of [DEALER_TAX_CODE_HINT, DEALER_PHONE_HINT]) for (const { pattern } of FORBIDDEN_TERMS) expect(text).not.toMatch(pattern);
  });
});
