import { describe, expect, it } from 'vitest';
import { tierRequirementText } from './guest-preview';

const pts = (n: number) => `${n} điểm`;
const money = (n: number) => `${n}đ`;
const tier = (minPoints: number, minSpending: number | null) => ({ id: 'T', name: 'T', minPoints, minSpending, multiplier: 1, perks: [] });

describe('tierRequirementText', () => {
  it('hạng đầu không điều kiện', () => expect(tierRequirementText(tier(0, null), pts, money)).toBe('Hạng khởi đầu'));
  it('hạng không có mốc chi tiêu: xét điểm tích luỹ', () => expect(tierRequirementText(tier(2500, null), pts, money)).toBe('Từ 2500 điểm tích luỹ'));
  it('hạng có mốc chi tiêu: chỉ nói tiền mua 12 tháng, không nhắc mốc điểm', () => {
    expect(tierRequirementText(tier(2500, 5_000_000), pts, money)).toBe('Chi tiêu từ 5000000đ trong 12 tháng');
  });
});
