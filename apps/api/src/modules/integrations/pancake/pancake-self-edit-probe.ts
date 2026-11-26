import type { Order, Prisma } from '@prisma/client';
import type { AxiosInstance } from 'axios';
import { ORDER_EDITABLE_STATUSES, snapshotOf } from '../../orders/order-customer-edit';
import { isNewGeoCode } from './geo-code';
import { TUBU_FULFILLED_ORDER_WHERE } from './pancake-fulfilment';
import { customerEditMismatch, isPancakeBeforePacking, moneyOf } from './pancake-order.service';
import type { PancakeOrderDTO } from './pancake.types';

/**
 * Dò chỉ đọc trước khi bật `orders.customer_self_edit_enabled` (wave tubu-w41-01): một lần GET đơn Pancake có trả đúng tên và dạng trường mà job
 * khách tự sửa (`PancakeOrderService.syncCustomerEdit`) đọc không. Hàm thuần ở đây có test; `apps/api/scripts/pancake-self-edit-probe.ts` chỉ nối
 * DB và mạng. Báo cáo không in tên, địa chỉ chữ, SĐT đầy đủ, giá trị tiền hay khoá API.
 *
 * Giới hạn: chỉ chứng minh dạng dữ liệu của GET. Pancake có nhận `commune_id` trong PUT hay không vẫn cần lần sửa thử một đơn thật của PO.
 */

export type ProbeLevel = 'PASS' | 'WARN' | 'FAIL';
export interface ProbeLine {
  level: ProbeLevel;
  check: string;
  detail: string;
}

/** Mã lỗi ném khi có lệnh HTTP không phải GET đi qua client của bản dò. */
export const READ_ONLY_PROBE = 'READ_ONLY_PROBE';

/** Ba khoá tiền mà chốt lệch tiền (`customerEditMoneyDrift`) so trước/sau PUT. */
export const PROBE_MONEY_KEYS = ['cod', 'transfer_money', 'shipping_fee'] as const;

/** Tên khoá gần giống khoá job đọc: in ra để thấy Pancake đổi tên khoá (chỉ in tên, không in giá trị). */
const NEAR_MISS_RE = /cod|transfer|ship|fee|money|commune|ward|province|district/i;
const READ_KEYS: ReadonlySet<string> = new Set([...PROBE_MONEY_KEYS, 'shipping_address']);
const READ_ADDRESS_KEYS: ReadonlySet<string> = new Set(['commune_id', 'province_id', 'district_id', 'full_address', 'address', 'phone_number', 'full_name']);

/**
 * Chặn ghi ở tầng HTTP: mọi request không phải GET bị từ chối trước khi rời máy (ném `READ_ONLY_PROBE`). Gắn vào đúng axios instance của
 * PancakeClient mà bản dò dùng.
 */
export function assertGetOnly(http: AxiosInstance): AxiosInstance {
  http.interceptors.request.use((config) => {
    const method = (config.method ?? 'get').toLowerCase();
    if (method !== 'get') throw new Error(`${READ_ONLY_PROBE}: bản dò chỉ được GET, đã chặn ${method.toUpperCase()}`);
    return config;
  });
  return http;
}

/** Kiểu giá trị để in (không in giá trị). */
function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'vắng';
  if (Array.isArray(v)) return 'mảng';
  if (typeof v === 'string') return v.trim() === '' ? 'chuỗi rỗng' : Number.isFinite(Number(v)) ? 'chuỗi số' : 'chuỗi';
  return typeof v;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const filled = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** Tên khoá gần giống (cấp đơn và trong `shipping_address`) không nằm trong tập khoá job đọc. Chỉ tên, đã sắp xếp. */
export function nearMissKeys(dto: unknown): string[] {
  if (!isObject(dto)) return [];
  const out = Object.keys(dto).filter((k) => NEAR_MISS_RE.test(k) && !READ_KEYS.has(k));
  const sa = dto.shipping_address;
  if (isObject(sa)) out.push(...Object.keys(sa).filter((k) => NEAR_MISS_RE.test(k) && !READ_ADDRESS_KEYS.has(k)).map((k) => `shipping_address.${k}`));
  return out.sort();
}

