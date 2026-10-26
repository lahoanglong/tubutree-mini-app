// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { ConfigRow } from '@/lib/admin-client';
import { buildPartnerRuleWrites, readPartnerRuleForm } from '@/lib/admin-config-forms';
import { PartnerRulesCard } from './partner-rules-card';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ROWS: ConfigRow[] = [
  { key: 'affiliate.default_rate_pct', value: 8, description: null, category: 'affiliate' },
  { key: 'affiliate.max_rate_pct', value: 50, description: null, category: 'affiliate' },
  { key: 'merchant.confirm_sla_hours', value: 24, description: null, category: 'merchant' },
];

function mount() {
  const puts: { key: string; value: unknown }[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return { body: { ok: true } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<PartnerRulesCard rows={ROWS} />);
  mounted.push(r);
  return { puts, c: r.container };
}
const input = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input');
const submit = (c: HTMLElement) => click([...c.querySelectorAll('button')].find((b) => b.textContent === 'Lưu hoa hồng và thời hạn')!);

describe('buildPartnerRuleWrites', () => {
  const ok = readPartnerRuleForm(ROWS);
  it('giá trị đang chạy và mặc định cho khoá chưa có đều hợp lệ', () => {
    expect(ok).toEqual({ defaultRate: '8', maxRate: '50', confirmHours: '24', shipHours: '48', deliverDays: '7' });
    expect(buildPartnerRuleWrites(ok).error).toBeUndefined();
  });
  it('chặn phần trăm ngoài 0–50, số lẻ, giờ không dương và mặc định cao hơn trần', () => {
    expect(buildPartnerRuleWrites({ ...ok, defaultRate: '51' }).error).toContain('từ 0 đến 50');
    expect(buildPartnerRuleWrites({ ...ok, defaultRate: '7.5' }).error).toContain('số nguyên');
    expect(buildPartnerRuleWrites({ ...ok, maxRate: '101' }).error).toContain('từ 0 đến 100');
    expect(buildPartnerRuleWrites({ ...ok, confirmHours: '0' }).error).toContain('từ 1 đến 168');
    expect(buildPartnerRuleWrites({ ...ok, shipHours: '-3' }).error).toBeDefined();
    expect(buildPartnerRuleWrites({ ...ok, defaultRate: '30', maxRate: '20' }).error).toContain('không được cao hơn trần');
  });
});

describe('PartnerRulesCard', () => {
  it('đổi số: hỏi lại với tên dễ hiểu rồi mới lưu, không lộ tên khoá', async () => {
    const { c, puts } = mount();
    typeInto(input(c, 'Hoa hồng mặc định'), '10');
    submit(c);
    await flush();
    expect(confirmDialog()?.textContent).toContain('8 → 10');
    expect(confirmDialog()?.textContent).not.toContain('affiliate.');
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'affiliate.default_rate_pct', value: 10 }]);
  });

  it('số sai: báo lỗi, không hỏi và không gọi API', async () => {
    const { c, puts } = mount();
    typeInto(input(c, 'Hạn gian hàng đối tác xác nhận'), '0');
    submit(c);
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(c.textContent).toContain('từ 1 đến 168');
    expect(puts).toEqual([]);
  });
});
