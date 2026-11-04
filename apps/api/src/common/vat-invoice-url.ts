import { isIP } from 'node:net';
import { UPLOAD_IMAGE_HOSTS } from './uploaded-image';

/** Nhà cung cấp hoá đơn điện tử phổ biến ở VN + Drive + kho lưu trữ của hệ thống. `*.x` khớp cả `x` lẫn mọi tên miền con. */
export const DEFAULT_VAT_INVOICE_HOSTS: readonly string[] = [
  '*.vnpt-invoice.com.vn',
  '*.meinvoice.vn',
  '*.sinvoice.viettel.vn',
  '*.viettel.vn',
  '*.easyinvoice.com.vn',
  '*.ehoadon.vn',
  '*.bkav.com.vn',
  '*.fpt.com.vn',
  '*.minvoice.com.vn',
  'drive.google.com',
  ...UPLOAD_IMAGE_HOSTS,
];

/** Người đặt env hay dán cả link (`https://user@a.vn:443/`) hoặc tên có dấu chấm cuối: chỉ giữ phần tên miền để mục đó vẫn khớp. */
function normalizeHostEntry(entry: string): string {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^[^@]*@/, '')
    .replace(/:\d*$/, '')
    .replace(/\.$/, '');
}

/** Env có giá trị thì THAY hẳn danh sách mặc định (quản trị viên chủ động chọn đúng nhà cung cấp mình dùng). Tách theo dấu phẩy, chấm phẩy hoặc khoảng trắng. */
export function vatInvoiceHosts(env: string | undefined = process.env.ALLOWED_VAT_INVOICE_HOSTS): string[] {
  const custom = (env ?? '').split(/[,;\s]+/).map(normalizeHostEntry).filter(Boolean);
  return custom.length > 0 ? custom : [...DEFAULT_VAT_INVOICE_HOSTS];
}

/** `*.x` khớp `x` và tên miền con thật của `x` (khớp theo dấu chấm, nên `evilx` không lọt); mục không có `*` khớp đúng tên. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return base.length > 0 && (h === base || h.endsWith(`.${base}`));
  }
  return h === p;
}

function privateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Chặn tên nội bộ và địa chỉ IP riêng/loopback/link-local (chống SSRF vào mạng trong qua link hoá đơn). */
export function isPrivateOrInternalHost(rawHost: string): boolean {
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.$/, '');
  if (!host) return true;
  const v = isIP(host);
  if (v === 4) return privateIPv4(host);
  if (v === 6) {
    if (host === '::' || host === '::1') return true;
    // URL chuẩn hoá `::ffff:127.0.0.1` thành `::ffff:7f00:1`: xử lý cả hai dạng để không lọt IPv4 riêng.
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (dotted) return privateIPv4(dotted[1]!);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return privateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local');
}

const MAX_URL_LENGTH = 500;

type Parsed = { url: URL; host: string } | { error: string };

function parseHttps(raw: unknown): Parsed {
  const bad = { error: 'Link hoá đơn phải là địa chỉ https hợp lệ, không kèm tài khoản/mật khẩu và chỉ dùng cổng mặc định (443).' };
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return bad;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return bad;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port !== '' && url.port !== '443')) return bad;
  return { url, host: url.hostname.toLowerCase().replace(/\.$/, '') };
}

/**
 * Câu lỗi tiếng Việt, hoặc null nếu link hợp lệ. Dùng cho cả link Kế toán nhập lẫn link Pancake gửi.
 * Thứ tự: dạng link → địa chỉ nội bộ → địa chỉ IP (hoá đơn thật luôn có tên miền; chặn luôn các dạng IPv6 nhúng IPv4) → ngoài danh sách.
 */
export function vatInvoiceUrlError(raw: string, hosts: readonly string[] = vatInvoiceHosts()): string | null {
  const parsed = parseHttps(raw);
  if ('error' in parsed) return parsed.error;
  const { host } = parsed;
  if (isPrivateOrInternalHost(host)) return 'Link hoá đơn không được trỏ tới địa chỉ nội bộ.';
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) return 'Link hoá đơn phải dùng tên miền của nhà cung cấp hoá đơn, không dùng địa chỉ IP.';
  if (!hosts.some((p) => hostMatches(host, p))) {
    return `Tên miền ${host} chưa được phép làm link hoá đơn. Nếu đây là nhà cung cấp hoá đơn thật, nhờ quản trị viên thêm vào ALLOWED_VAT_INVOICE_HOSTS.`;
  }
  return null;
}