/**
 * So một đơn Pancake đọc bằng GET với đơn Tubu chưa sửa (hai bên phải khớp). Mỗi dòng là một điều kiện job khách tự sửa dựa vào; FAIL nghĩa là
 * bật cờ thì job sẽ báo "Cần xử lý Pancake" cho mọi lần sửa, hoặc chốt lệch tiền không thấy gì.
 */
export function selfEditProbe(order: Pick<Order, 'shippingAddress'>, dto: PancakeOrderDTO | null): ProbeLine[] {
  if (!isObject(dto)) return [{ level: 'FAIL', check: 'order', detail: 'Pancake không trả đơn (không có hoặc không đọc được)' }];
  const lines: ProbeLine[] = [];
  const add = (level: ProbeLevel, check: string, detail: string) => lines.push({ level, check, detail });
  const want = snapshotOf(order.shippingAddress);
  const raw = dto as Record<string, unknown>;
  const sa = isObject(raw.shipping_address) ? raw.shipping_address : null;

  if (!sa) {
    add('FAIL', 'shipping_address', `không có object shipping_address (${kindOf(raw.shipping_address)})`);
  } else {
    add(filled(sa.phone_number) ? 'PASS' : 'FAIL', 'shipping_address.phone_number', kindOf(sa.phone_number));

    const commune = sa.commune_id;
    const communeText = commune === null || commune === undefined ? '' : String(commune);
    if (!want.wardCode) add('FAIL', 'shipping_address.commune_id', 'đơn Tubu không có wardCode để so');
    else if (communeText !== want.wardCode) add('FAIL', 'shipping_address.commune_id', `${kindOf(commune)}, khác wardCode của đơn Tubu`);
    else if (!isNewGeoCode(communeText)) add('FAIL', 'shipping_address.commune_id', `${kindOf(commune)}, khớp wardCode nhưng không phải mã hệ mới 84_VN`);
    else add('PASS', 'shipping_address.commune_id', `${kindOf(commune)} 84_VN, khớp wardCode`);

    const province = sa.province_id;
    const provinceText = province === null || province === undefined ? '' : String(province);
    if (!want.provinceCode || provinceText !== want.provinceCode) add('FAIL', 'shipping_address.province_id', `${kindOf(province)}, khác provinceCode của đơn Tubu`);
    else add('PASS', 'shipping_address.province_id', `${kindOf(province)}, khớp provinceCode`);

    const district = sa.district_id;
    const noDistrict = district === undefined || district === null || (typeof district === 'string' && district.trim() === '');
    if (isNewGeoCode(want.provinceCode) && !noDistrict) add('WARN', 'shipping_address.district_id', `${kindOf(district)} với địa chỉ 84_VN (hệ 2 cấp không có quận)`);
    else add('PASS', 'shipping_address.district_id', kindOf(district));

    const hasLine = filled(sa.full_address) || filled(sa.address);
    add(hasLine ? 'PASS' : 'FAIL', 'shipping_address.full_address|address', `full_address ${kindOf(sa.full_address)}, address ${kindOf(sa.address)}`);
  }

  for (const key of PROBE_MONEY_KEYS) {
    if (moneyOf(raw[key]) === null) add('FAIL', key, `${kindOf(raw[key])}: thiếu số, chốt lệch tiền bị mù`);
    else add('PASS', key, kindOf(raw[key]));
  }

  // Trường sai kiểu (SĐT hay địa chỉ chữ là số) làm hàm của job ném: báo FAIL đúng dòng, không để bản dò chết không báo cáo.
  try {
    const mismatch = customerEditMismatch(dto, order);
    add(mismatch ? 'FAIL' : 'PASS', 'customerEditMismatch', mismatch ?? 'khớp (đơn chưa sửa)');
  } catch (err) {
    add('FAIL', 'customerEditMismatch', `job sẽ ném lỗi khi đối chiếu (${err instanceof Error ? err.name : 'lỗi'}): trường địa chỉ sai kiểu`);
  }

  // Job coi trạng thái vắng hoặc không phải mã số là "đã vào đóng gói" và gắn cờ mọi lần sửa: FAIL. Mã đọc được mà đã qua đóng gói chỉ nói
  // đơn được dò đã đi xa (chỉ để thông tin).
  const statusText = raw.status === null || raw.status === undefined ? '' : String(raw.status).trim();
  if (!/^\d+$/.test(statusText)) add('FAIL', 'status', `${kindOf(raw.status)}: không phải mã số, job sẽ coi mọi lần sửa là đã đóng gói`);
  else if (isPancakeBeforePacking(raw.status)) add('PASS', 'status', `${kindOf(raw.status)}, trước đóng gói`);
  else add('WARN', 'status', `${kindOf(raw.status)}, đã qua đóng gói (chỉ để thông tin)`);

  const near = nearMissKeys(dto);
  add(near.length ? 'WARN' : 'PASS', 'nearMissKeys', near.length ? near.join(', ') : 'không có');
  return lines;
}

