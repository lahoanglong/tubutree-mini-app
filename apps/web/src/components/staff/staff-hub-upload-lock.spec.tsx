// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Ô ảnh thật gỡ khỏi cây khi tắt "Đột xuất" nhưng lượt tải đã chạy vẫn gọi onChange/onBusyChange lúc xong: giữ lại cặp hàm của lần vẽ cuối để mô phỏng ảnh về muộn.
const slot = vi.hoisted(() => ({ late: null as null | { onChange: (v: string[]) => void; onBusyChange?: (busy: boolean) => void } }));

vi.mock('./today-card', () => ({ TodayCard: () => null }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ onChange, onBusyChange, disabled }: { onChange: (v: string[]) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => {
    slot.late = { onChange, onBusyChange };
    return (
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
    );
  },
}));

import { StaffHub } from './staff-hub';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { vnDateKey } from '@/lib/week';

// Khoá nút "Xác nhận huỷ" và đóng tấm huỷ ca lúc ảnh chứng cứ còn đang xử lý (Mini ↔ web, Wave 85B ↔ Wave 90A).

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const today = vnDateKey(new Date());
const SHIFT = {
  id: 's1',
  staffId: 'u1',
  workDate: `${today}T00:00:00.000Z`,
  startAt: `${today}T01:00:00.000Z`,
  endAt: `${today}T05:00:00.000Z`,
  templateId: null,
  status: 'APPROVED',
  approvedStart: null,
  approvedEnd: null,
  rejectReason: null,
  cancelReason: null,
  isEmergency: false,
  evidenceUrl: null,
  cancelPenalty: false,
};

const SHIFT_B = { ...SHIFT, id: 's2', startAt: `${today}T06:00:00.000Z`, endAt: `${today}T09:00:00.000Z` };

function stub(cancelGate?: Promise<void>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (init?.method === 'POST' && url.endsWith('/cancel')) {
        await cancelGate;
        return json({ cancelled: true, penalty: false });
      }
      if (url.includes('/staff/shift-templates')) return json([]);
      if (url.includes('/staff/shifts')) return json([SHIFT, SHIFT_B]);
      return json([]);
    }),
  );
  return { cancels: () => calls.filter((c) => c.init?.method === 'POST' && c.url.endsWith('/cancel')) };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const closeButton = () => dialog()?.querySelector('[aria-label="Đóng"]') ?? null;
const stubBtn = (name: string) => click(byText(dialog()!, 'button', name));
const confirmBtn = () => byText(dialog()!, 'button', /^(Xác nhận huỷ|Đang tải ảnh…|Đang huỷ…)$/) as HTMLButtonElement;
const emergencySwitch = () => dialog()!.querySelector<HTMLElement>('[role="switch"]')!;
const pressEscape = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
const open = async (index = 0) => {
  const r = render(<StaffHub />);
  mounted.push(r);
  await flush();
  await flush();
  await openAt(r, index);
  return r;
};
const openAt = async (r: Rendered, index: number) => {
  click(r.container.querySelectorAll('[aria-label^="Huỷ ca"]')[index] ?? null);
  await flush();
  typeInto(dialog()!.querySelector('textarea'), 'Bận việc nhà');
};

