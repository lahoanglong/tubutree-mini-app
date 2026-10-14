import { describe, expect, it } from 'vitest';
import { fulfillerLabel } from './shipments';

describe('fulfillerLabel', () => {
  it('nơi giao và lý do không giao được (R2-MERCHANT-3/13)', () => {
    expect(fulfillerLabel({ kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' })).toBe('Tubu Tree giao');
    expect(fulfillerLabel({ kind: 'MERCHANT', storefrontId: 's', name: 'Gốm An' })).toBe('Gốm An giao');
    expect(fulfillerLabel({ kind: 'UNAVAILABLE', storefrontId: null, name: 'Gốm An', reason: 'STORE_PAUSED' })).toBe('Gốm An đang tạm nghỉ, chưa nhận đơn');
    expect(fulfillerLabel({ kind: 'UNAVAILABLE', storefrontId: null, name: 'Gốm An', reason: 'STORE_CLOSED' })).toBe('Gốm An đã ngừng bán');
    expect(fulfillerLabel({ kind: 'UNAVAILABLE', storefrontId: null, name: '' })).toBe('Không giao được');
  });
});
