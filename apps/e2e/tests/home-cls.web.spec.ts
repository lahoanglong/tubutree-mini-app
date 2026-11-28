import { test, expect, makeOrder } from './support/mock-api';
import { mockMergedHome } from './support/home-merged';

const USER = {
  id: 'u-cls', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};
/** Ngưỡng theo số đo thật: máy đã nhớ 0,0004 (375) / 0,0074 (1280). Máy mới mà tổng quan đơn về RẤT chậm (sau khung chờ chung 4,5 giây) thì dòng Việc cần làm chen vào một lần, 0,078 (375): trần 0,1 là mức "tốt" của Core Web Vitals. Tổng quan về nhanh thì khung chờ chung che hết, gần như 0. */
const CLS_REMEMBERED_MAX = 0.02;
const CLS_FRESH_MAX = 0.1;
const CLS_FRESH_FAST_MAX = 0.02;
const SHOT_DIR = process.env.HOME_SHOT_DIR;

/** Ba tình huống máy; `slow` = /me/summary giữ lại tới sau khi trang dựng xong. */
const VARIANTS = [
  { remembered: false, slow: true, title: 'máy mới chưa nhớ gì, tổng quan đơn về rất chậm', max: CLS_FRESH_MAX, tag: 'chua-nho' },
  { remembered: false, slow: false, title: 'máy mới chưa nhớ gì, tổng quan đơn về nhanh', max: CLS_FRESH_FAST_MAX, tag: 'chua-nho-nhanh' },
  { remembered: true, slow: true, title: 'máy đã nhớ loại khách và số dòng việc', max: CLS_REMEMBERED_MAX, tag: 'nho' },
];
/** Web: Trang chủ khi /me/summary về muộn báo có đơn đang xử lý. Ghi CLS; ngưỡng chỉ chặn hồi quy lớn, số thật đọc ở annotation. */
for (const vp of [{ name: 'web375', width: 375, height: 812 }, { name: 'web1280', width: 1280, height: 800 }]) {
  for (const { remembered, slow, title, max, tag } of VARIANTS) {
    test(`CLS Trang chủ ${vp.name}, ${title}`, async ({ page, api }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      if (!slow) release();
      // Bản server dựng khung chờ theo cookie gợi ý (middleware rewrite "/" sang /khoi-phuc/<slug>).
      await page.context().addCookies([
        { name: 'tubu_web_session', value: '1', domain: 'localhost', path: '/' },
        ...(remembered ? [{ name: 'tubu_home_hint', value: 'returning-1', domain: 'localhost', path: '/' }] : []),
      ]);
      await page.addInitScript((mem) => {
        try {
          localStorage.setItem('tubu_web_session', '1');
          if (mem) {
            localStorage.setItem('tubu_home_todo_rows', JSON.stringify({ userId: 'u-cls', rows: 1 }));
            localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'u-cls', kind: 'returning' }));
          }
        } catch { /* không có localStorage */ }
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        (w as unknown as { __src: string[] }).__src = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number; startTime: number; sources?: { node?: Node; previousRect: DOMRect; currentRect: DOMRect }[] }[]) {
            if (e.hadRecentInput) continue;
            w.__cls += e.value;
            const src = (e.sources ?? []).map((x) => {
              const el = x.node instanceof Element ? x.node : x.node?.parentElement;
              return `${el?.tagName}.${String(el?.className ?? '').slice(0, 30)} y${Math.round(x.previousRect.y)}>${Math.round(x.currentRect.y)}`;
            });
            (w as unknown as { __src: string[] }).__src.push(`${e.value.toFixed(3)}@${Math.round(e.startTime)} ${src.join(' | ')}`);
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }, remembered);
      api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
      api.get('/me/notifications/unread-count', { count: 0 });
      api.get('/me/subscriptions', []);
      api.get('/me/wishlist/ids', []);
      api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
      api.get('/me/summary', async () => {
        await hold;
        return { orders: { pending_payment: 1, processing: 1, shipping: 0, delivered: 3, closed: 0, active: 2 }, unreadNotifications: 0, activeSubscriptions: 0 };
      });
      api.get('/orders/home-todo', {
        pending: null,
        shipping: { order: makeOrder({ code: 'TUBU-SHIP-C', status: 'SHIPPING', paymentStatus: 'PAID' }), total: 1 },
        processing: null,
      });
      mockMergedHome(api);
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Gợi ý cho bạn' })).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(500);
      release();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      test.info().annotations.push({ type: 'CLS', description: cls.toFixed(4) });
      console.log((await page.evaluate(() => (window as unknown as { __src: string[] }).__src)).map((x) => `  shift ${x}`).join('\n'));
      console.log(`CLS ${vp.name} ${tag} = ${cls.toFixed(4)}`);
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${vp.name}-${tag}.png` });
      expect(cls).toBeLessThan(max);
    });
  }
}
