import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

const SRC_ROOT = join(__dirname, '..');

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Trả về phần đối số của mọi `@Cron(...)` (cân ngoặc, bỏ qua dấu ngoặc trong chuỗi). */
function cronDecoratorArgs(source: string): string[] {
  const result: string[] = [];
  const re = /^[ \t]*@Cron\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    let quote: string | null = null;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (quote) {
        if (c === String.fromCharCode(92)) i++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    result.push(source.slice(start, i - 1));
  }
  return result;
}

describe('@Cron luôn chốt timeZone (giờ VN, không phụ thuộc TZ của host)', () => {
  const files = listSourceFiles(SRC_ROOT).filter((f) => /^[ \t]*@Cron\(/m.test(readFileSync(f, 'utf8')));

  it('quét được các file có @Cron', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [f.slice(SRC_ROOT.length + 1).split(sep).join('/'), f]))(
    '%s',
    (_rel, file) => {
      const args = cronDecoratorArgs(readFileSync(file, 'utf8'));
      expect(args.length).toBeGreaterThan(0);
      for (const arg of args) {
        expect(arg).toMatch(/\btimeZone\s*:/);
      }
    },
  );

  it('helper bắt đúng @Cron thiếu timeZone', () => {
    expect(cronDecoratorArgs("@Cron('0 3 * * *')\nfoo()")[0]).not.toMatch(/timeZone/);
    expect(cronDecoratorArgs("@Cron('0 3 * * *', { timeZone: CRON_TZ })")[0]).toMatch(/timeZone/);
    expect(cronDecoratorArgs("@Cron(CronExpression.EVERY_HOUR)")[0]).not.toMatch(/timeZone/);
  });
});
