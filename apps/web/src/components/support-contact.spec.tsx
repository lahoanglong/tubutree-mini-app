// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Cùng các ca với support-contact.spec.tsx của Mini App; email là liên kết mailto: thay cho nút sao chép.

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  chatEnabled: false,
  support: { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null } as unknown,
  supportError: false,
  oa: { available: false, openChat: vi.fn() },
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-public-config', () => ({
  usePublicConfig: () => ({ chat: { enabled: mocks.chatEnabled, hours: { start: '08:00', end: '21:00' } }, isLoaded: true }),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path !== '/config/public') throw new Error(`chưa mock ${path}`);
      if (mocks.supportError) throw new Error('mạng');
      return { support: mocks.support };
    },
  },
}));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    get oa() {
      return mocks.oa;
    },
  },
}));

import { SupportContact } from './support-contact';

let mounted: Rendered[] = [];
const mount = async (props: { orderCode?: string } = { orderCode: 'TT001' }) => {
  const r = render(<SupportContact {...props} />);
  mounted.push(r);
  await flush(5);
  return r.container;
};

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.chatEnabled = false;
  mocks.supportError = false;
  mocks.support = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null };
  mocks.oa = { available: false, openChat: vi.fn() };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('SupportContact — kênh hỗ trợ', () => {
  it('chưa có OA: có hotline (tel: số gốc, hiện số dễ đọc) và email, không có nút OA', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Cần hỗ trợ?');
    expect(c.querySelector('a[href="tel:0984606774"]')?.textContent).toBe('Gọi hotline 0984 606 774');
    expect(c.querySelector('a[href="mailto:tubutree@gmail.com"]')).not.toBeNull();
    expect(byText(c, 'button', 'Zalo OA')).toBeNull();
  });

  it('tổng đài số liền 18001234: hiện "1800 1234" nhưng tel: giữ số gốc', async () => {
    mocks.support = { hotline: '18001234', email: null, zaloOaName: null };
    const c = await mount();
    const a = c.querySelector('a[href^="tel:"]')!;
    expect(a.getAttribute('href')).toBe('tel:18001234');
    expect(a.textContent).toBe('Gọi hotline 1800 1234');
  });

  it('có OA: nút nhắn Zalo OA kèm mã đơn, hotline vẫn hiện', async () => {
    mocks.oa.available = true;
    const c = await mount();
    click(byText(c, 'button', 'Nhắn Zalo OA'));
    expect(mocks.oa.openChat).toHaveBeenCalledWith('Hỗ trợ đơn TT001');
    expect(c.querySelector('a[href^="tel:"]')).not.toBeNull();
  });

  it('admin để trống hết và không có OA: ẩn cả khối', async () => {
    mocks.support = { hotline: null, email: null, zaloOaName: null };
    const c = await mount();
    expect(c.textContent).toBe('');
  });

  it('không đọc được cấu hình: rơi về hotline/email mặc định', async () => {
    mocks.supportError = true;
    const c = await mount();
    expect(c.querySelector('a[href="tel:0984606774"]')).not.toBeNull();
    expect(c.querySelector('a[href="mailto:tubutree@gmail.com"]')).not.toBeNull();
  });

  describe('chat với Tubu Tree', () => {
    it('chat bật và đã đăng nhập: nút dẫn tới /ho-tro/chat?order=<mã đơn>, không còn nút OA', async () => {
      mocks.chatEnabled = true;
      mocks.oa.available = true;
      const c = await mount();
      expect(c.querySelector('a[href="/ho-tro/chat?order=TT001"]')?.textContent).toBe('Chat với Tubu Tree');
      expect(byText(c, 'button', 'Zalo OA')).toBeNull();
      expect(c.querySelector('a[href^="tel:"]')).not.toBeNull();
    });

    it('không có mã đơn: dẫn tới /ho-tro/chat', async () => {
      mocks.chatEnabled = true;
      const c = await mount({});
      expect(c.querySelector('a[href="/ho-tro/chat"]')).not.toBeNull();
    });

    it('chat tắt: giữ OA và hotline như cũ, không có nút chat', async () => {
      mocks.oa.available = true;
      const c = await mount();
      expect(byText(c, 'button', 'Nhắn Zalo OA')).not.toBeNull();
      expect(c.querySelector('a[href^="tel:"]')).not.toBeNull();
      expect(c.textContent).not.toContain('Chat với Tubu Tree');
    });

    it('chat bật nhưng chưa đăng nhập: giữ OA và hotline, thêm lời mời đăng nhập quay lại đúng chat của đơn', async () => {
      mocks.chatEnabled = true;
      mocks.oa.available = true;
      mocks.phase = 'guest';
      const c = await mount();
      expect(byText(c, 'button', 'Nhắn Zalo OA')).not.toBeNull();
      expect(c.querySelector('a[href^="tel:"]')).not.toBeNull();
      expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fho-tro%2Fchat%3Forder%3DTT001');
      expect(c.querySelector('a[href^="/dang-nhap"]')?.textContent).toBe('Đăng nhập để chat với Tubu Tree');
    });

    it('đang khôi phục phiên: không có nút chat lẫn lời mời, chỉ OA và hotline', async () => {
      mocks.chatEnabled = true;
      mocks.oa.available = true;
      mocks.phase = 'loading';
      const c = await mount();
      expect(byText(c, 'button', 'Nhắn Zalo OA')).not.toBeNull();
      expect(c.textContent).not.toMatch(/chat với Tubu Tree/i);
    });
  });
});
