import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Danh sách cho phép tĩnh cho mọi nơi chạm Điểm Xanh trong `game/mini/**`.
 *
 * Bất biến: chỉ `game-mini-reward.service.ts` được ghi sổ điểm, đúng MỘT lời gọi `applyPointsDelta(` (cộng điểm ván có thưởng,
 * refType `GAME_MINI`, trong cùng transaction với dòng nước và sổ ngày). Không file nào trong thư mục được gọi `.grant(`, ghi thẳng
 * `pointsTransaction` hay `pointsBalance`, hoặc chạy SQL ghi `points_transactions`. refType `'GAME_MINI'` chỉ được viết ở đó.
 */

const MINI_ROOT = __dirname;
const REWARD_FILE = 'game-mini-reward.service.ts';

export interface MiniPointsHit {
  relPath: string;
  kind: 'applyPointsDelta' | 'grant' | 'pointsTransactionWrite' | 'pointsBalanceWrite' | 'rawLedgerSql' | 'refTypeLiteral';
  count: number;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const PATTERNS: Array<[MiniPointsHit['kind'], RegExp]> = [
  ['applyPointsDelta', /\bapplyPointsDelta\s*\(/g],
  ['grant', /\.grant\s*\(/g],
  ['pointsTransactionWrite', /\.pointsTransaction\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g],
  ['pointsBalanceWrite', /\bpointsBalance\s*:\s*\{\s*(increment|decrement|set)\b/g],
  ['rawLedgerSql', /(INSERT\s+INTO|UPDATE)\s+"?points_transactions"?/gi],
  ['refTypeLiteral', /['"`]GAME_MINI['"`]/g],
];

export function scanMiniSource(relPath: string, rawSource: string): MiniPointsHit[] {
  const code = stripComments(rawSource);
  const hits: MiniPointsHit[] = [];
  for (const [kind, re] of PATTERNS) {
    const n = [...code.matchAll(re)].length;
    if (n > 0) hits.push({ relPath, kind, count: n });
  }
  return hits;
}

const ALLOWED: Partial<Record<MiniPointsHit['kind'], Record<string, number>>> = {
  applyPointsDelta: { [REWARD_FILE]: 1 },
  refTypeLiteral: { [REWARD_FILE]: 1 },
};

export function verifyMiniHits(hits: MiniPointsHit[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const allowed = ALLOWED[h.kind]?.[h.relPath];
    if (allowed === undefined) errors.push(`Không được phép: ${h.kind} trong ${h.relPath} (${h.count} lần)`);
    else if (allowed !== h.count) errors.push(`${h.relPath}: cần đúng ${allowed} lần ${h.kind}, thấy ${h.count}`);
    seen.add(`${h.kind}|${h.relPath}`);
  }
  for (const [kind, files] of Object.entries(ALLOWED)) {
    for (const path of Object.keys(files ?? {})) {
      if (!seen.has(`${kind}|${path}`)) errors.push(`Thiếu lời gọi đã ghim: ${kind} trong ${path}`);
    }
  }
  return errors;
}

function listNonSpecTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listNonSpecTsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.race-spec.ts')) out.push(full);
  }
  return out.sort();
}

describe('game mini: chỉ một chỗ được ghi sổ Điểm Xanh', () => {
  const files = listNonSpecTsFiles(MINI_ROOT);
  const hits = files.flatMap((f) => scanMiniSource(relative(MINI_ROOT, f).split(sep).join('/'), readFileSync(f, 'utf-8')));

  it('quét được mã nguồn thật của thư mục (có tệp thưởng và các tệp game)', () => {
    const rel = files.map((f) => relative(MINI_ROOT, f).split(sep).join('/'));
    expect(rel).toContain(REWARD_FILE);
    expect(rel).toContain('game-mini.service.ts');
    expect(rel.some((p) => p.startsWith('games/'))).toBe(true);
  });

  it('chỉ game-mini-reward.service.ts gọi applyPointsDelta đúng 1 lần, không nơi nào ghi sổ điểm theo đường khác', () => {
    expect(verifyMiniHits(hits)).toEqual([]);
  });

  describe('bộ quét tự bắt được vi phạm (ca âm)', () => {
    it('applyPointsDelta ở tệp khác', () => {
      const h = scanMiniSource('game-mini.service.ts', 'await applyPointsDelta(tx, { delta: 10 });');
      expect(verifyMiniHits([...h, { relPath: REWARD_FILE, kind: 'applyPointsDelta', count: 1 }, { relPath: REWARD_FILE, kind: 'refTypeLiteral', count: 1 }])).toEqual([
        'Không được phép: applyPointsDelta trong game-mini.service.ts (1 lần)',
      ]);
    });

    it('lời gọi thứ hai trong tệp thưởng', () => {
      const h = scanMiniSource(REWARD_FILE, "const T = 'GAME_MINI'; applyPointsDelta(tx, a); applyPointsDelta(tx, b);");
      expect(verifyMiniHits(h)).toEqual([`${REWARD_FILE}: cần đúng 1 lần applyPointsDelta, thấy 2`]);
    });

    it('ghi thẳng pointsTransaction, cộng pointsBalance, SQL thô, .grant( và refType ở tệp khác', () => {
      const src = [
        'await tx.pointsTransaction.create({ data });',
        'await tx.user.update({ data: { pointsBalance: { increment: 5 } } });',
        'await tx.$executeRaw`INSERT INTO "points_transactions" VALUES (1)`;',
        'await this.loyalty.grant(userId, 5);',
        "const refType = 'GAME_MINI';",
      ].join('\n');
      const kinds = scanMiniSource('games/sort.ts', src).map((h) => h.kind).sort();
      expect(kinds).toEqual(['grant', 'pointsBalanceWrite', 'pointsTransactionWrite', 'rawLedgerSql', 'refTypeLiteral']);
    });

    it('bỏ qua lời gọi nằm trong comment', () => {
      expect(scanMiniSource('x.ts', '// applyPointsDelta(tx)\n/* tx.pointsTransaction.create() */')).toEqual([]);
    });

    it('báo thiếu khi tệp thưởng mất lời gọi đã ghim', () => {
      expect(verifyMiniHits([])).toEqual([
        `Thiếu lời gọi đã ghim: applyPointsDelta trong ${REWARD_FILE}`,
        `Thiếu lời gọi đã ghim: refTypeLiteral trong ${REWARD_FILE}`,
      ]);
    });
  });
});
