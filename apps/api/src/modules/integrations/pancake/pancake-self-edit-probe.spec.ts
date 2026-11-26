import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AxiosAdapter, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { PancakeClient } from './pancake.client';
import {
  assertGetOnly,
  formatProbeReport,
  nearMissKeys,
  parseProbeCode,
  probeExitCode,
  probeOrderWhere,
  READ_ONLY_PROBE,
  selfEditProbe,
} from './pancake-self-edit-probe';
import type { PancakeOrderDTO } from './pancake.types';

/** Đơn Tubu chưa sửa, địa chỉ hệ mới 2 cấp (dữ liệu giả). */
const ORDER = {
  shippingAddress: {
    recipient: 'Nguyễn Văn Bình',
    phone: '0912345678',
    street: '12 Lê Lợi',
    ward: 'Phường Bến Thành',
    district: '',
    province: 'TP Hồ Chí Minh',
    provinceCode: '84_VN79',
    districtCode: '',
    wardCode: '84_VN7926743',
  },
};

/** Đơn Pancake khớp hoàn toàn đơn Tubu. */
function dto(over: Partial<PancakeOrderDTO> = {}, address: Record<string, unknown> = {}): PancakeOrderDTO {
  return {
    id: 9876,
    status: 0,
    cod: 230000,
    transfer_money: 0,
    shipping_fee: '30000',
    shipping_address: {
      full_name: 'Nguyễn Văn Bình',
      phone_number: '0912345678',
      address: '12 Lê Lợi',
      full_address: '12 Lê Lợi, Phường Bến Thành, TP Hồ Chí Minh',
      commune_id: '84_VN7926743',
      province_id: '84_VN79',
      ...address,
    },
    ...over,
  };
}

const failsOf = (lines: ReturnType<typeof selfEditProbe>) => lines.filter((l) => l.level === 'FAIL').map((l) => l.check);

