import { describe, expect, it } from 'vitest';
import { MERGE_TIER_ART, ARCADE_TONES, GOLDEN_DROP_ART, type ArcadeShape } from '../game-mini/arcade-art';
import { ARCADE_SFX_NOTES, readSoundOn } from '../game-mini/arcade-sfx';
import { mergeTierName } from '../game-mini/eco-merge';
import { miniGameTitle } from '../game-mini/format';
import { SFX_CUES } from '../game-hub/sfx';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { XMAS_GOLDEN_ART, XMAS_MERGE_ART, XMAS_MERGE_WIN, xmasTierName } from './xmas-arcade';
import { XMAS_DEW_GLYPH, xmasDewSkin } from './xmas-dew';
import { DEW_ITEMS, type DewCatcherState } from '../arcade/dew-catcher';
import { drawXmasCard, wrapLines, XMAS_CARD_PALETTE_VARS, XMAS_CARD_SIZE, type XmasCardCtx, type XmasCardPalette } from './xmas-card';
import {
  ORNAMENTS,
  ORNAMENT_ART,
  XMAS_TREE_KEY,
  readTreeState,
  slotState,
  tapMessage,
  tapOrnament,
  writeTreeState,
  xmasTreeCopy,
  type OrnamentProgress,
  type TreeState,
} from './xmas-tree';

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

const NEW: OrnamentProgress = { streakDays: 0, activeToday: false, drops: 0, harvested: 0 };
const ALL: OrnamentProgress = { streakDays: 7, activeToday: true, drops: 50, harvested: 1 };
const EMPTY: TreeState = { u: [], on: [] };

describe('Cây Thông Noel Tự Trang Trí: mở khoá', () => {
  it('khu vườn mới chỉ có Ngôi sao sẵn mở; đủ mốc thì từng món chuyển sang sẵn mở, đúng ngưỡng', () => {
    expect(ORNAMENTS.map((id) => slotState(EMPTY, id, NEW))).toEqual(['ready', 'locked', 'locked', 'locked', 'locked', 'locked']);
    expect(ORNAMENTS.map((id) => slotState(EMPTY, id, ALL))).toEqual(Array(6).fill('ready'));
    const at = (p: Partial<OrnamentProgress>) => ORNAMENTS.filter((id) => slotState(EMPTY, id, { ...NEW, ...p }) === 'ready');
    expect(at({ activeToday: true })).toEqual(['star', 'lights']);
    expect(at({ streakDays: 2 })).toEqual(['star']);
    expect(at({ streakDays: 3 })).toEqual(['star', 'baubles']);
    expect(at({ streakDays: 6 })).toEqual(['star', 'baubles']);
    expect(at({ streakDays: 7 })).toEqual(['star', 'baubles', 'reindeer']);
    expect(at({ drops: 49 })).toEqual(['star']);
    expect(at({ drops: 50 })).toEqual(['star', 'gifts']);
    expect(at({ harvested: 1 })).toEqual(['star', 'wreath']);
  });

  it('chạm món sẵn mở thì mở và treo luôn; chạm lại thì cất, rồi treo; món đã mở không khoá lại khi mốc tụt', () => {
    const a = tapOrnament(EMPTY, 'baubles', { ...NEW, streakDays: 3 });
    expect(a.event).toBe('unlocked');
    expect(a.next).toEqual({ u: ['baubles'], on: ['baubles'] });
    const b = tapOrnament(a.next, 'baubles', NEW);
    expect(b.event).toBe('off');
    expect(b.next).toEqual({ u: ['baubles'], on: [] });
    const c = tapOrnament(b.next, 'baubles', NEW);
    expect(c.event).toBe('on');
    expect(c.next).toEqual({ u: ['baubles'], on: ['baubles'] });
  });

  it('mở khoá idempotent: món chưa đủ mốc trả lại đúng object cũ; mở lần hai không thêm trùng; thứ tự theo ORNAMENTS', () => {
    const locked = tapOrnament(EMPTY, 'reindeer', NEW);
    expect(locked.event).toBe('locked');
    expect(locked.next).toBe(EMPTY);
    let s = EMPTY;
    for (const id of ['wreath', 'star', 'gifts'] as const) s = tapOrnament(s, id, ALL).next;
    expect(s).toEqual({ u: ['star', 'gifts', 'wreath'], on: ['star', 'gifts', 'wreath'] });
    const again = tapOrnament(s, 'star', ALL);
    expect(again.event).toBe('off');
    expect(again.next.u).toEqual(s.u);
    const back = tapOrnament(again.next, 'star', ALL).next;
    expect(back).toEqual(s);
  });

  it('lời nhắc của món khoá nói cách mở; các sự kiện khác nêu tên món', () => {
    expect(tapMessage('locked', 'reindeer')).toBe('Điểm danh 7 ngày liền để mở');
    expect(tapMessage('unlocked', 'star')).toBe('Mở được Ngôi sao đỉnh cây!');
    expect(tapMessage('on', 'gifts')).toBe('Đã treo Hộp quà xanh');
    expect(tapMessage('off', 'wreath')).toBe('Đã cất Vòng nguyệt quế');
  });
});

