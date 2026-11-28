// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLuminanceDecoder } from './code-scan-zxing';
import { parseEntryParams } from './entry-source';
import { insertQrUrl } from './insert-qr';
import {
  A4_SHEET_MM,
  BATCH_ERROR_TEXT,
  BATCH_MAX,
  BATCH_SERIAL_MAX,
  batchSheetCount,
  formatSerial,
  insertQrBatchPrintHtml,
  parseBatchInt,
  planInsertQrBatch,
  printInsertQrBatch,
  type BatchPlanOk,
} from './insert-qr-batch';
import { insertQrCardSvg } from './insert-qr-card';
import { SITE_URL } from './site';

const APEX = 'https://tubutree.com';
const input = (over: Partial<Parameters<typeof planInsertQrBatch>[0]> = {}) => ({ channel: 'shopee', tag: 'box-2026-11', count: 20, start: 1, base: APEX, ...over });
const ok = (over: Partial<Parameters<typeof planInsertQrBatch>[0]> = {}): BatchPlanOk => {
  const plan = planInsertQrBatch(input(over));
  if (!plan.ok) throw new Error(`plan lỗi: ${plan.error}`);
  return plan;
};
const errorOf = (over: Partial<Parameters<typeof planInsertQrBatch>[0]>) => {
  const plan = planInsertQrBatch(input(over));
  return plan.ok ? null : plan.error;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('giới hạn số thẻ và số thứ tự', () => {
  it('số thẻ chỉ nhận số nguyên từ 1 tới 200', () => {
    expect(errorOf({ count: 0 })).toBe('count');
    expect(errorOf({ count: -3 })).toBe('count');
    expect(errorOf({ count: 201 })).toBe('count');
    expect(errorOf({ count: 1.5 })).toBe('count');
    expect(errorOf({ count: Number.NaN })).toBe('count');
    expect(errorOf({ count: null })).toBe('count');
    expect(ok({ count: 1 }).cards).toHaveLength(1);
    expect(ok({ count: BATCH_MAX }).cards).toHaveLength(200);
  });

  it('số bắt đầu từ 1 tới 999; thẻ cuối không được vượt 999', () => {
    expect(errorOf({ start: 0 })).toBe('start');
    expect(errorOf({ start: 1000 })).toBe('start');
    expect(errorOf({ start: null })).toBe('start');
    expect(errorOf({ start: 2.5 })).toBe('start');
    expect(ok({ start: 800, count: 200 }).cards.at(-1)!.serial).toBe('999');
    expect(errorOf({ start: 801, count: 200 })).toBe('range');
    expect(errorOf({ start: BATCH_SERIAL_MAX, count: 2 })).toBe('range');
    expect(ok({ start: BATCH_SERIAL_MAX, count: 1 }).cards[0]!.serial).toBe('999');
  });

  it('đợt thẻ bắt buộc và đúng luật bộ đọc nguồn; sàn lạ bị chặn', () => {
    expect(errorOf({ tag: '' })).toBe('tag-required');
    expect(errorOf({ tag: '   ' })).toBe('tag-required');
    expect(errorOf({ tag: 'có dấu' })).toBe('tag');
    expect(errorOf({ tag: 'a'.repeat(36) })).toBe('tag');
    expect(errorOf({ channel: 'facebook' })).toBe('channel');
    expect(ok({ tag: ' Box-2026-11 ' }).tag).toBe('box-2026-11');
  });

  it('mỗi lỗi có câu tiếng Việt riêng, không dùng chữ cấm "Vui lòng"', () => {
    for (const text of Object.values(BATCH_ERROR_TEXT)) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/vui lòng/i);
    }
    expect(new Set(Object.values(BATCH_ERROR_TEXT)).size).toBe(Object.keys(BATCH_ERROR_TEXT).length);
  });

  it('parseBatchInt chỉ nhận chuỗi số nguyên không dấu tối đa 4 chữ số', () => {
    expect(parseBatchInt('25')).toBe(25);
    expect(parseBatchInt(' 007 ')).toBe(7);
    for (const bad of ['', ' ', '-1', '1.5', '1e2', '12345', 'abc', '2 5']) expect(parseBatchInt(bad)).toBeNull();
  });

  it('số tờ A4 là số thẻ chia 4 làm tròn lên', () => {
    expect([1, 4, 5, 8, 9, 200].map(batchSheetCount)).toEqual([1, 1, 2, 2, 3, 50]);
    expect(ok({ count: 7 }).sheets).toBe(2);
  });
});

