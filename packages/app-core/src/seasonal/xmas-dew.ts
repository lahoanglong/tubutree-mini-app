import type { ArcadeTheme } from '../arcade/arcade-canvas';
import { DEW_CATCH_Y, DEW_ITEMS, type DewCatcherState } from '../arcade/dew-catcher';

/** Hàm vẽ chữ của engine (`txt` trong `mountArcade`): toạ độ và cỡ theo tỉ lệ khung. */
export type ArcadeDraw = (t: string, x: number, y: number, size: number, color?: string, align?: string, alpha?: number) => void;

/**
 * Lớp áo mùa lễ của Hứng Giọt Sương (`mountArcade({ skin })`, engine chỉ áp cho Dew): `glyph` đổi hình chữ engine vẽ (món, vợt, cây nền), `paint`
 * vẽ thêm trên cùng mỗi khung. Chỉ đổi hình: luật, điểm, nhịp HUD giữ nguyên. Nằm ngoài `arcade/` để engine giữ dưới trần dung lượng của nó.
 */
export interface ArcadeSkin {
  glyph: Readonly<Record<string, string>>;
  paint(draw: ArcadeDraw, theme: ArcadeTheme, dt: number, s: DewCatcherState): void;
}

/** Bông tuyết 10 điểm, chuông 25, hộp quà đỏ 30 (gấp 3 bông tuyết): cùng món, cùng điểm với bản thường. */
export const XMAS_DEW_GLYPH: Readonly<Record<string, string>> = {
  [DEW_ITEMS.dew.emoji]: '❄️',
  [DEW_ITEMS.berry.emoji]: '🔔',
  [DEW_ITEMS.oil.emoji]: '🎁',
  '🍃': '🛷',
  '🌲': '🎄',
};

/**
 * Áo Noel: tuyết rơi chậm, vòng vàng nhấp nháy quanh hộp quà, chùm bông tuyết khi hứng; `onGift` khi hứng hộp quà (app phát tiếng chuông).
 * Món hứng nhận ra từ điểm (`points = điểm gốc × mult`). Giảm chuyển động: tuyết đứng yên, vòng không nhấp nháy, không có chùm.
 * `dt` = 0 (vẽ lại khi đổi cỡ lúc dừng) không đọc sự kiện, để một lần hứng không kêu hai lần.
 */
export function xmasDewSkin(reduced: boolean, onGift: () => void): ArcadeSkin {
  let clock = 0;
  let bursts: { x: number; age: number }[] = [];
  return {
    glyph: XMAS_DEW_GLYPH,
    paint(draw, theme, dt, s) {
      if (!reduced) clock += dt;
      for (let i = 0; i < 12; i++) {
        draw('❄', (i * 0.37 + 0.04 * Math.sin(clock / 900 + i)) % 1, ((clock / 1000) * (0.04 + (i % 4) * 0.012) + i / 12) % 1, 0.03, theme.sage, 'center', 0.55);
      }
      for (const it of s.items) if (it.kind === 'oil') draw('○', it.x, it.y, 0.12, theme.accent, 'center', reduced ? 0.8 : 0.55 + 0.35 * Math.sin(clock / 150));
      if (dt > 0) {
        for (const e of s.events) {
          if (e.type !== 'catch') continue;
          if (!reduced) bursts.push({ x: e.x, age: 0 });
          if (e.points === DEW_ITEMS.oil.points * e.mult) onGift();
        }
      }
      bursts = bursts.filter((b) => (b.age += dt) < 500);
      for (const b of bursts) {
        for (let k = 0; k < 6; k++) draw('❄', b.x + Math.cos(k * 1.05) * b.age * 1.6e-4, DEW_CATCH_Y + Math.sin(k * 1.05) * b.age * 1e-4, 0.035, theme.forest, 'center', 1 - b.age / 500);
      }
    },
  };
}
