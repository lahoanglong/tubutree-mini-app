// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WASTE_FAQ_PICKUP_LABEL } from '@tubutree/app-core/waste-faq';
import { METHOD_LABELS } from '@/components/recycle/recycle-labels';
import { ApiUnavailableError } from '@/lib/api';
import { ApiNotFoundError } from '@/lib/core-http-server';

// Trang /doi-rac đọc cờ cách giao, kho và danh mục món ở máy chủ rồi vẽ Câu hỏi thường gặp + FAQPage từ cùng một mảng.
const server = vi.hoisted(() => ({ responses: new Map<string, unknown>(), paths: [] as string[] }));
vi.mock('@/lib/core-http-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-http-server')>()),
  createServerHttp: () => ({
    get: async (path: string) => {
      server.paths.push(path);
      const r = server.responses.get(path);
      if (r instanceof Error) throw r;
      if (r === undefined) throw new Error(`chưa mock ${path}`);
      return r;
    },
  }),
}));
vi.mock('@/components/recycle/recycle-home', async () => {
  const { useRecyclePageFooter } = await import('@/components/recycle/recycle-page-footer');
  return {
    RecycleHome: function RecycleHomeStub() {
      return <main id="recycle-home">{useRecyclePageFooter()}</main>;
    },
  };
});

import RecyclePage, { revalidate } from './page';

const HOURS = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => [d, [{ open: '08:30', close: '17:30' }]]));
const PROD = { waste: { enabled: true, dropoff: true, mailin: false, pickup: true } };

const ldBlocks = (markup: string): Record<string, unknown>[] =>
  [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
const faqLd = (markup: string) => ldBlocks(markup).find((d) => d['@type'] === 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
const visibleFaq = (markup: string) => {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  return [...doc.querySelectorAll('#recycle-home details')].map((d) => ({ q: d.querySelector('summary')!.textContent!.trim(), a: d.querySelector('p')!.textContent!.trim() }));
};
const html = async () => renderToStaticMarkup(await RecyclePage());

beforeEach(() => {
  vi.unstubAllEnvs();
  server.paths = [];
  server.responses = new Map<string, unknown>([
    ['/config/public', PROD],
    ['/waste/warehouses', [{ name: 'Kho Tubu', provinceName: 'TP. Hồ Chí Minh', openingHours: HOURS }]],
    ['/waste/catalogue', [{ name: 'Vỏ chai nhựa', status: 'ACTIVE', sortOrder: 1 }]],
  ]);
});

describe('/doi-rac — Câu hỏi thường gặp + FAQPage', () => {
  it('ISR 5 phút; đọc đúng ba nguồn công khai', async () => {
    expect(revalidate).toBe(300);
    await html();
    expect(server.paths.sort()).toEqual(['/config/public', '/waste/catalogue', '/waste/warehouses']);
  });

  it('FAQ hiển thị trong <main> của màn và FAQPage khớp từng câu hỏi, từng câu trả lời', async () => {
    const markup = await html();
    const shown = visibleFaq(markup);
    expect(shown.length).toBeGreaterThanOrEqual(5);
    expect(markup).toContain('<h2 id="recycle-faq-title"');
    const ld = faqLd(markup)!;
    expect(ld.mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }))).toEqual(shown);
    expect(ldBlocks(markup).filter((d) => d['@type'] === 'FAQPage')).toHaveLength(1);
  });

  it('cấu hình PROD: giờ kho thật T2–T7 08:30–17:30 và Thu kèm đơn; không nhắc đường gửi kho đang tắt', async () => {
    const text = JSON.stringify(faqLd(await html()));
    expect(text).toContain('Kho Tubu (TP. Hồ Chí Minh) mở cửa nhận rác T2–T7 08:30–17:30.');
    expect(text).toContain(`“${METHOD_LABELS.PICKUP}”`);
    expect(text).not.toMatch(/tự gửi|hãng vận chuyển|phí ship/);
  });

  it('nhãn "Thu kèm đơn mua" trong FAQ trùng nhãn cách giao trên màn tạo yêu cầu', () => {
    expect(WASTE_FAQ_PICKUP_LABEL).toBe(METHOD_LABELS.PICKUP);
  });

  it('chương trình tắt: không FAQ hiển thị, không FAQPage; khối WebPage của landing vẫn còn', async () => {
    server.responses.set('/config/public', { waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
    const markup = await html();
    expect(visibleFaq(markup)).toEqual([]);
    expect(faqLd(markup)).toBeUndefined();
    expect(ldBlocks(markup).some((d) => Array.isArray(d['@graph']))).toBe(true);
  });

  it('lỗi tạm lúc chạy (cấu hình, kho hay danh mục): ném để Next giữ bản đã render, không lưu bản thiếu FAQ', async () => {
    for (const path of ['/config/public', '/waste/warehouses', '/waste/catalogue']) {
      server.responses.set(path, new ApiUnavailableError(path, 503));
      await expect(html(), path).rejects.toBeInstanceOf(ApiUnavailableError);
      server.responses.set(path, path === '/config/public' ? PROD : []);
    }
  });

  it('lúc next build API chưa lên: build không hỏng, không đoán, không FAQ', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    for (const path of ['/config/public', '/waste/warehouses', '/waste/catalogue']) server.responses.set(path, new ApiUnavailableError(path, null));
    const markup = await html();
    expect(visibleFaq(markup)).toEqual([]);
    expect(faqLd(markup)).toBeUndefined();
  });

  it('API cũ chưa có /waste/warehouses, danh mục 404: vẫn có FAQ, câu chung về điểm nhận, không bịa giờ hay món', async () => {
    server.responses.set('/waste/warehouses', new ApiNotFoundError('/waste/warehouses'));
    server.responses.set('/waste/catalogue', new ApiNotFoundError('/waste/catalogue'));
    const shown = visibleFaq(await html());
    expect(shown.map((f) => f.q)).toContain('Mang vỏ chai, bao bì tới điểm nhận thế nào?');
    expect(shown.map((f) => f.q)).not.toContain('Tubu Tree nhận đổi những món nào?');
    expect(JSON.stringify(shown)).not.toMatch(/\d{2}:\d{2}/);
  });
});