describe('mã mỗi thẻ: không trùng, in lại ra đúng cùng mã', () => {
  it('200 thẻ: số thứ tự và link đều không trùng, số thứ tự đủ 3 chữ số tăng dần', () => {
    const { cards } = ok({ count: 200 });
    expect(new Set(cards.map((c) => c.serial)).size).toBe(200);
    expect(new Set(cards.map((c) => c.url)).size).toBe(200);
    expect(cards.map((c) => c.serial).slice(0, 3)).toEqual(['001', '002', '003']);
    expect(cards.at(-1)!.serial).toBe('200');
    expect(cards.every((c) => /^\d{3}$/.test(c.serial))).toBe(true);
  });

  it('idempotent: cùng sàn, đợt và số bắt đầu cho đúng cùng danh sách; lượt nối tiếp không giao với lượt trước', () => {
    expect(ok({ count: 50 })).toEqual(ok({ count: 50 }));
    const first = ok({ count: 50, start: 1 });
    const second = ok({ count: 50, start: 51 });
    const urls = new Set(first.cards.map((c) => c.url));
    expect(second.cards.some((c) => urls.has(c.url))).toBe(false);
    expect(second.cards[0]!.serial).toBe('051');
  });

  it('sàn khác nhau hay đợt khác nhau cho link khác nhau dù cùng số thứ tự', () => {
    const all = [ok({ channel: 'shopee' }), ok({ channel: 'tiktok' }), ok({ channel: 'lazada' }), ok({ tag: 'box-2026-12' })].map((p) => p.cards[0]!.url);
    expect(new Set(all).size).toBe(4);
  });

  it('formatSerial đệm số 0 tới 3 chữ số', () => {
    expect([1, 12, 123].map(formatSerial)).toEqual(['001', '012', '123']);
  });

  it('insertQrUrl: số thứ tự chỉ là 1 tới 4 chữ số; thiếu serial thì link y như thẻ lẻ cũ', () => {
    expect(insertQrUrl('shopee', 'box-2026-11', APEX, '042')).toBe(`${APEX}/quet-ma?utm_source=shopee&card=box-2026-11&n=042`);
    expect(insertQrUrl('shopee', 'box-2026-11', APEX)).toBe(`${APEX}/quet-ma?utm_source=shopee&card=box-2026-11`);
    for (const bad of ['', '4a', '12345', '-1', '1.5']) expect(insertQrUrl('shopee', 'box-2026-11', APEX, bad)).toBeNull();
  });

  it('bộ đọc nguồn bỏ qua số thứ tự: mọi thẻ của đợt cho cùng nguồn và cùng chiến dịch (báo cáo không vỡ thành 200 dòng)', () => {
    const attributions = ok({ count: 200 }).cards.map((c) => JSON.stringify(parseEntryParams(new URL(c.url).searchParams, '/quet-ma')));
    expect(new Set(attributions)).toEqual(new Set([JSON.stringify({ source: 'shopee', campaign: 'card-box-2026-11' })]));
  });
});

