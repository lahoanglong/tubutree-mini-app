import { describe, expect, it } from 'vitest';
import { ADDRESS_FIELD_ORDER as CORE_ORDER, firstInvalidAddressField, validateAddressFields } from '@tubutree/app-core/commerce/checkout-form';
import { ADDRESS_FIELD_ORDER, firstInvalidField, validateAddress } from './address-form';

describe('luật kiểm địa chỉ của web là luật dùng chung với Mini App', () => {
  it('validateAddress, firstInvalidField và thứ tự ô là đúng hàm của app-core, không bản sao riêng', () => {
    expect(validateAddress).toBe(validateAddressFields);
    expect(firstInvalidField).toBe(firstInvalidAddressField);
    expect(ADDRESS_FIELD_ORDER).toBe(CORE_ORDER);
  });
});
