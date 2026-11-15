import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';

/**
 * Zalo Mini App E2E — nhãn hàng Danh mục Trang chủ ở 375px (M3): Trang chủ chỉ vẽ MỘT hàng 5 ô (4 danh mục đầu + "Tất cả"); tên danh mục thật dài hơn một cột vẫn tối đa hai dòng, vùng nhãn cao cố định nên mọi ô thẳng hàng, trang không tràn ngang, hàng không cuộn ngang, chữ hai nhãn kề nhau không chạm.
 * Linux vẽ chữ rộng hơn Mac, nên spec chỉ khẳng định bất biến (chiều cao vùng nhãn, thẳng hàng, không tràn), không khẳng định "vừa khít" một tên nào; ca Verdana tái hiện chữ rộng nhất. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

// Bốn tên đầu là những tên dài nhất (hai dòng, một từ dài hơn cột) vì Trang chủ chỉ vẽ 4 danh mục đầu.
const NAMES = [
  'Chăm sóc nhà cửa thiên nhiên', 'Mỹ phẩm thiên nhiên', 'Nông sản & Thực phẩm', 'Probiotics',
  'Tẩy rửa sinh học', 'Cho bé', 'Cho mẹ bầu', 'Chăm sóc cá nhân', 'Cà phê & Đồ uống', 'Nông sản & đặc sản', 'Thực phẩm hữu cơ', 'Thú cưng',
];
const categories = (n: number) => NAMES.slice(0, n).map((name, i) => ({ id: `c${i}`, parentId: null, name, slug: `s${i}`, image: null, sortOrder: i, productCount: 3, children: [] }));

const LABEL_HEIGHT = 32;
/** Chữ hai ô kề cách nhau ít nhất chừng này (px); trừ 0,1px sai số làm tròn của Range. */
const MIN_GAP = 1.9;
/** Một hàng 5 ô: 4 danh mục đầu + "Tất cả". */
const HOME_CELLS = 5;

for (const [title, font] of [['chữ mặc định', null], ['chữ rộng (Verdana, như Linux CI)', '*{font-family:Verdana !important}']] as const) {
  test.describe(`Danh mục Trang chủ — ${title}`, () => {
    for (const n of [7, 12]) {
      test(`${n} danh mục: chỉ một hàng ${HOME_CELLS} ô, mọi nhãn cao ${LABEL_HEIGHT}px, ô thẳng hàng, trang và hàng không tràn ngang`, async ({ page, api }) => {
        mockDiscovery(api, { returning: false });
        api.get('/categories', categories(n));
        await page.goto('/');
        const region = page.getByRole('region', { name: 'Danh mục', exact: true });
        await expect(region).toBeVisible({ timeout: 15_000 });
        if (font) await page.addStyleTag({ content: font });
        const grid = region.getByTestId('category-grid');
        const cells = await grid.locator('button').evaluateAll((buttons) =>
          buttons.map((b) => {
            const label = b.lastElementChild as HTMLElement;
            const tile = b.firstElementChild as HTMLElement;
            const range = document.createRange();
            range.selectNodeContents(label);
            const ink = [...range.getClientRects()].filter((r) => r.width > 0);
            return {
              text: label.textContent,
              labelH: Math.round(label.getBoundingClientRect().height),
              tileTop: Math.round(tile.getBoundingClientRect().top),
              labelTop: Math.round(label.getBoundingClientRect().top),
              inkLeft: Math.min(...ink.map((r) => r.left)),
              inkRight: Math.max(...ink.map((r) => r.right)),
            };
          }),
        );
        expect(cells.length, 'bốn danh mục đầu và ô "Tất cả"').toBe(HOME_CELLS);
        expect(cells.map((c) => c.text).at(-1)).toBe('Tất cả');
        for (const c of cells) expect(c.labelH, `nhãn "${c.text}" cao ${c.labelH}px`).toBe(LABEL_HEIGHT);
        // Một hàng: mọi ô có cùng đỉnh ô và đỉnh nhãn (không ô nào cao hơn ô khác).
        const rows = new Map<number, typeof cells>();
        for (const c of cells) rows.set(c.tileTop, [...(rows.get(c.tileTop) ?? []), c]);
        for (const [, row] of rows) expect(new Set(row.map((c) => c.labelTop)).size).toBe(1);
        expect(rows.size, 'một hàng duy nhất').toBe(1);
        // Hai nhãn đứng cạnh nhau không chạm hay đè chữ: vùng chữ (Range.getClientRects) của nhãn trước và nhãn sau cách nhau ít nhất MIN_GAP, kể cả khi chữ rộng (Verdana).
        for (const [, row] of rows) {
          const byLeft = [...row].sort((a, b) => a.inkLeft - b.inkLeft);
          for (let i = 1; i < byLeft.length; i++) {
            const gap = byLeft[i]!.inkLeft - byLeft[i - 1]!.inkRight;
            expect(gap, `"${byLeft[i - 1]!.text}" | "${byLeft[i]!.text}" cách nhau ${gap.toFixed(1)}px`).toBeGreaterThanOrEqual(MIN_GAP);
          }
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, 'trang tràn ngang').toBeLessThanOrEqual(0);
        const { scrollW, clientW } = await grid.evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth }));
        expect(scrollW, 'hàng danh mục không cuộn ngang').toBeLessThanOrEqual(clientW);
      });
    }
  });
}
