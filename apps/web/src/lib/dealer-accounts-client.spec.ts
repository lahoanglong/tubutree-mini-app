import { describe, it, expect } from 'vitest';
import { diffTier, emptyTierForm, formatTerms, parseTierForm, tierToForm, type TierFormInput } from './dealer-accounts-client';

const FORM: TierFormInput = { id: 'DEALER_1', name: 'Đại lý Cấp 1', minOrderVolume: '10000000', discountPct: '20', creditLimit: '0', paymentTerms: 'PREPAID' };

describe('parseTierForm — kiểm tra sớm đúng luật API', () => {
  it('bậc hợp lệ → số đã đọc; điều kiện trống → null', () => {
    expect(parseTierForm(FORM, 45, true)).toEqual({
      value: { id: 'DEALER_1', name: 'Đại lý Cấp 1', minOrderVolume: 10_000_000, discountPct: 20, creditLimit: 0, paymentTerms: 'PREPAID' },
    });
    const r = parseTierForm({ ...FORM, paymentTerms: '  ' }, 45, true);
    expect('value' in r && r.value.paymentTerms).toBeNull();
  });

  it('chiết khấu nhận dấu phẩy kiểu Việt Nam và hậu tố %; chặn > trần, ≤ 0, quá 2 số lẻ, không phải số', () => {
    const ok = parseTierForm({ ...FORM, discountPct: '12,5%' }, 45, true);
    expect('value' in ok && ok.value.discountPct).toBe(12.5);
    for (const d of ['46', '0', '-3', '12.345', 'abc', '']) {
      const r = parseTierForm({ ...FORM, discountPct: d }, 45, true);
      expect('errors' in r).toBe(true);
    }
    const over = parseTierForm({ ...FORM, discountPct: '46' }, 45, true);
    expect('errors' in over && over.errors.join(' ')).toMatch(/tối đa 45%/);
  });

  it('hạn mức / doanh số: số nguyên đồng 0..2 tỷ, không dấu chấm phẩy lẫn lộn', () => {
    for (const v of ['-1', '1.5', '2000000001', 'abc', '']) {
      expect('errors' in parseTierForm({ ...FORM, creditLimit: v }, 45, true)).toBe(true);
      expect('errors' in parseTierForm({ ...FORM, minOrderVolume: v }, 45, true)).toBe(true);
    }
    expect('value' in parseTierForm({ ...FORM, creditLimit: '2000000000' }, 45, true)).toBe(true);
    const over = parseTierForm({ ...FORM, creditLimit: '2000000001' }, 45, true);
    expect('errors' in over && over.errors[0]).toBe('Hạn mức công nợ phải là số đồng nguyên từ 0 đến 2.000.000.000đ.');
  });

  it('điều kiện thanh toán PREPAID hoặc NET n; mã bậc chỉ kiểm khi tạo mới', () => {
    for (const t of ['net 30', 'NET 0', 'Trả sau', 'NET 400']) expect('errors' in parseTierForm({ ...FORM, paymentTerms: t }, 45, true)).toBe(true);
    expect('value' in parseTierForm({ ...FORM, paymentTerms: 'NET 30' }, 45, true)).toBe(true);
    expect('errors' in parseTierForm({ ...FORM, id: 'dealer 1' }, 45, true)).toBe(true);
    expect('value' in parseTierForm({ ...FORM, id: '' }, 45, false)).toBe(true);
  });

  it('gom mọi lỗi', () => {
    const r = parseTierForm({ id: '', name: '', minOrderVolume: 'x', discountPct: '99', creditLimit: '-1', paymentTerms: 'zzz' }, 45, true);
    expect('errors' in r && r.errors.length).toBe(6);
  });
});

describe('tierToForm / emptyTierForm / formatTerms / diffTier', () => {
  const tier = { id: 'DEALER_2', name: 'Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 20_000_000, paymentTerms: 'NET 15', dealerCount: 2 };
  it('đổi bậc → ô nhập chuỗi; bậc mới để trống', () => {
    expect(tierToForm(tier)).toEqual({ id: 'DEALER_2', name: 'Cấp 2', minOrderVolume: '30000000', discountPct: '30', creditLimit: '20000000', paymentTerms: 'NET 15' });
    expect(tierToForm({ ...tier, paymentTerms: null }).paymentTerms).toBe('');
    expect(emptyTierForm()).toMatchObject({ id: '', name: '', discountPct: '', creditLimit: '0' });
  });
  it('nhãn điều kiện thanh toán', () => {
    expect(formatTerms('PREPAID')).toBe('Trả trước');
    expect(formatTerms('NET 30')).toBe('Công nợ 30 ngày');
    expect(formatTerms(null)).toBe('Chưa đặt');
  });
  it('diffTier liệt kê đúng trường đổi, tiếng Việt, kèm giá trị cũ → mới', () => {
    expect(diffTier({ name: 'Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 20_000_000, paymentTerms: 'NET 15' }, { name: 'Cấp 2', minOrderVolume: 30_000_000, discountPct: 35, creditLimit: 25_000_000, paymentTerms: 'NET 15' })).toEqual([
      'Chiết khấu 30% → 35%',
      'Hạn mức công nợ 20.000.000đ → 25.000.000đ',
    ]);
    expect(diffTier(null, { name: 'A', minOrderVolume: 0, discountPct: 20, creditLimit: 0, paymentTerms: 'PREPAID' })).toEqual([
      'Tên A',
      'Doanh số tối thiểu 0đ',
      'Chiết khấu 20%',
      'Hạn mức công nợ 0đ',
      'Điều kiện thanh toán Trả trước',
    ]);
  });
});