describe('Cây Thông Noel Tự Trang Trí: lưu trên máy', () => {
  it('ghi rồi đọc lại đúng cây; dữ liệu hỏng, mã lạ, món treo mà chưa mở đều bị loại', () => {
    const s = memory();
    expect(readTreeState(s)).toEqual(EMPTY);
    writeTreeState(s, { u: ['star', 'lights'], on: ['star'] });
    expect(readTreeState(s)).toEqual({ u: ['star', 'lights'], on: ['star'] });
    s.setItem(XMAS_TREE_KEY, JSON.stringify({ u: ['lights', 'unicorn', 'star', 'star'], on: ['gifts', 'lights'] }));
    expect(readTreeState(s)).toEqual({ u: ['star', 'lights'], on: ['lights'] });
    for (const bad of ['{', '"x"', '[]', 'null', '{"u":"star"}']) {
      s.setItem(XMAS_TREE_KEY, bad);
      expect(readTreeState(s), bad).toEqual(EMPTY);
    }
  });

  it('bộ nhớ bị chặn hay không có: đọc ra cây trống, ghi không ném', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readTreeState(blocked)).toEqual(EMPTY);
    expect(() => writeTreeState(blocked, { u: ['star'], on: ['star'] })).not.toThrow();
    expect(readTreeState(null)).toEqual(EMPTY);
  });
});

describe('Cây Thông Noel Tự Trang Trí: chữ và hình', () => {
  const lines = [...Object.values(xmasTreeCopy.names), ...Object.values(xmasTreeCopy.hints), ...(['unlocked', 'on', 'off'] as const).map((e) => tapMessage(e, 'wreath'))];
  const strings = [
    ...lines,
    ...ORNAMENTS.map((id) => xmasTreeCopy.slotAria(xmasTreeCopy.names[id], 'locked', xmasTreeCopy.hints[id])),
    xmasTreeCopy.slotAria('Dây đèn ấm', 'ready', ''),
    xmasTreeCopy.trayLabel(6),
    xmasTreeCopy.treeAria(6),
    xmasTreeCopy.share,
    xmasTreeCopy.shareTitle,
    xmasTreeCopy.shareCta,
    xmasTreeCopy.shareCtaWeb,
    xmasTreeCopy.greeting,
    xmasTreeCopy.cardLine('Nguyễn Thị Phương Thảo', 6),
    xmasTreeCopy.cardInvite,
    xmasTreeCopy.zaloTitle('Thảo'),
    xmasTreeCopy.zaloText(6),
    xmasTreeCopy.copied,
    xmasTreeCopy.saved,
    xmasTreeCopy.shareFailed,
    XMAS_MERGE_WIN,
  ];

  it('không có thuật ngữ cấm', () => {
    for (const s of strings) for (const t of FORBIDDEN_TERMS) expect(t.pattern.test(s), `"${s}" dùng ${t.use}`).toBe(false);
  });

  it('tên món và lời nhắc vừa một dòng của thẻ đầu ở khổ 320px; tiêu đề, lời gửi Zalo trong trần của zmp-sdk', () => {
    for (const s of lines) expect(s.length, s).toBeLessThanOrEqual(32);
    expect(xmasTreeCopy.share.length).toBeLessThanOrEqual(10);
    expect(xmasTreeCopy.zaloTitle('a'.repeat(60)).length).toBeLessThanOrEqual(100);
    expect(xmasTreeCopy.zaloText(6).length).toBeLessThanOrEqual(400);
  });

  it('mỗi món có đúng một cách vẽ ở khay: khung cắt hình trên cây, hoặc biểu tượng riêng (đèn, quả châu rải khắp cây)', () => {
    for (const id of ORNAMENTS) {
      const crop = ORNAMENT_ART.tray[id];
      const icon = (ORNAMENT_ART.icons as Record<string, unknown>)[id];
      expect(Boolean(crop) !== Boolean(icon), id).toBe(true);
      if (crop) expect(crop.split(' ').map(Number).every(Number.isFinite), id).toBe(true);
    }
  });
});

