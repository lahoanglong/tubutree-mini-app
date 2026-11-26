// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_SCAN_COPY } from '@tubutree/app-core/marketplace-scan-guide';
import { render, type Rendered } from '@/test-utils/dom';

const ON = { isLoaded: true, loyalty: { marketplaceEarnPct: 5, marketplaceClaimEnabled: true } };
const mocks = vi.hoisted(() => ({ cfg: {} as Record<string, unknown> }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/components/ui/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));

import { ScanView } from './scan-view';

let mounted: Rendered | null = null;
const mount = () => {
  mounted = render(<ScanView />);
  return mounted.container;
};

beforeEach(() => {
  mocks.cfg = ON;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('/quet-ma — tab giữa Quét mã của web (W42)', () => {
  it('hướng dẫn 3 bước cùng chữ với Mini App, tỉ lệ đọc từ cấu hình công khai', () => {
    const c = mount();
    const guide = c.querySelector('[data-testid="scan-guide"]')!;
    expect(guide.getAttribute('aria-label')).toBe(MARKETPLACE_SCAN_COPY.guideTitle);
    const steps = Array.from(guide.querySelectorAll('.tubu-scan-guide__text')).map((s) => s.textContent);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe(MARKETPLACE_SCAN_COPY.step1);
    expect(steps[1]).toContain('5%');
    expect(steps[2]).toBe(MARKETPLACE_SCAN_COPY.step3);
  });

  it('cấu hình thiếu tỉ lệ: bước 2 không hứa con số', () => {
    mocks.cfg = { isLoaded: true, loyalty: { marketplaceClaimEnabled: true } };
    const steps = Array.from(mount().querySelectorAll('.tubu-scan-guide__text')).map((s) => s.textContent);
    expect(steps[1]).toBe(MARKETPLACE_SCAN_COPY.step2Plain);
  });

  it('cấu hình chưa về: chỉ tiêu đề, chưa hướng dẫn hay nút', () => {
    mocks.cfg = { isLoaded: false };
    const c = mount();
    expect(c.querySelector('h1')?.textContent).toBe('Tích điểm đơn sàn');
    expect(c.querySelector('[data-testid="scan-guide"]')).toBeNull();
    expect(c.querySelector('a')).toBeNull();
    expect(c.querySelector('[data-testid="scan-soon"]')).toBeNull();
  });

  it('cờ tích điểm đơn sàn tắt: báo sắp mở, không hứa tỉ lệ, không mời mở màn quét đang đóng', () => {
    mocks.cfg = { isLoaded: true, loyalty: { marketplaceEarnPct: 5, marketplaceClaimEnabled: false } };
    const c = mount();
    expect(c.querySelector('[data-testid="scan-soon"]')?.textContent).toContain(MARKETPLACE_SCAN_COPY.soonTitle);
    expect(c.querySelector('[data-testid="scan-guide"]')).toBeNull();
    expect(c.textContent).not.toContain('5%');
    expect(c.querySelector('a')).toBeNull();
  });

  it('không có ô nhập mã trên web; một nút mở đúng màn /points/scan của Mini App kèm lý do', () => {
    const c = mount();
    expect(c.querySelector('input')).toBeNull();
    expect(c.textContent).toContain(MARKETPLACE_SCAN_COPY.webWhy);
    const links = Array.from(c.querySelectorAll<HTMLAnchorElement>('a'));
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe(MARKETPLACE_SCAN_COPY.webOpenMiniApp);
    expect(links[0]!.getAttribute('href')).toMatch(/\/points\/scan$/);
  });
});
