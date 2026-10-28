// Luồng 1: khách mới vào lần đầu. Phần A persona new, phần B guest, phần C khảo sát chào mừng, phần D trang chủ của khách quay lại.
// Chạy: node mini-1.mjs [new|guest|quiz|returning]  (không tham số = chạy cả bốn)
import { Flow, run, resetOnboarding } from './_lib.mjs';

const which = process.argv[2];

async function home(f) {
  await f.s.goto('/');
  await f.page.waitForTimeout(400);
}

async function jobs(f) {
  const J = [
    ['Mua hàng (nút Chọn sản phẩm)', async () => f.tap('Chọn sản phẩm')],
    ['Mua hàng (ô tìm kiếm)', async () => f.tap('Bạn đang tìm gì hôm nay?')],
    ['Mua hàng (tab Danh mục)', async () => f.tap('Danh mục')],
    ['Theo dõi đơn', async () => { await f.tap(/^Cá nhân/); await f.tap('Xem tất cả đơn hàng'); }],
    ['Điểm Xanh và ưu đãi (tab Ưu đãi)', async () => f.tap(/^Ưu đãi/)],
    ['Điểm Xanh (ô Đổi quà)', async () => f.tap('Đổi quà bằng Điểm Xanh')],
    ['Vườn Xanh (tab đáy)', async () => f.tap('Vườn Xanh', { nth: 0 })],
    ['Đổi rác lấy quà', async () => f.tap('Đổi rác lấy quà')],
    ['Chat CSKH', async () => {
      await f.tap(/^Cá nhân/);
      const y = await f.page.getByText('Chat với Tubu Tree', { exact: true }).first().evaluate((e) => Math.round(e.getBoundingClientRect().top)).catch(() => null);
      f.note(`Chat CSKH: dòng "Chat với Tubu Tree" ở Cá nhân nằm cách mép trên ${y}px (khung nhìn 812px): ${y > 716 ? 'phải cuộn' : 'thấy ngay'}`);
      await f.scroll(900);
      await f.tap('Chat với Tubu Tree');
    }],
    ['CTV (Kiếm tiền > Cộng tác viên)', async () => { await f.tap('Kiếm tiền cùng Tubu'); await f.tap('Cộng tác viên'); }],
    ['Đại lý (Kiếm tiền > Đại lý)', async () => { await f.tap('Kiếm tiền cùng Tubu'); await f.tap('Đại lý'); }],
  ];
  for (const [label, fn] of J) {
    await home(f);
    await f.step(`Việc: ${label}`, fn, { soft: true });
  }
}

async function partNew() {
  resetOnboarding('uat_new');
  const f = await Flow.start('1-khach-moi-new', 'new');
  await run(f, async () => {
    const perf = await f.page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
      return { domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd ?? 0), loadMs: Math.round(nav?.loadEventEnd ?? 0), fcpMs: Math.round(fcp?.startTime ?? 0) };
    });
    f.note('Tải lạnh (máy này, mạng nội bộ, chưa tính độ trễ mạng thật): ' + JSON.stringify(perf));
    await f.step('Mở app lần đầu: màn chào mừng', null, { note: 'Phủ kín màn, hai lối: Bắt đầu (khảo sát) / Để sau' });
    await f.step('Bỏ qua màn chào (Để sau)', () => f.tap('Để sau'));
    await f.step('Trang chủ sau khi bỏ qua', null, { note: 'thấy gì ở màn đầu' });
    await jobs(f);
  });
}

async function partGuest() {
  const f = await Flow.start('1-khach-moi-guest', 'guest');
  await run(f, async () => {
    await f.step('Mở app lần đầu (khách, chưa liên kết Zalo)', null);
    await f.step('Bỏ qua màn chào (Để sau)', () => f.tap('Để sau'));
    await f.step('Trang chủ của khách', null);
    await jobs(f);
  });
}

async function partQuiz() {
  resetOnboarding('uat_new');
  const f = await Flow.start('1-khao-sat-chao-mung', 'new');
  await run(f, async () => {
    await f.step('Màn chào', null);
    await f.step('Bắt đầu', () => f.tap('Bắt đầu'));
    const optionsNow = () =>
      f.page.evaluate(() => {
        const names = [...document.querySelectorAll('button,[role=button]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.innerText || e.getAttribute('aria-label') || '').replace(/\n/g, ' ').trim());
        const i = names.findIndex((n) => /^Cá nhân/.test(n));
        return names.slice(i + 1);
      });
    for (let i = 1; i <= 8; i++) {
      const opts = (await optionsNow()).filter((n) => !/^(Tiếp tục|Quay lại|Để sau|Bỏ qua|Xem thêm)$/.test(n));
      const q = (await f.page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ');
      const qhead = q.split('Cá nhân')[1]?.slice(0, 90) ?? q.slice(0, 90);
      if (!opts.length || !/Chọn (nhiều|1) đáp án/.test(q)) {
        f.note(`câu ${i}: không còn đáp án; dừng. Chữ: ${qhead}`);
        break;
      }
      f.note(`câu ${i}: ${qhead} · đáp án: ${opts.join(', ')}`);
      await f.step(`Câu ${i}: chọn "${opts[0]}"`, () => f.tap(opts[0]));
      const after = await optionsNow();
      const nextLabel = after.find((n) => /^(Tiếp tục|Hoàn tất|Xong|Bắt đầu mua sắm|Khám phá)/.test(n)) ?? 'Tiếp tục';
      await f.step(`Câu ${i}: ${nextLabel}`, () => f.tap(nextLabel));
      if (/^(Hoàn tất|Xong|Bắt đầu mua sắm|Khám phá)/.test(nextLabel)) break;
    }
    await f.step('Kết thúc khảo sát: màn đầu', null);
  });
}

async function partReturning() {
  const f = await Flow.start('1-trang-chu-khach-quay-lai', 'returning');
  await run(f, async () => {
    await f.step('Trang chủ khách đang có 3 đơn', null, { note: 'tìm lối vào đơn ngay ở trang chủ' });
    const t = await f.page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
    f.note('Chữ có "đơn" ở trang chủ: ' + (t.match(/[^|]*đơn[^|]*/gi) || []).slice(0, 8).join(' // '));
    await f.step('Chạm chuông Thông báo', () => f.tap('Thông báo'));
  });
}

if (!which || which === 'new') await partNew();
if (!which || which === 'guest') await partGuest();
if (!which || which === 'quiz') await partQuiz();
if (!which || which === 'returning') await partReturning();
