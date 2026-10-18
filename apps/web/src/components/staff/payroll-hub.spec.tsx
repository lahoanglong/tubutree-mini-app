// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PayrollHub } from './payroll-hub';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const profile = { hourlyRate: 30000, bankBin: '970436', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A', qrImageUrl: null, active: true };

function stub(payrollOk: boolean) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (init?.method === 'PUT') return json(profile);
      if (url.includes('/staff/payroll')) {
        if (!payrollOk) return json({ message: 'Lỗi máy chủ' }, 500);
        return json({ month: { year: 2026, month: 10, status: 'OPEN', totalMinutes: 0, gross: 0, totalFines: 0, net: 0 }, days: [], profile });
      }
      return json([]);
    }),
  );
  return { puts: () => calls.filter((c) => c.init?.method === 'PUT') };
}

const bankButton = (c: HTMLElement) => byText(c, 'button', 'Thông tin nhận lương') as HTMLButtonElement;

describe('PayrollHub (Lương của tôi)', () => {
  it('tải lương lỗi: nút Thông tin nhận lương khoá, không mở được form rỗng để ghi đè tài khoản đã lưu', async () => {
    const api = stub(false);
    const r = render(<PayrollHub />);
    mounted.push(r);
    await flush();
    expect(bankButton(r.container).disabled).toBe(true);
    click(bankButton(r.container));
    await flush();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(api.puts()).toHaveLength(0);
  });

  it('tải xong: nút mở form nạp sẵn hồ sơ và Lưu gửi đúng tài khoản cũ', async () => {
    const api = stub(true);
    const r = render(<PayrollHub />);
    mounted.push(r);
    await flush();
    expect(bankButton(r.container).disabled).toBe(false);
    click(bankButton(r.container));
    await flush();
    click(byText(document.body, 'button', 'Lưu'));
    await flush();
    expect(JSON.parse(api.puts()[0]!.init!.body as string)).toMatchObject({ bankBin: '970436', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A' });
  });
});
