import { describe, expect, it } from 'vitest';
import { STORY_SPRITE_CHOICES } from '@tubutree/shared-types';
import { STORY_SPRITES, spriteForIngredient } from './story-sprites';

const SPEC_SPRITES = [
  'pomelo-peel',
  'pomelo-slice',
  'gleditsia-pod',
  'ocimum-leaf',
  'lemongrass',
  'centella-leaf',
  'shea-butter',
  'arabica-bean',
  'honey-drop',
  'pineapple-enzyme',
  'granola-clusters',
  'cajeput-leaf',
  'water-droplet',
  'oil-drop',
];

describe('STORY_SPRITES', () => {
  it('danh sách mã và tên của shared-types (API dặn AI) khớp đúng thư viện vẽ', () => {
    expect(STORY_SPRITE_CHOICES.map((c) => c.id).sort()).toEqual(Object.keys(STORY_SPRITES).sort());
    for (const c of STORY_SPRITE_CHOICES) expect(STORY_SPRITES[c.id]?.label, c.id).toBe(c.label);
  });

  it('có đủ thư viện nguyên liệu của spec', () => {
    for (const id of SPEC_SPRITES) expect(STORY_SPRITES, id).toHaveProperty(id);
  });

  it('mỗi sprite có nhãn tiếng Việt, viewBox vuông 48 và ít nhất một nét hợp lệ', () => {
    for (const [id, s] of Object.entries(STORY_SPRITES)) {
      expect(s.label.trim(), id).not.toBe('');
      expect(s.viewBox, id).toBe('0 0 48 48');
      expect(s.paths.length, id).toBeGreaterThan(0);
      for (const p of s.paths) {
        expect(p.d, id).toMatch(/^M[\d\s.,MmCcLlHhVvAaZz-]+$/);
        expect(['leaf', 'amber', 'rose', 'sky', 'sand', 'ink']).toContain(p.tone);
      }
    }
  });
});

describe('spriteForIngredient', () => {
  it.each([
    ['Tinh dầu bưởi', 'pomelo-peel'],
    ['Bồ kết', 'gleditsia-pod'],
    ['Hương nhu', 'ocimum-leaf'],
    ['Tinh dầu sả', 'lemongrass'],
    ['Chiết xuất rau má', 'centella-leaf'],
    ['Bơ hạt mỡ (Shea)', 'shea-butter'],
    ['Arabica Cầu Đất 1.650m', 'arabica-bean'],
    ['Mật ong rừng', 'honey-drop'],
    ['Enzyme dứa lên men', 'pineapple-enzyme'],
    ['Granola ngũ cốc hạt', 'granola-clusters'],
    ['Tinh dầu tràm Huế', 'cajeput-leaf'],
    ['Dầu jojoba', 'oil-drop'],
    ['Hyaluronic Acid', 'water-droplet'],
  ])('%s → %s', (name, id) => {
    expect(spriteForIngredient(name)).toBe(id);
  });

  it('tên lạ hoặc rỗng rơi về giọt nước, luôn là sprite có thật', () => {
    for (const name of ['', '   ', 'xyz', '12345']) expect(STORY_SPRITES).toHaveProperty(spriteForIngredient(name));
    expect(spriteForIngredient('xyz')).toBe('water-droplet');
  });
});
