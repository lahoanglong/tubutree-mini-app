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
    ['M6 33 C9 13 28 5 42 16 C35 12 20 16 10 30 C8 32 7 33 6 33 Z', 'amber'],
    ['M10 35 C18 23 30 18 41 21 C34 28 22 33 10 35 Z', 'sand'],
    ['M28 11 C31 8 36 8 39 11 C35 12 31 12 28 11 Z', 'leaf'],
  ]),
  'pomelo-slice': sprite('Lát bưởi', [
    ['M7 22 A18 18 0 0 0 41 28 L24 24 Z', 'amber'],
    ['M10 23 A14.5 14.5 0 0 0 38 27.5 L24 24 Z', 'sand'],
    ['M13 24.5 L23 24.5 L16 32 C14 30 13.2 27.5 13 24.5 Z', 'rose'],
    ['M24 25 L18 34 C21 36 25 36.5 28.5 35 L24 25 Z', 'rose'],
    ['M25 24.5 L30.5 34 C33.5 32.5 35.5 30 36.2 27.5 L25 24.5 Z', 'rose'],
  ]),
  'gleditsia-pod': sprite('Quả bồ kết', [
    ['M6 38 C5 22 19 8 42 8 C40 16 34 28 22 36 C16 39 10 40 6 38 Z', 'ink'],
    ['M12 33 C17 24 26 17 36 12 C31 20 23 28 12 33 Z', 'amber'],
    ['M16 30 A2.2 2.2 0 1 0 20.4 30 A2.2 2.2 0 1 0 16 30 Z', 'sand'],
    ['M24 23 A2.2 2.2 0 1 0 28.4 23 A2.2 2.2 0 1 0 24 23 Z', 'sand'],
    ['M31 17 A1.9 1.9 0 1 0 34.8 17 A1.9 1.9 0 1 0 31 17 Z', 'sand'],
  ]),
  'ocimum-leaf': sprite('Lá hương nhu', [
    ['M24 5 C35 12 39 24 33 35 C29 40 26 42 24 44 C22 42 19 40 15 35 C9 24 13 12 24 5 Z', 'leaf'],
    ['M23.4 9 L24.6 9 L24.6 41 L23.4 41 Z', 'sand'],
    ['M24 18 L31 14 L31.6 15.1 L24 19.3 Z', 'sand'],
    ['M24 26 L32 21.5 L32.6 22.6 L24 27.3 Z', 'sand'],
    ['M24 22 L16.5 17.5 L15.9 18.6 L24 23.3 Z', 'sand'],
    ['M24 30 L16.5 25.5 L15.9 26.6 L24 31.3 Z', 'sand'],
  ]),
  lemongrass: sprite('Sả chanh', [
    ['M8 43 C11 25 22 11 41 5 C34 19 23 33 12 43 Z', 'leaf'],
    ['M14 43 C18 29 27 18 42 12 C35 24 26 35 18 43 Z', 'leaf'],
    ['M11 43 C14 33 19 25 26 19 C22 28 17 36 14 43 Z', 'sand'],
  ]),
  'centella-leaf': sprite('Lá rau má', [
    ['M24 26 C21 20 14 19 10 24 C6 17 11 8 20 7 C23 6.5 25 6.5 28 7 C37 8 42 17 38 24 C34 19 27 20 24 26 Z', 'leaf'],
    ['M23.4 25 L24.6 25 L26 42 L24.5 42 Z', 'leaf'],
    ['M24 24 L16 14 L17 13.2 L24.6 23.2 Z', 'sand'],
    ['M24 24 L24 11 L25.2 11 L25.2 24 Z', 'sand'],
    ['M24 24 L32 14 L31 13.2 L23.4 23.2 Z', 'sand'],
  ]),
  'shea-butter': sprite('Bơ hạt mỡ', [
    ['M8 29 C8 17 18 10 28 12 C39 14 43 24 38 34 C33 42 14 42 8 29 Z', 'sand'],
    ['M14 25 C16 18 24 15 31 18 C35 20 36 25 32 29 C27 33 17 32 14 25 Z', 'amber'],
    ['M19 23 C21 20 25 19 28 21 C25 23 22 24 19 23 Z', 'sand'],
  ]),
  'arabica-bean': sprite('Hạt cà phê Arabica', [
    ['M24 5 C36 5 42 15 40 28 C38 39 29 44 21 43 C10 41 6 30 9 17 C11 9 17 5 24 5 Z', 'ink'],
    ['M22.5 8 C28.5 17.5 19.5 28.5 25.5 41 L27.3 40.3 C21.5 28.5 30.5 17.5 24.3 8 Z', 'sand'],
    ['M14 18 C15 13 18 10 21 9 C18 12 16 15 14 18 Z', 'amber'],
  ]),
  'honey-drop': sprite('Giọt mật ong', [
    ['M24 4 C31.5 15.5 37.5 23.5 37.5 30.5 A13.5 13.5 0 0 1 10.5 30.5 C10.5 23.5 16.5 15.5 24 4 Z', 'amber'],
    ['M16 28 C16 33.5 19.5 37.5 24 38.5 C20 35 18.5 31.5 18 28 Z', 'sand'],
    ['M24 11 C27.5 17 31 22 31.5 26.5 C29.5 22.5 26.8 17.5 24 11 Z', 'sand'],
  ]),
  'pineapple-enzyme': sprite('Lát dứa', [
    ['M24 5 C34.5 5 43 13.5 43 24 C43 34.5 34.5 43 24 43 C13.5 43 5 34.5 5 24 C5 13.5 13.5 5 24 5 Z', 'amber'],
    ['M24 17.5 A6.5 6.5 0 1 0 24.01 17.5 Z', 'sand'],
    ['M23.4 7 L24.6 7 L24.6 15.5 L23.4 15.5 Z', 'sand'],
    ['M23.4 32.5 L24.6 32.5 L24.6 41 L23.4 41 Z', 'sand'],
    ['M7 23.4 L15.5 23.4 L15.5 24.6 L7 24.6 Z', 'sand'],
    ['M32.5 23.4 L41 23.4 L41 24.6 L32.5 24.6 Z', 'sand'],
    ['M11.8 12.8 L12.8 11.8 L18.5 17.5 L17.5 18.5 Z', 'sand'],
    ['M30.5 29.5 L36.2 35.2 L35.2 36.2 L29.5 30.5 Z', 'sand'],
  ]),
  'granola-clusters': sprite('Hạt granola', [
    ['M8 29 C7 23 12 19 18 21 C23 22 25 28 21 33 C17 37 9 35 8 29 Z', 'sand'],
    ['M22 18 C22 12 28 9 34 11 C40 13 42 20 37 25 C32 29 22 25 22 18 Z', 'amber'],
    ['M21 36 C21 31 26 28 32 30 C37 31 38 37 34 41 C29 44 21 41 21 36 Z', 'sand'],
    ['M13 13 C15 10 20 10 21 14 C19 17 14 17 13 13 Z', 'leaf'],
  ]),
  'cajeput-leaf': sprite('Lá tràm gió', [
    ['M21 5 C29 16 30 31 22 43 C15 32 14 17 21 5 Z', 'leaf'],
    ['M28 11 C35 19 36 31 29 41 C25 33 25 21 28 11 Z', 'leaf'],
    ['M20.5 10 L21.7 10 L22 39 L20.8 39 Z', 'sand'],
  ]),
  'water-droplet': sprite('Giọt nước', [
    ['M24 4 C31.5 15 37.5 23 37.5 30 A13.5 13.5 0 0 1 10.5 30 C10.5 23 16.5 15 24 4 Z', 'sky'],
    ['M16 28 C16 33 19.5 36.8 23.8 37.8 C20 34.2 18.5 31 17.8 28 Z', 'sand'],
    ['M25 11 C28 16.5 31 21.5 31.5 25.5 C29.5 21.8 27 17 25 11 Z', 'sand'],
  ]),
  'oil-drop': sprite('Giọt dầu', [
    ['M24 4 C31.5 15 37.5 23 37.5 30 A13.5 13.5 0 0 1 10.5 30 C10.5 23 16.5 15 24 4 Z', 'amber'],
    ['M16 27.5 C16 32.5 19.5 36.5 23.8 37.5 C20 34 18.5 30.8 17.8 27.5 Z', 'sand'],
    ['M33 12 A3 3 0 1 0 39 12 A3 3 0 1 0 33 12 Z', 'amber'],
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
