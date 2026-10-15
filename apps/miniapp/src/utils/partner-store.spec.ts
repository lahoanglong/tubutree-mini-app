import { describe, expect, it } from 'vitest';
import { isPartnerStore } from './partner-store';

describe('isPartnerStore', () => {
  it('ưu tiên isPartner do API trả', () => {
    expect(isPartnerStore({ type: 'CTV', isPartner: true })).toBe(true);
    expect(isPartnerStore({ type: 'CTV', isPartner: false })).toBe(false);
    expect(isPartnerStore({ type: 'MERCHANT', isPartner: false })).toBe(false);
  });
  it('thiếu isPartner thì xét theo type như trước', () => {
    expect(isPartnerStore({ type: 'MERCHANT' })).toBe(true);
    expect(isPartnerStore({ type: 'CTV' })).toBe(false);
    expect(isPartnerStore({ type: 'BRAND' })).toBe(false);
    expect(isPartnerStore({ type: 'MERCHANT', isPartner: null })).toBe(true);
  });
  it('chưa có gian hàng', () => {
    expect(isPartnerStore(undefined)).toBe(false);
    expect(isPartnerStore(null)).toBe(false);
  });
});