describe('host trong mã QR', () => {
  it('mọi link bắt đầu bằng host truyền vào (kể cả có dấu gạch chéo cuối) và đi tới /quet-ma', () => {
    for (const base of [APEX, `${APEX}/`, `${APEX}///`]) {
      expect(ok({ base, count: 5 }).cards.every((c) => c.url.startsWith(`${APEX}/quet-ma?utm_source=shopee&card=box-2026-11&n=`))).toBe(true);
    }
  });

  it('không truyền host thì dùng SITE_URL của bản build', () => {
    const plan = ok({ base: undefined, count: 3 });
    expect(plan.cards.every((c) => c.url.startsWith(`${SITE_URL}/quet-ma?`))).toBe(true);
  });

  it('trang in với host chính không chứa app.tubutree.com ở bất kỳ đâu (link, chữ rút gọn)', () => {
    const html = insertQrBatchPrintHtml(ok({ count: 9 }));
    expect(html).not.toContain('app.tubutree.com');
    expect(html.match(/tubutree\.com\/quet-ma/g)!.length).toBe(9);
  });

  const decode = (svg: string) => {
    const g = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('[data-qr]')!;
    const scale = Number(g.getAttribute('transform')!.match(/scale\((\d+)\)/)![1]);
    const dark = new Set<string>();
    for (const m of g.querySelector('path')!.getAttribute('d')!.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
      for (let i = 0; i < Number(m[3]); i++) dark.add(`${Number(m[1]) + i},${m[2]}`);
    }
    const full = Number(g.querySelector('rect')!.getAttribute('width'));
    const margin = 40;
    const side = full * scale + margin * 2;
    const lum = new Uint8ClampedArray(side * side).fill(255);
    for (let py = 0; py < full * scale; py++) {
      for (let px = 0; px < full * scale; px++) {
        if (dark.has(`${Math.floor(px / scale)},${Math.floor(py / scale)}`)) lum[(py + margin) * side + px + margin] = 0;
      }
    }
    return createLuminanceDecoder(['qr_code']).decode(lum, side, side, true);
  };

  it('ZXing đọc mã in trên thẻ đầu, giữa và cuối của lượt ra đúng link của thẻ đó, host tubutree.com', () => {
    const plan = ok({ count: 200 });
    const html = insertQrBatchPrintHtml(plan);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const svgs = Array.from(doc.querySelectorAll('.slot svg'));
    expect(svgs).toHaveLength(200);
    for (const i of [0, 99, 199]) {
      const decoded = decode(svgs[i]!.outerHTML);
      expect(decoded).toBe(plan.cards[i]!.url);
      expect(new URL(decoded!).host).toBe('tubutree.com');
      expect(new URL(decoded!).searchParams.get('n')).toBe(plan.cards[i]!.serial);
    }
  });
});

