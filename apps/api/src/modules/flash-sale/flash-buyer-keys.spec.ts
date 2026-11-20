import { createHash } from 'node:crypto';
import { hmacPhone } from '../../common/crypto/phone-hmac';
import {
  buyerFlashLimitKeys,
  flashIpHash,
  flashKeyLimit,
  flashLimitKeys,
  isLegacyFlashKey,
  writableFlashKeys,
  FLASH_IP_LIMIT_FACTOR,
  FLASH_LEGACY_PHONE_KEY_PREFIX,
  FLASH_LIMIT_KEY_PREFIX,
  FLASH_PHONE_KEY_PREFIX,
} from './flash-buyer-keys';

/** Khoá SĐT trước tubu-w11-01: sha256 trần, vét cạn được. Chỉ còn để đếm dòng đã ghi trước khi deploy. */
const legacyKey = (phone: string) => `fsk:p:${createHash('sha256').update(`flash-phone:${phone}`).digest('hex')}`;

const GUEST = { phone: null, zaloId: 'guest_dev1' };
const REAL = { phone: '0912345678', zaloId: 'guest_dev1' };
const ZALO = { phone: null, zaloId: '8812345' };

describe('flashLimitKeys', () => {
  it('SĐT mọi cách ghi (0…, +84…, 84…, có khoảng trắng) ra cùng một khoá HMAC (hmacPhone), không chứa số thô, không phải sha256 trần', () => {
    const forms = ['0912345678', '+84912345678', '84912345678', '0912 345 678', '091.234.5678'];
    const keys = forms.map((phone) => flashLimitKeys({ phone }));
    expect(new Set(keys.map((k) => k.join('|'))).size).toBe(1);
    expect(keys[0]).toEqual([`${FLASH_PHONE_KEY_PREFIX}${hmacPhone('0912345678')}`]);
    expect(keys[0]![0]).toMatch(/^fsk:h:[0-9a-f]{64}$/);
    expect(keys[0]![0]).not.toContain('912345678');
    expect(keys[0]).not.toContain(legacyKey('0912345678'));
  });

  it('IP băm thêm một khoá; khoá đã sắp xếp; SĐT khác thì khoá khác', () => {
    const k = flashLimitKeys({ phone: '0912345678', ipHash: 'abc123' });
    expect(k).toEqual([...k].sort());
    expect(k).toContain(`${FLASH_LIMIT_KEY_PREFIX}i:abc123`);
    expect(k).toHaveLength(2);
    expect(flashLimitKeys({ phone: '0987654321' })).not.toEqual(flashLimitKeys({ phone: '0912345678' }));
  });

  it('không có gì để đếm → rỗng', () => {
    expect(flashLimitKeys(null)).toEqual([]);
    expect(flashLimitKeys({ phone: '', ipHash: '  ' })).toEqual([]);
  });

  it('khoá không bao giờ trùng một id người dùng (cuid chỉ có chữ và số)', () => {
    for (const k of flashLimitKeys({ phone: '0912345678', ipHash: 'x' })) expect(k).toMatch(/:/);
  });
});

describe('buyerFlashLimitKeys', () => {
  it('khách thật (có SĐT hay Zalo thật) không có khoá phụ: hành vi Giờ vàng như cũ', () => {
    expect(buyerFlashLimitKeys(REAL, { phone: '0912345678', ipHash: 'x' })).toEqual([]);
    expect(buyerFlashLimitKeys(ZALO, { phone: '0912345678' })).toEqual([]);
  });

  it('tài khoản guest_ (Mini) và dòng khách web: đếm theo SĐT nhận hàng (và IP web), kèm bí danh khoá cũ để đếm lượt mua trước khi đổi sang HMAC', () => {
    const keys = buyerFlashLimitKeys(GUEST, { phone: '0912345678' });
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(expect.arrayContaining([...flashLimitKeys({ phone: '0912345678' }), legacyKey('0912345678')]));
    expect(keys).toHaveLength(2);
    expect(buyerFlashLimitKeys(GUEST, { phone: '0912345678', ipHash: 'h' })).toHaveLength(3);
    expect(buyerFlashLimitKeys(null, { phone: '0912345678' })).toHaveLength(2);
    expect(buyerFlashLimitKeys(GUEST, { ipHash: 'h' })).toEqual(flashLimitKeys({ ipHash: 'h' }));
  });

  it('khoá cũ chỉ để đọc: writableFlashKeys bỏ nó, phần còn lại đúng bằng flashLimitKeys (khoá ghi lên đơn)', () => {
    const identity = { phone: '+84 912 345 678', ipHash: 'h' };
    const keys = buyerFlashLimitKeys(GUEST, identity);
    expect(keys.filter(isLegacyFlashKey)).toEqual([legacyKey('0912345678')]);
    expect(writableFlashKeys(keys)).toEqual(flashLimitKeys(identity));
    expect(isLegacyFlashKey(`${FLASH_LEGACY_PHONE_KEY_PREFIX}abc`)).toBe(true);
    expect(isLegacyFlashKey(`${FLASH_PHONE_KEY_PREFIX}abc`)).toBe(false);
    expect(isLegacyFlashKey(`${FLASH_LIMIT_KEY_PREFIX}i:abc`)).toBe(false);
  });
});

describe('trần từng khoá và mã băm IP', () => {
  it('khoá SĐT trần bằng perUserLimit; khoá IP gấp FLASH_IP_LIMIT_FACTOR lần (IP dùng chung của mạng di động, Wi-Fi)', () => {
    const [ipKey, phoneKey] = flashLimitKeys({ phone: '0912345678', ipHash: 'h' }).sort((a) => (a.startsWith('fsk:i:') ? -1 : 1));
    expect(phoneKey).toMatch(/^fsk:h:/);
    expect(FLASH_IP_LIMIT_FACTOR).toBe(3);
    expect(flashKeyLimit(phoneKey!, 2)).toBe(2);
    expect(flashKeyLimit(ipKey!, 2)).toBe(6);
  });

  it('cùng IP ra cùng mã băm với cùng bí mật; không có IP thì null; mã băm không chứa IP thô', () => {
    expect(flashIpHash('1.2.3.4', 's')).toBe(flashIpHash('1.2.3.4', 's'));
    expect(flashIpHash('1.2.3.4', 's')).not.toBe(flashIpHash('1.2.3.5', 's'));
    expect(flashIpHash('1.2.3.4', 's')).not.toContain('1.2.3.4');
    expect(flashIpHash('', 's')).toBeNull();
  });
});