/** SĐT chỉ giữ 3 số cuối. */
export function redactPhone(phone: unknown): string {
  const digits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  return digits.length >= 3 ? `…${digits.slice(-3)}` : '(không có)';
}

/** Thoát mã 1 khi có dòng FAIL. */
export const probeExitCode = (lines: readonly ProbeLine[]): 0 | 1 => (lines.some((l) => l.level === 'FAIL') ? 1 : 0);

/** Bản in đã che: mã đơn, id Pancake, 3 số cuối SĐT hai bên, rồi từng dòng. Không có tên, địa chỉ chữ hay giá trị tiền. */
export function formatProbeReport(
  meta: { code: string; pancakeOrderId: string; orderStatus: string; shippingAddress: Prisma.JsonValue },
  dto: PancakeOrderDTO | null,
  lines: readonly ProbeLine[],
): string {
  const want = snapshotOf(meta.shippingAddress);
  const pancakePhone = isObject(dto) && isObject(dto.shipping_address) ? dto.shipping_address.phone_number : null;
  const out = [
    `Dò Pancake chỉ GET cho khách tự sửa đơn: đơn ${meta.code} (${meta.orderStatus}), Pancake #${meta.pancakeOrderId}`,
    `SĐT nhận Tubu ${redactPhone(want.phone)}, Pancake ${redactPhone(pancakePhone)}`,
    '',
    ...lines.map((l) => `${l.level.padEnd(4)}  ${l.check}: ${l.detail}`),
    '',
  ];
  const fails = lines.filter((l) => l.level === 'FAIL').length;
  const warns = lines.filter((l) => l.level === 'WARN').length;
  out.push(fails ? `NOT READY: ${fails} FAIL, ${warns} WARN. Không bật cờ tự sửa đơn.` : `READY: 0 FAIL, ${warns} WARN.`);
  return out.join('\n');
}

/** Đối số `--code TB…` (mã đơn Tubu). Không có thì bản dò tự chọn đơn mới nhất hợp lệ. Có cờ mà thiếu mã thì ném (không tự dò đơn khác). */
export function parseProbeCode(args: readonly string[]): string | null {
  const i = args.indexOf('--code');
  const eq = args.find((a) => a.startsWith('--code='));
  if (i < 0 && eq === undefined) return null;
  const v = (i >= 0 ? args[i + 1] : eq!.slice('--code='.length)) ?? '';
  if (!v.trim() || v.startsWith('--')) throw new Error('--code thiếu mã đơn (vd --code TB1A2B)');
  return v.trim().toUpperCase();
}

/**
 * Đơn để dò. Có `--code`: đúng mã đó, chỉ cần đã có `pancakeOrderId` (các dòng FAIL sẽ nói đơn không hợp). Không có: đơn mới nhất đã có
 * `pancakeOrderId`, địa chỉ hệ mới `84_VN`, trạng thái còn sửa được (`ORDER_EDITABLE_STATUSES`), kho Tubu giao (không phải gian hàng tự giao).
 */
export function probeOrderWhere(code: string | null): Prisma.OrderWhereInput {
  if (code) return { code, pancakeOrderId: { not: null } };
  return {
    pancakeOrderId: { not: null },
    status: { in: [...ORDER_EDITABLE_STATUSES] },
    ...TUBU_FULFILLED_ORDER_WHERE,
    shippingAddress: { path: ['provinceCode'], string_starts_with: '84_VN' },
  };
}
