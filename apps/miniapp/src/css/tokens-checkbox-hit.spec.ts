import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('tokens.css — ô chọn/radio có vùng chạm 44x44 (R6-BUYER-15)', () => {
  const css = readFileSync(join(process.cwd(), 'src/css/tokens.css'), 'utf8');
  const rule = /\.zaui-checkbox-input,\s*\.zaui-radio-input\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('<input> trong suốt rộng hơn hộp 24px mỗi phía 10px, không đổi bố cục', () => {
    expect(rule).toMatch(/top:\s*-10px/);
    expect(rule).toMatch(/left:\s*-10px/);
    expect(rule).toMatch(/width:\s*calc\(100% \+ 20px\)/);
    expect(rule).toMatch(/height:\s*calc\(100% \+ 20px\)/);
  });
});
