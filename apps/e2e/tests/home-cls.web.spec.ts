import { test, expect, makeOrder } from './support/mock-api';
import { mockMergedHome } from './support/home-merged';

const USER = {
  id: 'u-cls', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 60, pointsConvertedBalance: 0, walletBalance: 0,
};
const SHOT_DIR = process.env.HOME_SHOT_DIR;

/** Web: Trang chủ khách cũ khi /me/summary về muộn báo có đơn đang xử lý. Ghi CLS; ngưỡng chỉ chặn hồi quy lớn, số thật đọc ở annotation. */
for (const vp of [{ name: 'web375', width: 375, height: 812 }, { name: 'web1280', width: 1280, height: 800 }]) {
  for (const remembered of [false, true]) {
    test(`CLS Trang chủ ${vp.name}, ${remembered ? 'máy đã nhớ loại khách và số dòng việc' : 'máy mới chưa nhớ gì'}`, async ({ page, api }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      await page.addInitScript((mem) => {
        try {
          localStorage.setItem('tubu_web_session', '1');
          if (mem) localStorage.setItem('tubu_home_todo_rows', '1');
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
      await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(500);
      release();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      test.info().annotations.push({ type: 'CLS', description: cls.toFixed(4) });
      console.log((await page.evaluate(() => (window as unknown as { __src: string[] }).__src)).map((x) => `  shift ${x}`).join('\n'));
      console.log(`CLS ${vp.name} ${remembered ? 'nho' : 'chua-nho'} = ${cls.toFixed(4)}`);
      if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${vp.name}-${remembered ? 'nho' : 'chua-nho'}.png` });
      expect(cls).toBeLessThan(0.5);
    });
  }
}
