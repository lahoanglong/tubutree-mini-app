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
  { key: 'affiliate.max_rate_pct', value: 10, description: null, category: 'affiliate' },
  { key: 'merchant.confirm_sla_hours', value: 24, description: null, category: 'merchant' },
];

function mount(failKey?: string) {
  const puts: { key: string; value: unknown }[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') {
        const b = JSON.parse(String(init.body));
        puts.push(b);
        if (b.key === failKey) return { status: 400, body: { message: `"${b.key}" (${b.value}%) vượt trần 10% của "affiliate.max_rate_pct". Nâng trần trước.` } };
      }
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
    expect(ok).toEqual({ defaultRate: '8', maxRate: '10', confirmHours: '24', shipHours: '48', deliverDays: '7' });
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

describe('thứ tự ghi hoa hồng (API so với giá trị đang lưu của khoá còn lại)', () => {
  const cur = readPartnerRuleForm(ROWS); // mặc định 8, trần 10
  const keys = (f: typeof cur) => buildPartnerRuleWrites(f, cur).writes!.filter((w) => w.key.startsWith('affiliate.')).map((w) => w.key);
  it('nâng cả hai (mặc định mới lớn hơn trần đang lưu): ghi trần trước', () => {
    expect(keys({ ...cur, defaultRate: '20', maxRate: '30' })).toEqual(['affiliate.max_rate_pct', 'affiliate.default_rate_pct']);
  });
  it('hạ cả hai hoặc chỉ đổi mặc định: ghi mặc định trước', () => {
    expect(keys({ ...cur, defaultRate: '3', maxRate: '5' })).toEqual(['affiliate.default_rate_pct', 'affiliate.max_rate_pct']);
    expect(keys({ ...cur, defaultRate: '9' })).toEqual(['affiliate.default_rate_pct', 'affiliate.max_rate_pct']);
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

  it('đổi hạn xác nhận: hộp hỏi nói áp ngay cho đơn đang xử lý và nhắc kể cả báo khách trong vòng một giờ; không nói "đơn cũ giữ mức"', async () => {
    const { c } = mount();
    typeInto(input(c, 'Hạn gian hàng đối tác xác nhận'), '30');
    submit(c);
    await flush();
    const t = confirmDialog()?.textContent ?? '';
    expect(t).toContain('áp ngay cho cả đơn đang xử lý');
    expect(t).toContain('trong vòng một giờ, kể cả báo cho khách');
    expect(t).not.toContain('đơn cũ giữ mức');
    expect(t).not.toContain('HẠ hạn');
  });

  it('hạ hạn: cảnh báo mạnh hơn nâng hạn', async () => {
    const { c } = mount();
    typeInto(input(c, 'Hạn gian hàng đối tác xác nhận'), '12');
    submit(c);
    await flush();
    expect(confirmDialog()?.textContent).toContain('Bạn đang HẠ hạn');
  });

  it('đổi hoa hồng: giữ câu đơn cũ giữ mức đã chốt; hạ trần nói rõ không đổi % riêng', async () => {
    const { c } = mount();
    typeInto(input(c, 'Hoa hồng mặc định'), '5');
    typeInto(input(c, 'Trần hoa hồng'), '6');
    submit(c);
    await flush();
    const t = confirmDialog()?.textContent ?? '';
    expect(t).toContain('đơn cũ giữ mức đã chốt');
    expect(t).toContain('Hạ trần không đổi những % riêng');
    expect(t).not.toContain('Hạn xử lý');
  });

  it('nâng cả hai: gọi API trần trước rồi mặc định', async () => {
    const { c, puts } = mount();
    typeInto(input(c, 'Hoa hồng mặc định'), '20');
    typeInto(input(c, 'Trần hoa hồng'), '30');
    submit(c);
    await flush();
    answerConfirm(true);
    await flush();
    expect(puts.map((p) => p.key)).toEqual(['affiliate.max_rate_pct', 'affiliate.default_rate_pct']);
  });

  it('lưu một phần: báo khoá nào đã lưu, khoá nào chưa, không lộ tên khoá và giữ số đang gõ', async () => {
    const { c } = mount('merchant.confirm_sla_hours');
    typeInto(input(c, 'Trần hoa hồng'), '12');
    typeInto(input(c, 'Hạn gian hàng đối tác xác nhận'), '30');
    submit(c);
    await flush();
    answerConfirm(true);
    await flush();
    const text = c.textContent ?? '';
    expect(text).toContain('Đã lưu: Trần hoa hồng mỗi sản phẩm');
    expect(text).toContain('Chưa lưu: Hạn gian hàng đối tác xác nhận');
    expect(text).not.toContain('affiliate.');
    expect(text).not.toContain('merchant.');
    expect(input(c, 'Hạn gian hàng đối tác xác nhận')!.value).toBe('30');
  });

  it('hạn xác nhận lớn hơn hoặc bằng hạn gửi hàng: cảnh báo ngay trên form', async () => {
    const { c } = mount();
    expect(c.textContent).not.toContain('quá hạn gửi hàng ngay');
    typeInto(input(c, 'Hạn gian hàng đối tác xác nhận'), '48');
    expect(c.textContent).toContain('quá hạn gửi hàng ngay');
  });
});
