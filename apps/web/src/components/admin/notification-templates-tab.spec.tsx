// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotificationTemplatesTab } from './notification-templates-tab';
import { byText, click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const TEMPLATES = [
  {
    id: 'nt-confirmed',
    code: 'ORDER_CONFIRMED',
    channel: 'ZNS',
    zaloTemplateId: null,
    bodyTemplate: 'Đơn {{order_code}} đã được xác nhận.',
    delivery: 'ZNS_MISSING_TEMPLATE_ID',
    sent30d: { INAPP: 40, ZNS: 0 },
  },
  {
    id: 'nt-streak',
    code: 'GAME_STREAK_REMINDER',
    channel: 'INAPP',
    zaloTemplateId: null,
    bodyTemplate: 'Giữ lửa chuỗi điểm danh nhé!',
    delivery: 'INAPP',
    sent30d: { INAPP: 120, ZNS: 0 },
  },
];

function stub(patch: { status?: number; body: unknown } = { body: { code: 'ORDER_CONFIRMED' } }) {
  const m = mockFetch({
    '/admin/notification-templates/': () => patch,
    '/admin/notification-templates': { body: TEMPLATES },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return { patches: () => m.calls.filter((c) => c.init?.method === 'PATCH') };
}

describe('NotificationTemplatesTab (Mẫu thông báo)', () => {
  it('nói rõ template nào khách chỉ thấy trong app, template ZNS nào còn thiếu mã mẫu', async () => {
    stub();
    const { container } = mount(<NotificationTemplatesTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('ORDER_CONFIRMED');
    expect(text).toContain('Thiếu mã mẫu ZNS');
    expect(text).toContain('Chỉ trong app');
    expect(text).toContain('1 mẫu kênh ZNS chưa có mã mẫu');
    expect(text).toContain('40 lượt / 30 ngày');
  });

  it('điền mã mẫu Zalo đã duyệt rồi lưu → PATCH đúng template, gửi kênh ZNS + mã', async () => {
    const api = stub();
    const { container } = mount(<NotificationTemplatesTab />);
    await flush();
    const row = container.querySelector<HTMLElement>('[data-template="ORDER_CONFIRMED"]')!;
    typeInto(row.querySelector('input[name="zaloTemplateId"]'), '231570');
    click(byText(row, 'button', 'Lưu'));
    await flush();
    const [call] = api.patches();
    expect(call!.url).toContain('/admin/notification-templates/ORDER_CONFIRMED');
    expect(JSON.parse(String(call!.init!.body))).toEqual({
      channel: 'ZNS',
      zaloTemplateId: '231570',
      bodyTemplate: 'Đơn {{order_code}} đã được xác nhận.',
    });
    expect(row.textContent).toContain('Đã lưu');
  });

  it('chọn ZNS mà chưa nhập mã → nút Lưu khoá, kèm lời nhắc; lỗi từ API hiện nguyên văn', async () => {
    stub({ status: 400, body: { message: 'Mã mẫu ZNS là dãy số Zalo cấp khi duyệt mẫu (vd 231570).' } });
    const { container } = mount(<NotificationTemplatesTab />);
    await flush();
    const row = container.querySelector<HTMLElement>('[data-template="GAME_STREAK_REMINDER"]')!;
    selectValue(row.querySelector('select[name="channel"]'), 'ZNS');
    const save = byText(row, 'button', 'Lưu') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(row.textContent).toContain('Kênh ZNS cần mã mẫu');
    typeInto(row.querySelector('input[name="zaloTemplateId"]'), 'abc');
    click(save);
    await flush();
    expect(row.textContent).toContain('Mã mẫu ZNS là dãy số Zalo cấp khi duyệt mẫu');
  });

  it('mẫu ZNS có lượt lỗi: admin thấy số lượt và mã + lý do Zalo trả về của lần gần nhất', async () => {
    const failing = {
      id: 'nt-ship',
      code: 'ORDER_SHIPPING',
      channel: 'ZNS',
      zaloTemplateId: '231570',
      bodyTemplate: 'Đơn đang giao.',
      delivery: 'ZNS',
      sent30d: { INAPP: 10, ZNS: 4 },
      znsFailed30d: 3,
      znsLastError: { text: 'ZNS lỗi -118: user not exist', at: '2026-10-01T03:04:59.000Z' },
    };
    const m = mockFetch({ '/admin/notification-templates': { body: [failing, ...TEMPLATES] } });
    vi.stubGlobal('fetch', vi.fn(m.fn));
    const { container } = mount(<NotificationTemplatesTab />);
    await flush();
    const row = container.querySelector<HTMLElement>('[data-template="ORDER_SHIPPING"]')!;
    expect(row.querySelector('[data-zns-failure]')?.textContent).toContain('3 lượt ZNS lỗi trong 30 ngày');
    expect(row.textContent).toContain('ZNS lỗi -118: user not exist');
    expect(container.querySelector('[data-template="ORDER_CONFIRMED"] [data-zns-failure]')).toBeNull();
  });
});
