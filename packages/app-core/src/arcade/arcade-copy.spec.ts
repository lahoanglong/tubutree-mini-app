import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fillCopy, FORBIDDEN_TERMS, SHOP_COPY } from '../shop-copy';
import { SHOP_COPY_MAX } from '../shop-copy-budget';
import { ARCADE_GAME_IDS } from './arcade-config';
import { RUSH_STATIONS } from './refill-rush';

const DIR = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
  .map((f) => [f, readFileSync(join(DIR, f), 'utf8')] as const);

const arcadeKeys = Object.keys(SHOP_COPY).filter((k) => k.startsWith('arcade.') || k.startsWith('homeQuiz.'));

describe('khoá chữ arcade.* và homeQuiz.*', () => {
  it('mọi khoá viết thẳng trong mã nguồn arcade có trong SHOP_COPY', () => {
    const literal = /fillCopy\(\s*['"]([^'"]+)['"]/g;
    const found: string[] = [];
    for (const [, src] of sources) for (const m of src.matchAll(literal)) found.push(m[1]!);
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const key of found) expect(Object.prototype.hasOwnProperty.call(SHOP_COPY, key), key).toBe(true);
  });

  it('khoá ghép theo trạm, khung giờ, sự kiện, câu hỏi đều có đủ', () => {
    const keys: string[] = [];
    for (const st of RUSH_STATIONS) keys.push(`arcade.station.${st}.short`, `arcade.station.${st}.sub`, `arcade.station.${st}`);
    for (const w of ['SUONG_SOM', 'MUA_RAO']) keys.push(`arcade.window.${w}`, `arcade.badge.active.${w}`, `arcade.badge.next.${w}`);
    for (const ev of ['wrong', 'late']) keys.push(`arcade.hud.${ev}`);
    for (const id of ['family', 'worry', 'format']) keys.push(`homeQuiz.${id}.title`);
    for (const v of ['baby_pet', 'adult_only']) keys.push(`homeQuiz.family.${v}`);
    for (const v of ['dry_skin', 'strong_scent', 'grease']) keys.push(`homeQuiz.worry.${v}`);
    for (const v of ['bottle', 'refill']) keys.push(`homeQuiz.format.${v}`);
    for (const g of ARCADE_GAME_IDS) {
      const short = g === 'dew_catcher' ? 'dew' : 'rush';
      for (const part of ['title', 'desc', 'how', 'keys', 'aria']) keys.push(`arcade.${short}.${part}`);
    }
    for (const key of keys) expect(SHOP_COPY[key], key).toBeTypeOf('string');
  });

  it('mỗi khoá có ngân sách độ dài; chỉ dùng biến {n} và {m}; không có dấu chấm than', () => {
    expect(arcadeKeys.length).toBeGreaterThan(60);
    for (const key of arcadeKeys) {
      expect(Object.prototype.hasOwnProperty.call(SHOP_COPY_MAX, key), key).toBe(true);
      for (const m of SHOP_COPY[key]!.matchAll(/\{(\w+)\}/g)) expect(['n', 'm'], `${key} {${m[1]}}`).toContain(m[1]);
      expect(SHOP_COPY[key], key).not.toContain('!');
    }
  });

  it('không dính từ cấm khi điền số xấu nhất', () => {
    for (const key of arcadeKeys) {
      const text = fillCopy(key, { n: 99, m: 59 });
      for (const { pattern } of FORBIDDEN_TERMS) expect(text, `${key}: ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('câu chữ theo hợp đồng W164', () => {
  it('hết lượt thưởng vẫn phá kỷ lục được', () => {
    expect(fillCopy('arcade.result.capped')).toBe('Hết lượt thưởng hôm nay, bạn vẫn phá kỷ lục được 🌿');
  });

  it('lý do không thưởng nêu rõ khi ván thấp điểm hoặc không hợp lệ (tên khoá cố định cho Mini và web)', () => {
    expect(fillCopy('arcade.result.lowScore')).toBe('Ván này chưa đủ điểm để nhận thưởng. Chơi thêm một ván nhé 🌿');
    expect(fillCopy('arcade.result.invalid')).toBe('Điểm ván này chưa hợp lệ nên chưa được lưu.');
    for (const key of ['arcade.result.lowScore', 'arcade.result.invalid']) {
      expect(SHOP_COPY_MAX[key], key).toBeGreaterThanOrEqual(SHOP_COPY[key]!.length);
      expect(SHOP_COPY[key]).not.toContain('!');
    }
  });

  it('nút đăng nhập của khách nêu số Giọt nước nhận được', () => {
    expect(fillCopy('arcade.guest.login', { n: 8 })).toBe('Đăng nhập lưu kỷ lục & nhận ngay 8 Giọt nước vào Vườn');
    expect(fillCopy('arcade.guest.login', { n: 10 })).toContain('10 Giọt nước');
  });

  it('thẻ Chẩn đoán tổ ấm: tên, lời mời và quà lần đầu', () => {
    expect(fillCopy('homeQuiz.card.title')).toBe('Chẩn đoán tổ ấm');
    expect(fillCopy('homeQuiz.card.reward')).toContain('Giọt nước');
    expect(fillCopy('homeQuiz.step', { n: 2, m: 3 })).toBe('Câu 2/3');
  });

  it('tên hai game đúng như khách gọi', () => {
    expect(fillCopy('arcade.dew.title')).toBe('Hứng Sương Tinh Khiết');
    expect(fillCopy('arcade.rush.title')).toBe('Phân Loại Vỏ Chai Thần Tốc');
  });
});