describe('StaffHub — tấm huỷ ca lúc ảnh chứng cứ còn đang xử lý', () => {
  it('ảnh đang lên: nút báo aria-busy + aria-disabled, đổi chữ, bấm không gửi; tấm không đóng được (không nút Đóng, Esc); ảnh xong thì nhả, đóng được, gửi đúng ảnh mới', async () => {
    const api = stub();
    await open();
    click(emergencySwitch());
    stubBtn('stub-co-anh');
    expect(confirmBtn().textContent).toBe('Xác nhận huỷ');
    stubBtn('stub-bat-dau');
    const busy = confirmBtn();
    expect(busy.textContent).toBe('Đang tải ảnh…');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    click(busy);
    await flush();
    expect(api.cancels()).toHaveLength(0);
    expect(closeButton()).toBeNull();
    pressEscape();
    expect(dialog()).not.toBeNull();

    stubBtn('stub-xong-anh');
    const idle = confirmBtn();
    expect(idle.textContent).toBe('Xác nhận huỷ');
    expect(idle.hasAttribute('aria-busy')).toBe(false);
    expect(closeButton()).not.toBeNull();
    click(idle);
    await flush();
    expect(api.cancels()).toHaveLength(1);
    expect(JSON.parse(api.cancels()[0]!.init!.body as string)).toMatchObject({ isEmergency: true, evidenceUrl: 'data:image/jpeg;base64,MOI' });
  });

  it('hai lượt tải chồng nhau: lượt đầu xong vẫn khoá, chỉ nhả khi lượt cuối xong', async () => {
    const api = stub();
    await open();
    click(emergencySwitch());
    stubBtn('stub-co-anh');
    stubBtn('stub-bat-dau');
    stubBtn('stub-bat-dau');
    stubBtn('stub-xong-loi');
    expect(confirmBtn().textContent).toBe('Đang tải ảnh…');
    click(confirmBtn());
    await flush();
    expect(api.cancels()).toHaveLength(0);
    stubBtn('stub-xong-loi');
    expect(confirmBtn().textContent).toBe('Xác nhận huỷ');
  });

  it('tắt "Đột xuất" gỡ ô ảnh nhưng lượt tải còn chạy vẫn khoá nút và tấm (không nút Đóng, Esc); bật lại thì ô ảnh mới khoá chọn ảnh thứ hai; xong mới nhả', async () => {
    const api = stub();
    await open();
    click(emergencySwitch());
    stubBtn('stub-bat-dau');
    expect(confirmBtn().textContent).toBe('Đang tải ảnh…');
    click(emergencySwitch());
    const busy = confirmBtn();
    expect(busy.textContent).toBe('Đang tải ảnh…');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    click(busy);
    await flush();
    expect(api.cancels()).toHaveLength(0);
    expect(closeButton()).toBeNull();
    pressEscape();
    expect(dialog()).not.toBeNull();

    click(emergencySwitch());
    expect(dialog()!.querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('true');
    expect(confirmBtn().textContent).toBe('Đang tải ảnh…');
    stubBtn('stub-xong-loi');
    expect(confirmBtn().textContent).toBe('Xác nhận huỷ');
    expect(dialog()!.querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('false');
    expect(closeButton()).not.toBeNull();
    expect(api.cancels()).toHaveLength(0);
  });

  it('ảnh ca A về muộn sau khi tắt "Đột xuất": tấm vẫn khoá tới khi ảnh về, đóng rồi mở ca B thì không còn ảnh nào, bật "Đột xuất" ở ca B vẫn phải tự chọn ảnh', async () => {
    const api = stub();
    const r = await open(0);
    click(emergencySwitch());
    stubBtn('stub-bat-dau');
    click(emergencySwitch());
    expect(closeButton()).toBeNull();

    const late = slot.late!;
    act(() => late.onChange(['data:image/jpeg;base64,CUA']));
    expect(closeButton()).toBeNull();
    act(() => late.onBusyChange?.(false));
    const close = closeButton();
    expect(close).not.toBeNull();
    click(close);
    await flush();
    expect(dialog()).toBeNull();

    await openAt(r, 1);
    click(emergencySwitch());
    expect(confirmBtn().disabled).toBe(true);
    click(confirmBtn());
    await flush();
    expect(api.cancels()).toHaveLength(0);
  });

  it('huỷ không khẩn không đính ảnh còn lại trong state sau khi tắt "Đột xuất"', async () => {
    const api = stub();
    await open();
    click(emergencySwitch());
    stubBtn('stub-co-anh');
    click(emergencySwitch());
    click(confirmBtn());
    await flush();
    expect(api.cancels()).toHaveLength(1);
    const body = JSON.parse(api.cancels()[0]!.init!.body as string);
    expect(body).toMatchObject({ isEmergency: false });
    expect(body).not.toHaveProperty('evidenceUrl');
  });

  it('đang huỷ: ô ảnh nhận disabled để ảnh đổi lúc này không lọt vào lần huỷ đang chạy', async () => {
    let release!: () => void;
    const api = stub(new Promise<void>((r) => (release = r)));
    await open();
    click(emergencySwitch());
    stubBtn('stub-xong-anh');
    expect(dialog()!.querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('false');
    click(confirmBtn());
    await flush();
    expect(api.cancels()).toHaveLength(1);
    expect(dialog()!.querySelector('[data-testid="slot-disabled"]')!.textContent).toBe('true');
    await act(async () => release());
    await flush();
  });
});
