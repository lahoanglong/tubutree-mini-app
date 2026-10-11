import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * C-076 lô 1 (gói PC-10a): game + loyalty đã di cư sang Design System v2 — không dùng họ biến alias
 * legacy của css/tokens.css, không màu thô (hex/rgb), không import ZaUI ngoài khung trang, và emoji
 * chỉ còn khi là NỘI DUNG (hạng, lời chúc, chuỗi ngày), không làm icon chức năng.
 *
 * Danh sách chỉ gồm file của gói đã sạch hôm nay; mỗi lượt di cư thêm file của mình vào đây TRƯỚC
 * khi sửa (đỏ → di cư → xanh). Bộ so khớp copy từ ds-legacy-vars-4b.spec.ts (cùng họ alias) và
 * từ scripts/uiux/static-scan.mjs (hex/rgb) để guard và số đo static-scan không lệch nhau.
 */
const GAME_FILES = [
  'src/components/game/game-card.tsx',
  'src/components/game/game-link-row.tsx',
  'src/components/game/game-states.tsx',
  'src/components/game/game-utils.ts',
  'src/components/game/garden-hero.tsx',
  'src/components/game/tree-health-alert.tsx',
  'src/components/game/tree-actions.tsx',
  'src/components/game/streak-repair.tsx',
  'src/components/game/checkin-streak.tsx',
  'src/components/game/use-game-actions.ts',
  'src/components/game/use-game-data.ts',
  'src/components/game/garden-plots.tsx',
  'src/components/game/season-banner.tsx',
  'src/components/game/season-pass.tsx',
  'src/components/game/community-goal.tsx',
  'src/components/game/species-codex.tsx',
  'src/components/game/friend-gifts.tsx',
  'src/components/game/eco-impact.tsx',
  'src/components/game/lucky-wheel-card.tsx',
  'src/components/game/quiz-card.tsx',
  'src/components/game/missions-card.tsx',
  'src/components/game/season-leaderboard.tsx',
  'src/components/game/weekly-leaderboard.tsx',
  'src/components/game/harvest-celebration.tsx',
];
const FILES_PC10A = ['src/pages/loyalty.tsx', ...GAME_FILES];

/** Cho phép giữ emoji theo file: chỉ nội dung hạng/lời chúc/chuỗi ngày. */
const ALLOWED_EMOJI: Record<string, string[]> = {
  'src/pages/loyalty.tsx': ['🌱', '🌿', '🌳', '🌲', '🎉', '🔥'],
  // Giai đoạn cây, đơn vị giọt nước 💧, chuỗi ngày 🔥 và 🌳 "cây thật" là nội dung game.
  'src/components/game/garden-hero.tsx': ['🌱', '🌿', '🌳', '💧', '🔥'],
  'src/components/game/game-utils.ts': ['🌳', '💧', '🌍', '🌬', '🐾', '♻', '⚡', '🌿', '🌟', '💎', '🍃'],
  'src/components/game/checkin-streak.tsx': ['💧', '🎁'],
  'src/components/game/tree-actions.tsx': ['💧'],
  'src/components/game/use-game-actions.ts': ['🧊', '💦', '🎁', '🌳', '🪴'],
  'src/components/game/garden-plots.tsx': ['🌱', '🌿', '🌳', '🥀', '🍂'],
  'src/components/game/community-goal.tsx': ['💧', '🌿'],
  'src/components/game/species-codex.tsx': ['❔'],
  'src/components/game/friend-gifts.tsx': ['💧', '🌿'],
  'src/components/game/eco-impact.tsx': ['🌿'],
  'src/components/game/quiz-card.tsx': ['🌿', '🎉'],
  'src/components/game/season-leaderboard.tsx': ['🥇', '🥈', '🥉'],
  'src/components/game/weekly-leaderboard.tsx': ['🥇', '🥈', '🥉', '🌳', '🔥'],
  'src/components/game/harvest-celebration.tsx': ['🌳', '🌿'],
};

/** Trang chỉ được lấy khung/điều hướng/snackbar từ zmp-ui; Box/Text/Button... dùng components/ui. */
const ZMP_UI_ALLOWED = new Set(['Page', 'useNavigate', 'useLocation', 'useSnackbar']);

