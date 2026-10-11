// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DealerClaimsTab, ClaimRow } from './dealer-claims-tab';
import { byText, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { AdminDealerRewardClaim } from '@/lib/admin-client';

// C-097 (Q-25/Q-29): các khối admin còn lại chuyển sang token DS v2 và nút chạm được ở 390px. Chỉ kiểm phần trình
// bày; hành vi nghiệp vụ của từng khối đã có spec riêng.
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
  vi.restoreAllMocks();
});

const claim = (over: Partial<AdminDealerRewardClaim> = {}): AdminDealerRewardClaim => ({
  id: 'c1',
  userId: 'u1',
  rewardId: 'r1',
  periodKey: 'Q3/2026',
  rewardTitle: 'Tour Phú Quốc',
  rewardType: 'TOUR',
  rewardPeriod: 'QUARTER',
  threshold: 50_000_000,
  volumeAtClaim: 52_000_000,
  note: null,
  status: 'PENDING',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  paidBy: null,
  paidAt: null,
  adminNote: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  dealer: { id: 'u1', fullName: 'Nguyễn A', phone: '0901234567', businessName: 'Đại lý Xanh' },
  ...over,
});

describe('ClaimRow / DealerClaimsTab — DS v2', () => {
  it('yêu cầu chờ duyệt: "Duyệt" forest, "Từ chối" viền danger, cả hai cao 44px', () => {
    const { container } = mount(<ClaimRow claim={claim()} />);
    const approve = byText(container, 'button', 'Duyệt');
    const reject = byText(container, 'button', 'Từ chối');
    expect(approve?.className).toContain('bg-forest-600');
    expect(approve?.className).toContain('min-h-[44px]');
    expect(reject?.className).toContain('border-danger-fg');
    expect(reject?.className).toContain('min-h-[44px]');
  });

  it('đã duyệt: "Đã trao thưởng" 44px; đã từ chối: "Mở lại yêu cầu" 44px, lý do từ chối tô danger-fg', () => {
    const a = mount(<ClaimRow claim={claim({ status: 'APPROVED' })} />);
    expect(byText(a.container, 'button', 'Đã trao thưởng')?.className).toContain('min-h-[44px]');
    const r = mount(<ClaimRow claim={claim({ status: 'REJECTED', rejectionReason: 'Nhầm kỳ' })} />);
    expect(byText(r.container, 'button', 'Mở lại yêu cầu')?.className).toContain('min-h-[44px]');
    expect(byText(r.container, 'span', 'Nhầm kỳ')?.className).toContain('text-danger-fg');
  });

  it('thanh lọc trạng thái: chip 44px, chip đang chọn nền forest, mặc định lọc PENDING', async () => {
    const api = mockFetch({ '/admin/dealer-reward-claims': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerClaimsTab />);
    await flush();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[];
    for (const t of tabs) expect(t.className).toContain('min-h-[44px]');
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.className).toContain('bg-forest-600');
    expect(api.calls[0]!.url).toContain('status=PENDING');
  });
});
