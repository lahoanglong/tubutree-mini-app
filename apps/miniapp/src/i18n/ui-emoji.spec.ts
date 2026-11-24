import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * D7-6: chữ của nút, tiêu đề, huy hiệu dùng icon DS (lucide) thay emoji; emoji chỉ còn trong lời nhắn
 * khen/chúc ở toast và dòng giới thiệu. Thêm một dòng emoji mới vào `vi.ts` thì phải thêm KHOÁ của nó vào đây
 * kèm lý do, nếu không là chữ giao diện (đặt icon trong component).
 *
 * Dải ký tự giống scripts/uiux/static-scan.mjs, thêm ⌛ ⏳ ⭐ (ngoài dải của static-scan).
 */
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿⌚⌛⏩-⏿⭐]/u;

/** Lời nhắn/chúc hiện qua toast hoặc dòng giới thiệu — nội dung khích lệ, không phải nhãn điều khiển. */
const ENCOURAGEMENT_KEYS = new Set([
  'added', 'createdNow', 'createdScheduled', 'createdExisting',
  'successTitle', 'subtitle', 'reported', 'ok', 'claimOk', 'markDoneOk',
]);
/** Ký tự sao của điểm đánh giá ("Từ 4★"): chữ, không phải emoji; selector e2e đang dùng nguyên chuỗi này. */
const RATING_KEYS = new Set(['rating4Chip', 'rating4']);

// vi.ts và các tệp chữ tách riêng cho màn tải lười (vi-*.ts).
const I18N = join(process.cwd(), 'src/i18n');
const VI_FILES = readdirSync(I18N).filter((f) => /^vi(-[a-z-]+)?\.ts$/.test(f));
const lines = VI_FILES.flatMap((f) => readFileSync(join(I18N, f), 'utf8').split(/\r?\n/));

describe('i18n/vi.ts — emoji chỉ ở lời nhắn khích lệ', () => {
  it('mọi dòng có emoji thuộc danh sách lời nhắn đã duyệt', () => {
    const offenders = lines
      .map((text, i) => ({ n: i + 1, text, key: /^\s*(\w+):/.exec(text)?.[1] ?? '' }))
      .filter(({ text }) => EMOJI.test(text.replace(/\/\/.*$/, '')))
      .filter(({ key }) => !ENCOURAGEMENT_KEYS.has(key) && !RATING_KEYS.has(key))
      .map(({ n, text }) => `${n}: ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it('danh sách duyệt không còn khoá đã xoá: mỗi khoá còn ít nhất một dòng emoji trong vi.ts', () => {
    const emojiKeys = new Set(
      lines.filter((text) => EMOJI.test(text.replace(/\/\/.*$/, ''))).map((text) => /^\s*(\w+):/.exec(text)?.[1] ?? ''),
    );
    expect([...ENCOURAGEMENT_KEYS, ...RATING_KEYS].filter((k) => !emojiKeys.has(k))).toEqual([]);
  });
});
