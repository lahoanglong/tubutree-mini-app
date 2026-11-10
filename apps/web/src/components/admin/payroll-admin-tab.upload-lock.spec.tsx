// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/export-csv', () => ({ downloadCsvFile: () => undefined }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ onChange, onBusyChange, disabled }: { onChange: (v: string[]) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => (
    <>
      <button type="button" onClick={() => onChange(['data:image/jpeg;base64,CU'])}>
        stub-co-anh
      </button>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        stub-bat-dau
      </button>
      <button
        type="button"
        onClick={() => {
          onChange(['data:image/jpeg;base64,MOI']);
          onBusyChange?.(false);
        }}
      >
        stub-xong-anh
      </button>
      <button type="button" onClick={() => onBusyChange?.(false)}>
        stub-xong-loi
      </button>
      <output data-testid="slot-disabled">{String(disabled)}</output>
    </>
  ),
}));

import { PayrollAdminTab } from './payroll-admin-tab';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { currentVnYearMonth } from '@/lib/week';

// Khoá nút "Đánh dấu đã trả" và đóng tấm lúc ảnh xác nhận chuyển khoản còn đang xử lý (Mini ↔ web, Wave 85B ↔ Wave 90A).

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const { year, month } = currentVnYearMonth();
const ROW = {
  staff: { id: '1', fullName: 'Lan', phone: '0900000000' },
  month: { year, month, totalMinutes: 125, gross: 500_000, totalFines: 0, net: 480_000, status: 'FINALIZED', paidAt: null, proofImageUrl: null, note: null },
  profile: { hourlyRate: 40_000, bankBin: null, bankAccountNo: '123', bankAccountName: 'LAN', qrImageUrl: null, active: true },
  qrImageUrl: null,
};

function stub(writeGate?: Promise<void>) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body as string | undefined });
      if (method !== 'GET') {
        await writeGate;
        return json({ ok: true });
      }
      return json([ROW]);
    }),
  );
  return { writes: () => calls.filter((c) => c.method !== 'GET') };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const closeButton = () => dialog()?.querySelector('[aria-label="Đóng"]') ?? null;
const slot = (name: string) => byText(dialog()!, 'button', name)!;
const stubBtn = (name: string) => click(slot(name));
const saveBtn = () => byText(dialog()!, 'button', /^(Đánh dấu đã trả|Đang tải ảnh…)$/) as HTMLButtonElement;
const pressEscape = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
const open = async () => {
  const r = render(<PayrollAdminTab />);
  mounted.push(r);
  await flush();
  click(r.container.querySelector('[aria-label="Ghi đã trả lương · Lan"]'));
  await flush();
};

describe('PayrollAdminTab — tấm "Xác nhận đã chuyển" lúc ảnh còn đang xử lý', () => {
  it('ảnh đang lên: nút báo aria-busy + aria-disabled, đổi chữ, bấm không ghi; tấm không đóng được (không nút Đóng, Esc); ảnh xong thì nhả, đóng được, ghi đúng ảnh mới', async () => {
    const api = stub();
    await open();
    stubBtn('stub-co-anh');
    expect(saveBtn().textContent).toBe('Đánh dấu đã trả');
    expect(closeButton()).not.toBeNull();
    stubBtn('stub-bat-dau');
    const busy = saveBtn();
    expect(busy.textContent).toBe('Đang tải ảnh…');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    click(busy);
    await flush();
    expect(api.writes()).toHaveLength(0);
    expect(closeButton()).toBeNull();
    pressEscape();
    expect(dialog()).not.toBeNull();

    stubBtn('stub-xong-anh');
    const idle = saveBtn();
    expect(idle.textContent).toBe('Đánh dấu đã trả');
    expect(idle.hasAttribute('aria-busy')).toBe(false);
    expect(closeButton()).not.toBeNull();
    click(idle);
    await flush();
    expect(api.writes()).toHaveLength(1);
    expect(JSON.parse(api.writes()[0]!.body!)).toMatchObject({ proofImageUrl: 'data:image/jpeg;base64,MOI' });
  });

  it('hai lượt tải chồng nhau: lượt đầu xong vẫn khoá, chỉ nhả khi lượt cuối xong', async () => {
    const api = stub();
    await open();
    stubBtn('stub-co-anh');
    stubBtn('stub-bat-dau');
    stubBtn('stub-bat-dau');
    stubBtn('stub-xong-loi');
    expect(saveBtn().textContent).toBe('Đang tải ảnh…');
    click(saveBtn());
    await flush();
    expect(api.writes()).toHaveLength(0);
    expect(closeButton()).toBeNull();
    stubBtn('stub-xong-loi');
    expect(saveBtn().textContent).toBe('Đánh dấu đã trả');
    expect(closeButton()).not.toBeNull();
  });

  it('đang ghi: ô ảnh nhận disabled để ảnh đổi lúc này không lọt vào lần ghi đang chạy', async () => {
    let release!: () => void;
    const api = stub(new Promise<void>((r) => (release = r)));
    await open();
    stubBtn('stub-co-anh');
    expect(dialog()!.querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('false');
    click(saveBtn());
    await flush();
    expect(api.writes()).toHaveLength(1);
    expect(dialog()!.querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('true');
    await act(async () => release());
    await flush();
  });
});