describe('trang in A4 2×2 có dấu cắt', () => {
  const docOf = (plan: BatchPlanOk) => new DOMParser().parseFromString(insertQrBatchPrintHtml(plan, { earnPct: 5 }), 'text/html');

  it('giấy A4 không lề, màu in nguyên, tờ ngắt trang và tờ cuối không ngắt', () => {
    const html = insertQrBatchPrintHtml(ok({ count: 5 }));
    expect(A4_SHEET_MM).toEqual({ widthMm: 210, heightMm: 297 });
    expect(html).toContain('@page{size:210mm 297mm;margin:0}');
    expect(html).toContain('print-color-adjust:exact');
    expect(html).toContain('break-after:page;page-break-after:always');
    expect(html).toContain('.sheet:last-child{break-after:auto;page-break-after:auto}');
    expect(html).toContain('grid-template-columns:105mm 105mm;grid-template-rows:148mm 148mm');
  });

  it('7 thẻ ra 2 tờ: 4 thẻ rồi 3 thẻ; mỗi tờ có đúng một bộ dấu cắt', () => {
    const doc = docOf(ok({ count: 7 }));
    const sheets = Array.from(doc.querySelectorAll('section.sheet'));
    expect(sheets.map((s) => s.querySelectorAll('.slot').length)).toEqual([4, 3]);
    expect(sheets.map((s) => s.querySelectorAll('[data-crop-marks]').length)).toEqual([1, 1]);
    expect(doc.body.children).toHaveLength(2);
  });

  it('200 thẻ ra 50 tờ, thẻ nằm đúng thứ tự số thứ tự, mỗi thẻ in "Thẻ <số>" một lần', () => {
    const doc = docOf(ok({ count: 200 }));
    expect(doc.querySelectorAll('section.sheet')).toHaveLength(50);
    const serials = Array.from(doc.querySelectorAll('[data-serial]')).map((t) => t.textContent);
    expect(serials).toHaveLength(200);
    expect(serials[0]).toBe('Thẻ 001');
    expect(serials[199]).toBe('Thẻ 200');
    expect(new Set(serials).size).toBe(200);
  });

  it('dấu cắt nằm đúng đường cắt giữa tờ (x = 105 mm, y = giữa hai hàng thẻ) và có viền trắng dưới nét đen', () => {
    const marks = docOf(ok({ count: 1 })).querySelector('[data-crop-marks]')!;
    expect(marks.getAttribute('viewBox')).toBe('0 0 210 296');
    const lines = Array.from(marks.querySelectorAll('line')).map((l) => ({
      x1: Number(l.getAttribute('x1')),
      y1: Number(l.getAttribute('y1')),
      x2: Number(l.getAttribute('x2')),
      y2: Number(l.getAttribute('y2')),
      stroke: l.getAttribute('stroke'),
    }));
    expect(lines).toHaveLength(12);
    for (const l of lines) {
      const onVerticalCut = l.x1 === 105 && l.x2 === 105;
      const onHorizontalCut = l.y1 === 148 && l.y2 === 148;
      expect(onVerticalCut || onHorizontalCut).toBe(true);
    }
    expect(lines.slice(0, 6).every((l) => l.stroke === '#fff')).toBe(true);
    expect(lines.slice(6).every((l) => l.stroke === '#000')).toBe(true);
  });

  it('thẻ trong tờ là đúng SVG thẻ A6 cỡ mm kèm số thứ tự, nên giữ nguyên nhãn sàn, ba bước và tỉ lệ điểm', () => {
    const plan = ok({ channel: 'tiktok', count: 4 });
    const html = insertQrBatchPrintHtml(plan, { earnPct: 5 });
    for (const c of plan.cards) expect(html).toContain(insertQrCardSvg(c.url, 'tiktok', { unit: 'mm', earnPct: 5, serial: c.serial }));
    expect(html).toContain('Mua trên TikTok Shop');
    expect(html).toContain('Nhận 5%');
  });

  it('thẻ lẻ (không số thứ tự) không in nhãn số thẻ', () => {
    const svg = insertQrCardSvg(insertQrUrl('shopee', 'box-2026-11', APEX)!, 'shopee');
    expect(svg).not.toContain('data-serial');
  });
});

describe('printInsertQrBatch', () => {
  it('mở khung ẩn cỡ A4 ngoài màn hình, nạp trang in rồi gọi in; afterprint gỡ khung', async () => {
    vi.useFakeTimers();
    const print = vi.fn();
    const plan = ok({ count: 6 });
    const done = printInsertQrBatch(plan, { earnPct: 5 }, print);
    const frame = document.querySelector('iframe')!;
    expect(frame.style.width).toBe('210mm');
    expect(frame.style.height).toBe('297mm');
    expect(frame.style.left).toBe('-300mm');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.title).toBe('Thẻ A6 in hàng loạt');
    expect(frame.contentDocument!.querySelectorAll('section.sheet')).toHaveLength(2);
    expect(print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(print).toHaveBeenCalledWith(frame.contentWindow);
    frame.contentWindow!.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('in ném lỗi: gỡ khung và báo lỗi cho người gọi', async () => {
    vi.useFakeTimers();
    const done = printInsertQrBatch(ok({ count: 2 }), {}, () => {
      throw new Error('Trình duyệt không mở được hộp thoại in.');
    });
    const failed = expect(done).rejects.toThrow('Trình duyệt không mở được hộp thoại in.');
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(document.querySelector('iframe')).toBeNull();
  });
});
