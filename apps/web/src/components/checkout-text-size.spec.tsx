// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  recordReferralTouch: vi.fn(),
}));

import { OrderConsent } from './order-consent';
import { ReferralCodeBox } from './referral-code-box';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r.container;
};

// Chữ trên màn thanh toán ở điện thoại phải từ 13px (bậc caption); `text-xs` là 12px.
describe('thanh toán: chữ nhỏ nhất là 13px', () => {
  it('dòng đồng ý điều khoản dùng bậc caption (lớp `.tubu-consent-line` của mini.css, chung với Mini App)', () => {
    const c = mount(<OrderConsent />);
    const p = c.querySelector('[data-testid="order-consent"]')!;
    expect(p.className).toContain('tubu-consent-line');
    expect(p.className).not.toContain('text-xs');
    const css = readFileSync(resolve(__dirname, 'mini/mini.css'), 'utf8');
    expect(css).toMatch(/\.tubu-consent-line \{[^}]*font-size: var\(--type-caption-size\);/);
  });

  it('ô mã giới thiệu (chưa nhập) dùng bậc caption cho câu gợi ý và nút Nhập mã', () => {
    const c = mount(<ReferralCodeBox linkedCode={null} appliedCode={null} onApplied={() => undefined} />);
    expect(c.innerHTML).not.toContain('text-xs');
    expect(c.innerHTML).toContain('text-caption');
  });

  it('ô mã giới thiệu (đã có mã) dùng bậc caption cho mã và câu xác nhận', () => {
    const c = mount(<ReferralCodeBox linkedCode="TUBU123" appliedCode={null} onApplied={() => undefined} />);
    expect(c.innerHTML).not.toContain('text-xs');
  });
});