describe('Áo Noel của hai game thao tác', () => {
  const tones = new Set<string>(ARCADE_TONES);
  const toneOf = (s: ArcadeShape) => ('fill' in s ? s.fill : s.stroke);

  it('8 bậc ô Noel, chỉ dùng tông có sẵn (CSS ánh tông sang token, không mã màu)', () => {
    expect(Object.keys(XMAS_MERGE_ART)).toEqual(Object.keys(MERGE_TIER_ART));
    for (const shapes of Object.values(XMAS_MERGE_ART)) {
      expect(shapes.length).toBeGreaterThan(0);
      for (const s of shapes) expect(tones.has(toneOf(s)), JSON.stringify(s)).toBe(true);
    }
    for (const s of XMAS_GOLDEN_ART) expect(toneOf(s)).toBe('gold');
    expect(XMAS_GOLDEN_ART).not.toEqual(GOLDEN_DROP_ART);
  });

  it('tên bậc Noel theo PO (2 Bông tuyết … 256+ Thông Tubu), vừa ô như tên thường; mùa thường giữ tên cũ', () => {
    expect([2, 4, 8, 16, 32, 64, 128, 256, 1024].map(xmasTierName)).toEqual([
      'Bông tuyết',
      'Lá thông',
      'Quả châu',
      'Chuông vàng',
      'Nguyệt quế',
      'Người tuyết',
      'Tuần lộc',
      'Thông Tubu',
      'Thông Tubu',
    ]);
    expect(mergeTierName(2)).toBe('Hạt giống');
    expect(mergeTierName(256)).toBe('Rừng Tubu');
    for (const v of [2, 4, 8, 16, 32, 64, 128, 256]) expect(xmasTierName(v).length).toBeLessThanOrEqual(11);
  });

  it('tên Băng Chuyền mùa Noel chỉ khi bật; game không có tên mùa giữ tên thường', () => {
    expect(miniGameTitle('green_conveyor')).toBe('Băng Chuyền Xanh');
    expect(miniGameTitle('green_conveyor', true)).toBe('Xưởng Gói Quà Ông Già Noel Xanh');
    expect(miniGameTitle('eco_merge', true)).toBe(miniGameTitle('eco_merge'));
  });
});

describe('Tiếng chuông Noel (WebAudio tổng hợp, không tệp âm thanh)', () => {
  it('Vườn Xanh và bàn chơi có tiếng chuông và hợp âm ngũ cung, âm lượng thấp như tiếng cũ, dữ liệu dưới 1 KB', () => {
    for (const cue of ['bell', 'jingle'] as const) {
      expect(SFX_CUES[cue].length).toBeGreaterThan(0);
      for (const n of SFX_CUES[cue]) expect(n.gain).toBeLessThanOrEqual(0.07);
      expect(ARCADE_SFX_NOTES[cue].length).toBeGreaterThan(0);
    }
    expect(JSON.stringify([SFX_CUES.bell, SFX_CUES.jingle, ARCADE_SFX_NOTES.bell, ARCADE_SFX_NOTES.jingle]).length).toBeLessThan(1024);
  });

  it('âm thanh bàn chơi: mặc định bật, mặc định im khi giảm chuyển động, lựa chọn của khách luôn thắng', () => {
    const s = memory();
    expect(readSoundOn(s)).toBe(true);
    expect(readSoundOn(s, true)).toBe(false);
    s.setItem('tubu.game.sound', 'on');
    expect(readSoundOn(s, true)).toBe(true);
    s.setItem('tubu.game.sound', 'off');
    expect(readSoundOn(s, false)).toBe(false);
    expect(readSoundOn(null, true)).toBe(false);
  });
});

