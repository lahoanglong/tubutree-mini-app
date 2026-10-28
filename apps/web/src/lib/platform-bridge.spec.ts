import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const dl = vi.hoisted(() => ({ saveImage: vi.fn() }));
vi.mock('./download-image', () => dl);

import { createWebPlatformBridge } from './platform-bridge';

type G = Record<string, unknown>;
const g = globalThis as unknown as G;

function stubBrowser(over: { navigator?: Record<string, unknown>; localStorage?: unknown } = {}) {
  const open = vi.fn();
  const location = { href: '', origin: 'https://app.tubutree.com' };
  vi.stubGlobal('window', { open, location });
  vi.stubGlobal('navigator', over.navigator ?? {});
  if (over.localStorage !== undefined) vi.stubGlobal('localStorage', over.localStorage);
  return { open, location };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('platform-bridge (web)', () => {
  it('platform web và mọi capability tắt', () => {
    const b = createWebPlatformBridge({ oaId: '' });
    expect(b.platform).toBe('web');
    expect(b.capabilities).toEqual({ verifiedPhone: false, zaloLocation: false, qrScan: false, zaloNotifyPermission: false });
  });

  describe('saveImage', () => {
    it('chuyển cho download-image với url và tên file, trả saved', async () => {
      dl.saveImage.mockResolvedValue('saved');
      const r = await createWebPlatformBridge({ oaId: '' }).saveImage('https://img.vietqr.io/x.png', 'tubu-qr-A1.png');
      expect(r).toBe('saved');
      expect(dl.saveImage).toHaveBeenCalledWith('https://img.vietqr.io/x.png', 'tubu-qr-A1.png');
    });

    it('không tải được thì trả failed', async () => {
      dl.saveImage.mockResolvedValue('failed');
      expect(await createWebPlatformBridge({ oaId: '' }).saveImage('https://img.vietqr.io/x.png', 'a.png')).toBe('failed');
    });
  });

  describe('share', () => {
    it('có Web Share API: gọi với url tuyệt đối và trả shared', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      stubBrowser({ navigator: { share } });
      const r = await createWebPlatformBridge({ oaId: '' }).share({ title: 'Cây', text: 'Xem nè', path: '/san-pham/x' });
      expect(r).toBe('shared');
      expect(share).toHaveBeenCalledWith({ title: 'Cây', text: 'Xem nè', url: 'https://app.tubutree.com/san-pham/x' });
    });

    it('không truyền text thì không gửi khoá text', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      stubBrowser({ navigator: { share } });
      await createWebPlatformBridge({ oaId: '' }).share({ title: 'Cây', path: '/a' });
      expect(share).toHaveBeenCalledWith({ title: 'Cây', url: 'https://app.tubutree.com/a' });
    });

    it('khách đóng hộp chia sẻ (AbortError): cancelled, không chép link thay', async () => {
      const writeText = vi.fn();
      const share = vi.fn().mockRejectedValue(new DOMException('x', 'AbortError'));
      stubBrowser({ navigator: { share, clipboard: { writeText } } });
      expect(await createWebPlatformBridge({ oaId: '' }).share({ title: 't', path: '/a' })).toBe('cancelled');
      expect(writeText).not.toHaveBeenCalled();
    });

    it('share lỗi khác: rơi về chép link', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const share = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
      stubBrowser({ navigator: { share, clipboard: { writeText } } });
      expect(await createWebPlatformBridge({ oaId: '' }).share({ title: 't', path: '/a' })).toBe('copied');
      expect(writeText).toHaveBeenCalledWith('https://app.tubutree.com/a');
    });

    it('không có Web Share API: chép link', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubBrowser({ navigator: { clipboard: { writeText } } });
      expect(await createWebPlatformBridge({ oaId: '' }).share({ title: 't', path: '/a?b=1' })).toBe('copied');
      expect(writeText).toHaveBeenCalledWith('https://app.tubutree.com/a?b=1');
    });

    it('chép link cũng hỏng: failed', async () => {
      stubBrowser({ navigator: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } } });
      expect(await createWebPlatformBridge({ oaId: '' }).share({ title: 't', path: '/a' })).toBe('failed');
    });

    it('không có clipboard: failed', async () => {
      stubBrowser({ navigator: {} });
      expect(await createWebPlatformBridge({ oaId: '' }).share({ title: 't', path: '/a' })).toBe('failed');
    });
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>1</script>', 'không phải url', 'ftp://x.vn/a'])(
    'openExternal không mở URL scheme ngoài http(s): %s',
    (url) => {
      const { open } = stubBrowser();
      createWebPlatformBridge({ oaId: '' }).openExternal(url);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('openExternal mở tab mới, không để trang mới đọc được window.opener', () => {
    const { open } = stubBrowser();
    createWebPlatformBridge({ oaId: '' }).openExternal('https://shopee.vn/x');
    expect(open).toHaveBeenCalledWith('https://shopee.vn/x', '_blank', 'noopener,noreferrer');
  });

  it('callPhone dùng tel: và giữ nguyên số, bỏ khoảng trắng và dấu chấm', () => {
    const { location } = stubBrowser();
    const b = createWebPlatformBridge({ oaId: '' });
    b.callPhone('0912 345.678');
    expect(location.href).toBe('tel:0912345678');
    b.callPhone('1800 6868');
    expect(location.href).toBe('tel:18006868');
    b.callPhone('+84 912 345 678');
    expect(location.href).toBe('tel:+84912345678');
  });

  describe('oa', () => {
    it('chưa cấu hình id: available=false, openChat không mở gì, follow=false', async () => {
      const { open } = stubBrowser();
      const b = createWebPlatformBridge({ oaId: '  ' });
      expect(b.oa.available).toBe(false);
      await b.oa.openChat('hi');
      expect(await b.oa.follow()).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });

    it('có id: openChat mở https://zalo.me/<id> ở tab mới', async () => {
      const { open } = stubBrowser();
      const b = createWebPlatformBridge({ oaId: ' 123456 ' });
      expect(b.oa.available).toBe(true);
      await b.oa.openChat('xin chào');
      expect(open).toHaveBeenCalledWith('https://zalo.me/123456', '_blank', 'noopener,noreferrer');
    });

    it('id không an toàn cho URL (ký tự lạ): coi như chưa cấu hình', () => {
      expect(createWebPlatformBridge({ oaId: '../evil?x=1' }).oa.available).toBe(false);
    });

    it('follow mở trang OA nhưng trả false (web không đọc được trạng thái theo dõi)', async () => {
      const { open } = stubBrowser();
      const b = createWebPlatformBridge({ oaId: '123' });
      expect(await b.oa.follow()).toBe(false);
      expect(open).toHaveBeenCalledWith('https://zalo.me/123', '_blank', 'noopener,noreferrer');
    });

    it('mặc định đọc NEXT_PUBLIC_ZALO_OA_ID', () => {
      vi.stubEnv('NEXT_PUBLIC_ZALO_OA_ID', '987');
      expect(createWebPlatformBridge().oa.available).toBe(true);
    });
  });

  describe('storage', () => {
    it('đọc và ghi localStorage', async () => {
      const store = new Map<string, string>();
      stubBrowser({
        localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
      });
      const b = createWebPlatformBridge({ oaId: '' });
      expect(await b.storage.get('k')).toBeNull();
      await b.storage.set('k', 'v');
      expect(await b.storage.get('k')).toBe('v');
    });

    it('localStorage ném lỗi (chế độ riêng tư, bị chặn): get=null, set không ném', async () => {
      const boom = () => {
        throw new Error('SecurityError');
      };
      stubBrowser({ localStorage: { getItem: boom, setItem: boom } });
      const b = createWebPlatformBridge({ oaId: '' });
      expect(await b.storage.get('k')).toBeNull();
      await expect(b.storage.set('k', 'v')).resolves.toBeUndefined();
    });

    it('không có localStorage (server): get=null, set không ném', async () => {
      delete g.localStorage;
      const b = createWebPlatformBridge({ oaId: '' });
      expect(await b.storage.get('k')).toBeNull();
      await expect(b.storage.set('k', 'v')).resolves.toBeUndefined();
    });
  });
});