describe('selfEditProbe (dò chỉ GET trước khi bật khách tự sửa đơn)', () => {
  it('khớp hoàn toàn: 0 FAIL, 0 WARN, thoát 0', () => {
    const lines = selfEditProbe(ORDER, dto());
    expect(lines.filter((l) => l.level !== 'PASS')).toEqual([]);
    expect(probeExitCode(lines)).toBe(0);
    expect(lines.map((l) => l.check)).toEqual([
      'shipping_address.phone_number',
      'shipping_address.commune_id',
      'shipping_address.province_id',
      'shipping_address.district_id',
      'shipping_address.full_address|address',
      'cod',
      'transfer_money',
      'shipping_fee',
      'customerEditMismatch',
      'status',
      'nearMissKeys',
    ]);
  });

  it('commune_id dạng số (26743): FAIL ở commune_id và customerEditMismatch, thoát 1', () => {
    const lines = selfEditProbe(ORDER, dto({}, { commune_id: 26743 }));
    expect(failsOf(lines)).toEqual(['shipping_address.commune_id', 'customerEditMismatch']);
    expect(lines.find((l) => l.check === 'shipping_address.commune_id')!.detail).toContain('number');
    expect(probeExitCode(lines)).toBe(1);
  });

  it('commune_id khớp wardCode nhưng không phải mã 84_VN: FAIL', () => {
    const old = { shippingAddress: { ...ORDER.shippingAddress, wardCode: '26743' } };
    expect(failsOf(selfEditProbe(old, dto({}, { commune_id: '26743' })))).toEqual(['shipping_address.commune_id']);
  });

  it('thiếu cod: FAIL "chốt lệch tiền bị mù"; tiền dạng chuỗi số vẫn PASS', () => {
    const body = dto();
    delete body.cod;
    const lines = selfEditProbe(ORDER, body);
    expect(failsOf(lines)).toEqual(['cod']);
    expect(lines.find((l) => l.check === 'cod')!.detail).toContain('chốt lệch tiền bị mù');
    expect(lines.find((l) => l.check === 'shipping_fee')).toMatchObject({ level: 'PASS', detail: 'chuỗi số' });
    expect(failsOf(selfEditProbe(ORDER, dto({ transfer_money: 'abc', shipping_fee: null })))).toEqual(['transfer_money', 'shipping_fee']);
  });

  it('không có đơn hay không có shipping_address / phone / địa chỉ chữ / province khác: FAIL đúng dòng', () => {
    expect(failsOf(selfEditProbe(ORDER, null))).toEqual(['order']);
    expect(failsOf(selfEditProbe(ORDER, dto({ shipping_address: null })))).toEqual(['shipping_address', 'customerEditMismatch']);
    expect(failsOf(selfEditProbe(ORDER, dto({}, { phone_number: '' })))).toEqual(['shipping_address.phone_number', 'customerEditMismatch']);
    expect(failsOf(selfEditProbe(ORDER, dto({}, { full_address: null, address: '  ' })))).toEqual(['shipping_address.full_address|address', 'customerEditMismatch']);
    expect(failsOf(selfEditProbe(ORDER, dto({}, { province_id: 79 })))).toEqual(['shipping_address.province_id']);
  });

  it('status vắng / null / không phải mã số: FAIL (job coi mọi lần sửa là đã đóng gói); mã số chuỗi trước đóng gói: PASS', () => {
    const body = dto();
    delete body.status;
    expect(failsOf(selfEditProbe(ORDER, body))).toEqual(['status']);
    expect(failsOf(selfEditProbe(ORDER, dto({ status: null as unknown as number })))).toEqual(['status']);
    expect(failsOf(selfEditProbe(ORDER, dto({ status: 'new' })))).toEqual(['status']);
    expect(selfEditProbe(ORDER, dto({ status: '17' })).find((l) => l.check === 'status')!.level).toBe('PASS');
  });

  it('SĐT hay địa chỉ chữ dạng số (hàm đối chiếu của job ném): FAIL customerEditMismatch, không ném ra ngoài', () => {
    const lines = selfEditProbe(ORDER, dto({}, { phone_number: 912345678 }));
    expect(failsOf(lines)).toEqual(['shipping_address.phone_number', 'customerEditMismatch']);
    expect(lines.find((l) => l.check === 'customerEditMismatch')!.detail).toContain('TypeError');
    expect(failsOf(selfEditProbe(ORDER, dto({}, { full_address: 12, address: 12 })))).toEqual(['shipping_address.full_address|address', 'customerEditMismatch']);
  });

  it('district_id có giá trị với địa chỉ 84_VN: WARN (không FAIL); trạng thái đã đóng gói: WARN', () => {
    const lines = selfEditProbe(ORDER, dto({ status: 12 }, { district_id: '760' }));
    expect(failsOf(lines)).toEqual([]);
    expect(lines.filter((l) => l.level === 'WARN').map((l) => l.check)).toEqual(['shipping_address.district_id', 'status']);
  });

  it('nearMissKeys: chỉ tên khoá gần giống (không giá trị), bỏ khoá job đã đọc', () => {
    const body = { ...dto({}, { commune_name: 'Phường Bến Thành', ward_id: 'x' }), partner_fee: 15000, cod_amount: 230000, prepaid_money: 0, note: 'n' };
    expect(nearMissKeys(body)).toEqual(['cod_amount', 'partner_fee', 'prepaid_money', 'shipping_address.commune_name', 'shipping_address.ward_id']);
    const line = selfEditProbe(ORDER, body as PancakeOrderDTO).find((l) => l.check === 'nearMissKeys')!;
    expect(line.level).toBe('WARN');
    expect(line.detail).not.toMatch(/15000|230000|Bến Thành/);
  });

  it('báo cáo đã che: không SĐT đầy đủ, không tên, không địa chỉ chữ, không số tiền', () => {
    const body = dto({}, { commune_id: 26743 });
    const report = formatProbeReport({ code: 'TB1A2B', pancakeOrderId: '9876', orderStatus: 'CONFIRMED', shippingAddress: ORDER.shippingAddress }, body, selfEditProbe(ORDER, body));
    expect(report).toContain('TB1A2B');
    expect(report).toContain('…678');
    expect(report).toContain('NOT READY');
    for (const secret of ['0912345678', '912345678', 'Nguyễn', 'Bình', 'Lê Lợi', 'Bến Thành', '230000', '230.000', '30000', '84_VN7926743', '26743']) {
      expect(report).not.toContain(secret);
    }
    expect(formatProbeReport({ code: 'TB1A2B', pancakeOrderId: '9876', orderStatus: 'CONFIRMED', shippingAddress: ORDER.shippingAddress }, dto(), selfEditProbe(ORDER, dto()))).toContain(
      'READY: 0 FAIL, 0 WARN.',
    );
  });

  it('parseProbeCode và điều kiện chọn đơn', () => {
    expect(parseProbeCode(['--code', 'tb1a2b'])).toBe('TB1A2B');
    expect(parseProbeCode(['--code=TB9Z'])).toBe('TB9Z');
    expect(parseProbeCode([])).toBeNull();
    expect(() => parseProbeCode(['--code'])).toThrow('--code thiếu mã đơn');
    expect(() => parseProbeCode(['--code='])).toThrow('--code thiếu mã đơn');
    expect(() => parseProbeCode(['--code', '--x'])).toThrow('--code thiếu mã đơn');
    expect(probeOrderWhere('TB1A2B')).toEqual({ code: 'TB1A2B', pancakeOrderId: { not: null } });
    expect(probeOrderWhere(null)).toEqual({
      pancakeOrderId: { not: null },
      status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
      fulfiller: 'TUBU',
      shippingAddress: { path: ['provinceCode'], string_starts_with: '84_VN' },
    });
  });
});