describe('Thiệp PNG (web)', () => {
  const palette = Object.fromEntries(Object.keys(XMAS_CARD_PALETTE_VARS).map((k) => [k, `#${k}`])) as unknown as XmasCardPalette;
  function fakeCtx() {
    const fills: string[] = [];
    const texts: string[] = [];
    const ctx = {
      fillStyle: '' as unknown,
      strokeStyle: '' as unknown,
      lineWidth: 1,
      lineCap: 'butt',
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      save() {},
      restore() {},
      translate() {},
      scale() {},
      beginPath() {},
      arc() {},
      stroke() {},
      fill() {
        fills.push(String(ctx.fillStyle));
      },
      fillRect() {},
      fillText(t: string) {
        texts.push(t);
      },
      measureText: (t: string) => ({ width: t.length * 16 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    };
    return { ctx: ctx as unknown as XmasCardCtx<object>, fills, texts };
  }
  const path = (): object => ({});

  it('ngắt dòng theo bề rộng, không mất chữ, từ dài đứng riêng', () => {
    const m = (t: string) => t.length;
    expect(wrapLines(m, 'một hai ba bốn', 7)).toEqual(['một hai', 'ba bốn']);
    expect(wrapLines(m, 'siêu-dài-quá-khổ ok', 5)).toEqual(['siêu-dài-quá-khổ', 'ok']);
    expect(wrapLines(m, '  ', 10)).toEqual([]);
  });

  it('chỉ vẽ món đang treo: cây trống không có vàng của ngôi sao, treo sao thì có', () => {
    const empty = fakeCtx();
    drawXmasCard(empty.ctx, path, { name: 'Lan', on: [], link: 'https://tubutree.com/vuon-xanh?ref=AB', palette });
    expect(empty.fills).not.toContain('#gold');
    const star = fakeCtx();
    drawXmasCard(star.ctx, path, { name: 'Lan', on: ['star', 'reindeer'], link: 'https://tubutree.com/vuon-xanh?ref=AB', palette });
    expect(star.fills).toContain('#gold');
    expect(star.fills).toContain('#fawn');
  });

  it('chữ trên thiệp: lời chúc, tên + số món, lời mời, link không có giao thức', () => {
    const { ctx, texts } = fakeCtx();
    drawXmasCard(ctx, path, { name: 'Lan', on: ['star'], link: 'https://tubutree.com/vuon-xanh?ref=AB', palette });
    expect(texts[0]).toBe(xmasTreeCopy.greeting);
    expect(texts.join(' ')).toContain('Lan đã treo 1/6 món');
    expect(texts).toContain(xmasTreeCopy.cardInvite);
    expect(texts.at(-1)).toBe('tubutree.com/vuon-xanh?ref=AB');
    expect(XMAS_CARD_SIZE).toEqual({ w: 720, h: 960 });
  });

  it('mọi màu thiệp là biến --xmas-* có thật trong seasonal-christmas.css', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../../design-tokens/src/seasonal-christmas.css', import.meta.url), 'utf8');
    for (const v of Object.values(XMAS_CARD_PALETTE_VARS)) expect(css).toContain(`${v}:`);
  });
});

describe('Áo Noel của Hứng Giọt Sương', () => {
  const THEME = { bg: 'bg', surface: 'surface', forest: 'forest', sage: 'sage', cream: 'cream', ink: 'ink', accent: 'accent', danger: 'danger' };
  const state = (events: DewCatcherState['events'], items: DewCatcherState['items'] = []) => ({ items, events }) as unknown as DewCatcherState;
  const catchOf = (kind: 'dew' | 'berry' | 'oil', mult: number) => ({ type: 'catch' as const, x: 0.5, points: DEW_ITEMS[kind].points * mult, mult });

  it('đổi đúng ba món tốt, vợt và cây nền; món độc giữ hình (khách vẫn phải né)', () => {
    expect(XMAS_DEW_GLYPH[DEW_ITEMS.dew.emoji]).toBe('❄️');
    expect(XMAS_DEW_GLYPH[DEW_ITEMS.berry.emoji]).toBe('🔔');
    expect(XMAS_DEW_GLYPH[DEW_ITEMS.oil.emoji]).toBe('🎁');
    expect(XMAS_DEW_GLYPH[DEW_ITEMS.chem.emoji]).toBeUndefined();
    expect(XMAS_DEW_GLYPH[DEW_ITEMS.dust.emoji]).toBeUndefined();
  });

  it('onGift chỉ khi hứng hộp quà (kể cả combo), không khi bông tuyết x3 cũng ra 30 điểm; vẽ lại dt = 0 không kêu lại', () => {
    let gifts = 0;
    const skin = xmasDewSkin(false, () => (gifts += 1));
    const draw = () => undefined;
    skin.paint(draw, THEME, 16, state([catchOf('dew', 3), catchOf('berry', 1)]));
    expect(gifts).toBe(0);
    skin.paint(draw, THEME, 16, state([catchOf('oil', 1), catchOf('oil', 2)]));
    expect(gifts).toBe(2);
    skin.paint(draw, THEME, 0, state([catchOf('oil', 1)]));
    expect(gifts).toBe(2);
  });

  it('mọi màu vẽ thêm lấy từ theme; giảm chuyển động thì không có chùm bông tuyết', () => {
    const colors: string[] = [];
    const texts: string[] = [];
    const draw = (t: string, _x: number, _y: number, _s: number, color?: string) => {
      texts.push(t);
      if (color) colors.push(color);
    };
    const oil = [{ kind: 'oil', x: 0.3, y: 0.4 }] as unknown as DewCatcherState['items'];
    xmasDewSkin(false, () => undefined).paint(draw, THEME, 16, state([catchOf('dew', 1)], oil));
    expect(colors.every((c) => Object.values(THEME).includes(c))).toBe(true);
    expect(texts.filter((t) => t === '❄').length).toBe(12 + 6);
    texts.length = 0;
    xmasDewSkin(true, () => undefined).paint(draw, THEME, 16, state([catchOf('dew', 1)], oil));
    expect(texts.filter((t) => t === '❄').length).toBe(12);
    expect(texts).toContain('○');
  });
});
