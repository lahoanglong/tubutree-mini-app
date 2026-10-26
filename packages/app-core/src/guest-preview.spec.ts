import { describe, expect, it } from 'vitest';
import { tierRequirementText } from './guest-preview';

const pts = (n: number) => `${n} điểm`;
const money = (n: number) => `${n}đ`;
const tier = (minPoints: number, minSpending: number | null) => ({ id: 'T', name: 'T', minPoints, minSpending, multiplier: 1, perks: [] });

describe('tierRequirementText', () => {
  it('hạng đầu không điều kiện', () => expect(tierRequirementText(tier(0, null), pts, money)).toBe('Hạng khởi đầu'));
  it('chỉ mốc điểm', () => expect(tierRequirementText(tier(2500, null), pts, money)).toBe('Từ 2500 điểm'));
  it('thêm mốc chi tiêu', () => expect(tierRequirementText(tier(2500, 5_000_000), pts, money)).toBe('Từ 2500 điểm · chi tiêu 5000000đ'));
});
