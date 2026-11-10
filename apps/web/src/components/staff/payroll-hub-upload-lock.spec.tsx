// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ onChange, onBusyChange, disabled }: { onChange: (v: string[]) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => (
    <>
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

import { PayrollHub } from './payroll-hub';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Khoá nút Lưu và đóng tấm "Thông tin nhận lương" lúc ảnh QR còn đang xử lý (Mini ↔ web, Wave 85B ↔ Wave 90A).

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const profile = { hourlyRate: 30000, bankBin: '970436', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A', qrImageUrl: null, active: true };

function stub(putGate?: Promise<void>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (init?.method === 'PUT') {
        await putGate;
        return json(profile);
      }
      if (url.includes('/staff/payroll')) {
        return json({ month: { year: 2026, month: 10, status: 'OPEN', totalMinutes: 0, gross: 0, totalFines: 0, net: 0 }, days: [], profile });
      }
      return json([]);
    }),
  );
  return { puts: () => calls.filter((c) => c.init?.method === 'PUT') };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const closeButton = () => dialog()?.querySelector('[aria-label="Đóng"]') ?? null;
const stubBtn = (name: string) => click(byText(dialog()!, 'button', name));
const saveBtn = () => byText(dialog()!, 'button', /^(Lưu|Đang lưu…|Đang tải ảnh…)$/) as HTMLButtonElement;
const pressEscape = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
const open = async () => {
  const r = render(<PayrollHub />);
  mounted.push(r);
  await flush();
  click(byText(r.container, 'button', 'Thông tin nhận lương'));
  await flush();
};

describe('PayrollHub — tấm "Thông tin nhận lương" lúc ảnh QR còn đang xử lý', () => {
  it('ảnh đang lên: Lưu báo aria-busy + aria-disabled, đổi chữ, bấm không gửi; tấm không đóng được (không nút Đóng, Esc); ảnh xong thì nhả, đóng được, gửi đúng ảnh mới', async () => {
    const api = stub();
    await open();
    expect(closeButton()).not.toBeNull();
    stubBtn('stub-bat-dau');
    const busy = saveBtn();
    expect(busy.textContent).toBe('Đang tải ảnh…');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    click(busy);
    await flush();
    expect(api.puts()).toHaveLength(0);
    expect(closeButton()).toBeNull();
    pressEscape();
    expect(dialog()).not.toBeNull();

    stubBtn('stub-xong-anh');
    const idle = saveBtn();
    expect(idle.textContent).toBe('Lưu');
    expect(idle.hasAttribute('aria-busy')).toBe(false);
    expect(closeButton()).not.toBeNull();
    click(idle);
    await flush();
    expect(api.puts()).toHaveLength(1);
    expect(JSON.parse(api.puts()[0]!.init!.body as string)).toMatchObject({ qrImageUrl: 'data:image/jpeg;base64,MOI' });
  });

  it('hai lượt tải chồng nhau: lượt đầu xong vẫn khoá, chỉ nhả khi lượt cuối xong', async () => {
    const api = stub();
    await open();
    stubBtn('stub-bat-dau');
    stubBtn('stub-bat-dau');
    stubBtn('stub-xong-loi');
    expect(saveBtn().textContent).toBe('Đang tải ảnh…');
    click(saveBtn());
    await flush();
    expect(api.puts()).toHaveLength(0);
    expect(closeButton()).toBeNull();
    stubBtn('stub-xong-loi');
    expect(saveBtn().textContent).toBe('Lưu');
  });

  it('đang lưu: ô ảnh nhận disabled để ảnh đổi lúc này không lọt vào lần lưu đang chạy', async () => {
    let release!: () => void;
    const api = stub(new Promise<void>((r) => (release = r)));
    await open();
    expect(dialog()!.querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('false');
    click(saveBtn());
    await flush();
    expect(api.puts()).toHaveLength(1);
    expect(dialog()!.querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('true');
    await act(async () => release());
    await flush();
  });
});
