function ipToLong(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255 || p.trim() === '') return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/** Chuẩn hoá IPv4-mapped IPv6 (::ffff:1.2.3.4) → 1.2.3.4. */
function normalizeIp(ip: string): string {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1]! : ip;
}

/** Khớp ip với 1 mục: exact IPv4 hoặc CIDR 'a.b.c.d/nn'. */
export function ipMatchOne(ip: string, entry: string): boolean {
  const target = ipToLong(normalizeIp(ip));
  if (target === null) return false;
  if (entry.includes('/')) {
    const [net, bitsStr] = entry.split('/');
    const bits = Number(bitsStr);
    const netLong = ipToLong(net ?? '');
    if (netLong === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (target & mask) === (netLong & mask);
  }
  return target === ipToLong(entry.trim());
}

/** ip có nằm trong danh sách IP/CIDR không. */
export function ipMatch(ip: string, list: string[]): boolean {
  return list.some((e) => ipMatchOne(ip, e));
}
