import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src', 'components', 'app.tsx'), 'utf8');

/** Mỗi task M6 thêm hàng của mình (đường dẫn, tên component lazy, tệp trang). */
const ROUTES: ReadonlyArray<readonly [path: string, component: string, page: string]> = [
  ['/recycle', 'RecyclePage', 'recycle'],
  ['/recycle/rules', 'RecycleRulesPage', 'recycle-rules'],
];

describe('route Đổi rác lấy quà ở app.tsx (§16.1: một dòng lazy và một Route)', () => {
  it.each(ROUTES)('%s → %s', (path, component, page) => {
    expect(src).toContain(`const ${component} = lazy(() => import('../pages/${page}'));`);
    expect(src).toContain(`<Route path="${path}" element={<${component} />} />`);
  });
  it('mỗi đường dẫn chỉ khai một lần', () => {
    for (const [path] of ROUTES) expect(src.split(`<Route path="${path}" `).length - 1).toBe(1);
  });
});
