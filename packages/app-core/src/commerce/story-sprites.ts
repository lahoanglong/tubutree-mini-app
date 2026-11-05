/**
 * Thư viện nguyên liệu tách nền (vector, viewBox 48x48, chỉ nét tô). Màu là tên token semantic `--color-story-tone-*`:
 * app vẽ bằng `toneVar(tone)`, không có hex ở đây. Sprite chỉ để trang trí nên luôn `aria-hidden`.
 */
export type StoryTone = 'leaf' | 'amber' | 'rose' | 'sky' | 'sand' | 'ink';

export interface StorySprite {
  label: string;
  viewBox: '0 0 48 48';
  paths: { d: string; tone: StoryTone }[];
}

const VB = '0 0 48 48' as const;
const sprite = (label: string, paths: [string, StoryTone][]): StorySprite => ({
  label,
  viewBox: VB,
  paths: paths.map(([d, tone]) => ({ d, tone })),
});

export const STORY_SPRITES: Record<string, StorySprite> = {
  'pomelo-peel': sprite('Vỏ bưởi', [
    ['M5 31 C9 12 30 5 43 18 C34 13 17 17 5 31 Z', 'amber'],
    ['M9 33 C18 22 30 19 40 22 C32 27 20 31 9 33 Z', 'sand'],
  ]),
  'pomelo-slice': sprite('Lát bưởi', [
    ['M24 5 A19 19 0 1 0 24.01 5 Z', 'amber'],
    ['M24 11 A13 13 0 1 0 24.01 11 Z', 'sand'],
    ['M23.2 12 H24.8 V36 H23.2 Z', 'amber'],
  ]),
  'gleditsia-pod': sprite('Quả bồ kết', [
    ['M7 39 C4 22 20 7 41 8 C39 15 35 27 23 35 C18 38 11 41 7 39 Z', 'ink'],
    ['M13 33 C17 24 25 17 34 13 C30 21 23 28 13 33 Z', 'sand'],
  ]),
  'ocimum-leaf': sprite('Lá hương nhu', [
    ['M24 5 C39 14 39 34 24 43 C9 34 9 14 24 5 Z', 'leaf'],
    ['M23.3 11 H24.7 V38 H23.3 Z', 'sand'],
  ]),
  lemongrass: sprite('Sả chanh', [
    ['M9 43 C11 24 22 10 41 5 C35 19 24 33 13 43 Z', 'leaf'],
    ['M17 43 C20 30 28 20 38 15 C34 26 27 36 17 43 Z', 'sand'],
  ]),
  'centella-leaf': sprite('Lá rau má', [
    ['M24 24 L24 6 A18 18 0 1 1 11 12 Z', 'leaf'],
    ['M24 24 L24 9 A15 15 0 0 1 36 15 Z', 'sand'],
  ]),
  'shea-butter': sprite('Bơ hạt mỡ', [
    ['M7 28 C7 15 18 9 27 11 C39 14 43 25 38 35 C33 43 13 43 7 28 Z', 'sand'],
    ['M15 22 C17 17 24 15 29 17 C24 20 19 22 15 22 Z', 'amber'],
  ]),
  'arabica-bean': sprite('Hạt cà phê Arabica', [
    ['M24 5 C37 5 43 16 41 28 C39 40 28 45 20 43 C9 39 5 28 9 16 C11 9 17 5 24 5 Z', 'ink'],
    ['M22 8 C29 18 20 28 26 43 L27.8 42.4 C22 28 31 18 23.8 8 Z', 'sand'],
  ]),
  'honey-drop': sprite('Giọt mật ong', [
    ['M24 4 C32 16 38 24 38 31 A14 14 0 0 1 10 31 C10 24 16 16 24 4 Z', 'amber'],
    ['M18 30 C18 34 21 37 24 38 C21 34 20 31 18 30 Z', 'sand'],
  ]),
  'pineapple-enzyme': sprite('Lát dứa', [
    ['M24 5 A19 19 0 1 0 24.01 5 Z', 'amber'],
    ['M24 18 A6 6 0 1 0 24.01 18 Z', 'sand'],
    ['M23.4 6 H24.6 V16 H23.4 Z', 'sand'],
  ]),
  'granola-clusters': sprite('Hạt granola', [
    ['M5 30 A8 8 0 1 0 21 30 A8 8 0 1 0 5 30 Z', 'sand'],
    ['M22 20 A9 9 0 1 0 40 20 A9 9 0 1 0 22 20 Z', 'amber'],
    ['M20 38 A7 7 0 1 0 34 38 A7 7 0 1 0 20 38 Z', 'sand'],
  ]),
  'cajeput-leaf': sprite('Lá tràm gió', [
    ['M24 4 C32 18 32 34 24 44 C16 34 16 18 24 4 Z', 'leaf'],
    ['M23.4 10 H24.6 V40 H23.4 Z', 'sand'],
  ]),
  'water-droplet': sprite('Giọt nước', [
    ['M24 4 C32 15 38 23 38 30 A14 14 0 0 1 10 30 C10 23 16 15 24 4 Z', 'sky'],
    ['M17 29 C17 33 20 36 23 37 C20 33 19 31 17 29 Z', 'sand'],
  ]),
  'oil-drop': sprite('Giọt dầu', [
    ['M24 4 C32 15 38 23 38 30 A14 14 0 0 1 10 30 C10 23 16 15 24 4 Z', 'amber'],
    ['M16 28 C16 32 19 35 22 36 C19 32 18 30 16 28 Z', 'sand'],
  ]),
};

/**
 * Thứ tự quan trọng: "Tinh dầu bưởi/sả/tràm" phải ra bưởi/sả/tràm trước khi rơi vào "dầu" chung.
 * So khớp trên chữ thường (còn dấu) vì tên thành phần do người nhập bằng tiếng Việt có dấu.
 */
const RULES: [RegExp, string][] = [
  [/bưởi/, 'pomelo-peel'],
  [/bồ kết/, 'gleditsia-pod'],
  [/hương nhu/, 'ocimum-leaf'],
  [/sả/, 'lemongrass'],
  [/rau má/, 'centella-leaf'],
  [/shea|bơ hạt mỡ/, 'shea-butter'],
  [/arabica|robusta|cà phê/, 'arabica-bean'],
  [/mật ong/, 'honey-drop'],
  [/dứa|enzyme/, 'pineapple-enzyme'],
  [/granola|ngũ cốc|hạt/, 'granola-clusters'],
  [/tràm/, 'cajeput-leaf'],
  [/dầu|jojoba/, 'oil-drop'],
];

export function spriteForIngredient(name: string): string {
  const n = typeof name === 'string' ? name.toLowerCase() : '';
  for (const [re, id] of RULES) if (re.test(n)) return id;
  return 'water-droplet';
}