describe('assertGetOnly + PancakeClient.getOrder (axios thật, adapter giả: không gọi mạng)', () => {
  function probeClient(body: unknown) {
    const values: Record<string, string> = { PANCAKE_API_KEY: 'secret-key', PANCAKE_SHOP_ID: 'shop', PANCAKE_BASE_URL: 'http://pancake.invalid' };
    const client = new PancakeClient({ get: (k: string) => values[k] } as unknown as ConfigService<never, true> as never);
    const http = (client as unknown as { http: AxiosInstance }).http;
    const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => ({ data: body, status: 200, statusText: 'OK', headers: {}, config }));
    http.defaults.adapter = adapter as unknown as AxiosAdapter;
    assertGetOnly(http);
    return { client, http, adapter };
  }

  it('phản hồi bọc {success, data}: getOrder đọc đúng, bản dò PASS; GET đi qua chặn', async () => {
    const { client, adapter } = probeClient({ success: true, data: dto() });
    const found = await client.getOrder('9876');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0]![0].method).toBe('get');
    expect(probeExitCode(selfEditProbe(ORDER, found))).toBe(0);
  });

  it('phản hồi không bọc: đọc đúng', async () => {
    const { client } = probeClient(dto());
    expect(probeExitCode(selfEditProbe(ORDER, await client.getOrder('9876')))).toBe(0);
  });

  it('PUT, POST, PATCH, DELETE bị chặn trước adapter (READ_ONLY_PROBE)', async () => {
    const { http, adapter } = probeClient({ success: true });
    await expect(http.put('/shops/shop/orders/9876', { note: 'x' })).rejects.toThrow(READ_ONLY_PROBE);
    await expect(http.post('/shops/shop/orders', {})).rejects.toThrow(READ_ONLY_PROBE);
    await expect(http.patch('/shops/shop/orders/9876', {})).rejects.toThrow(READ_ONLY_PROBE);
    await expect(http.delete('/shops/shop/orders/9876')).rejects.toThrow(READ_ONLY_PROBE);
    expect(adapter).not.toHaveBeenCalled();
    await expect(http.get('/shops/shop/orders/9876')).resolves.toMatchObject({ status: 200 });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('lệnh ghi của PancakeClient (update/cancel/create) cũng bị chặn', async () => {
    const { client, adapter } = probeClient({ success: true });
    const writes = Object.getOwnPropertyNames(PancakeClient.prototype).filter((m) => /^(update|cancel|create)/i.test(m));
    expect(writes.length).toBeGreaterThan(0);
    for (const m of writes) {
      await expect((client as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[m]!('9876', {})).rejects.toThrow(READ_ONLY_PROBE);
    }
    expect(adapter).not.toHaveBeenCalled();
  });
});

describe('scripts/pancake-self-edit-probe.ts chỉ đọc (ghim nguồn: script nằm ngoài tsconfig và jest)', () => {
  const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'scripts', 'pancake-self-edit-probe.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('gọi getOrder đúng 1 lần, gắn assertGetOnly, chỉ đọc DB bằng findFirst', () => {
    expect(code.match(/\.getOrder\(/g)).toHaveLength(1);
    expect(code).toMatch(/assertGetOnly\(/);
    expect(code.match(/prisma\.\w+\.\w+\(/g)).toEqual(['prisma.order.findFirst(']);
    expect(code).not.toMatch(/\$executeRaw|\$queryRaw|\$transaction|\.(create|update|upsert|delete)\w*\(/);
  });

  it('không import PancakeOrderService, hàng đợi hay Redis; không in khoá API', () => {
    expect(code).not.toMatch(/PancakeOrderService|bullmq|ioredis|redis/i);
    expect(code).not.toMatch(/console\.\w+\([^;]*(process\.env\.PANCAKE_API_KEY|process\.env\[|\.apiKey)/);
  });
});