const LEGACY = new RegExp(
  [
    String.raw`var\(--(neutral|primary|leaf|sun)-`,
    String.raw`var\(--(success|warning|danger|info)(-bg)?[,)]`,
    String.raw`var\(--clay-(200|800)[,)]`,
    String.raw`var\(--radius-(sm|md|lg|xl|full)[,)]`,
    String.raw`var\(--shadow-(xs|sm|md|lg|card)[,)]`,
    String.raw`var\(--dealer-`,
    String.raw`var\(--font-body[,)]`,
  ].join('|'),
  'g',
);
const HEX = /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?!\w)/g;
const RGB = /\brgba?\(\s*\d/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿]/gu;

const MINIAPP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(MINIAPP_ROOT + file, 'utf8');

/** Bỏ chú thích khối + dòng chú thích đầu dòng (giống static-scan) để chữ trong comment không bị đếm. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const hits = (src: string, re: RegExp) =>
  stripComments(src)
    .split(/\r?\n/)
    .map((l, i) => `${i + 1}: ${l.trim()}`)
    .filter((l) => {
      re.lastIndex = 0;
      return re.test(l);
    });

const zmpUiImports = (src: string) =>
  [...src.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s*['"]zmp-ui['"]/g)].flatMap((m) => {
    const clause = m[1]!.trim();
    const named = /\{([^}]*)\}/.exec(clause);
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    return [
      ...(rest ? [rest] : []),
      ...(named ? named[1]!.split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim()) : []),
    ].filter(Boolean);
  });

const emojiIn = (src: string) => [...new Set(stripComments(src).match(EMOJI) ?? [])];

describe('PC-10a — bộ so khớp tự kiểm', () => {
  it.each(['var(--neutral-500)', 'var(--leaf-700)', 'var(--primary-50)', 'var(--danger)', 'var(--radius-md)', 'var(--shadow-sm)', 'var(--clay-200)'])(
    'bắt alias %s',
    (v) => {
      expect(hits(`color: ${v}`, LEGACY)).toHaveLength(1);
    },
  );
  it.each(['var(--color-text-primary)', 'var(--radius-card)', 'var(--elevation-1)', 'var(--sage-700)', 'var(--clay-50)'])(
    'không bắt tên v2 %s',
    (v) => {
      expect(hits(`color: ${v}`, LEGACY)).toEqual([]);
    },
  );
  it('bắt hex và rgb(a) thô, bỏ qua comment', () => {
    expect(hits("background: '#1a1a17'", HEX)).toHaveLength(1);
    expect(hits("background: 'rgba(26,26,23,0.6)'", RGB)).toHaveLength(1);
    expect(hits('// màu #abcdef trong comment', HEX)).toEqual([]);
  });
  it('đọc đúng import zmp-ui nhiều dòng, alias và type', () => {
    expect(zmpUiImports("import { Box, Page, type Foo, Text as T } from 'zmp-ui';")).toEqual(['Box', 'Page', 'Foo', 'Text']);
    expect(zmpUiImports("import {\n  Page,\n  Button,\n} from 'zmp-ui';")).toEqual(['Page', 'Button']);
  });
  it('nhận ra emoji chức năng (✓ 🔒 💡) lẫn emoji nội dung', () => {
    expect(emojiIn('a ✓ b 🔒 c 💡 d 🌱 e 🎉')).toEqual(['✓', '🔒', '💡', '🌱', '🎉']);
  });
});

describe('PC-10a — không dùng biến CSS legacy', () => {
  it.each(FILES_PC10A)('%s', (file) => {
    expect(hits(read(file), LEGACY)).toEqual([]);
  });
});

describe('PC-10a — không màu thô (hex/rgb)', () => {
  it.each(FILES_PC10A)('%s', (file) => {
    expect([...hits(read(file), HEX), ...hits(read(file), RGB)]).toEqual([]);
  });
});

describe('PC-10a — chỉ lấy khung trang từ zmp-ui', () => {
  it.each(FILES_PC10A.filter((f) => f.startsWith('src/pages/') || f.startsWith('src/components/game/')))('%s', (file) => {
    expect(zmpUiImports(read(file)).filter((name) => !ZMP_UI_ALLOWED.has(name))).toEqual([]);
  });
});

describe('PC-10a — emoji chỉ là nội dung, không làm icon chức năng', () => {
  it.each(FILES_PC10A)('%s', (file) => {
    const allowed = new Set(ALLOWED_EMOJI[file] ?? []);
    expect(emojiIn(read(file)).filter((e) => !allowed.has(e))).toEqual([]);
  });
});
