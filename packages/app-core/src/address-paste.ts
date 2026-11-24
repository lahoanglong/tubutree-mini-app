import { ADDRESS_RECIPIENT_MAX, ADDRESS_STREET_MAX } from './commerce/checkout-form';
import { parseVnPhoneInput, stripInvisible } from './phone-input';

/**
 * Tách một khối địa chỉ khách dán (thường chép từ tin nhắn Zalo) thành tên người nhận, SĐT, số nhà/đường và tỉnh/phường của hệ
 * địa giới 2 cấp, rồi điền vào form địa chỉ. Chữ thuần, dùng chung Mini App và web.
 *
 * Nhận chữ có dấu hoặc không dấu, SĐT `+84`/có dấu cách, viết tắt `TP.`, `P.`, `Q.`, `HCM`, `HN`. Cấp Quận/Huyện (bỏ từ 07/2025) và
 * chữ đứng sau phường mà không phải tên tỉnh bị bỏ qua. Tỉnh và phường chỉ nhận khi khớp đúng MỘT mục của danh mục Pancake: đoán
 * sai phường thì đơn giao sai chỗ, nên thà để trống cho khách chọn.
 */

export interface GeoOption {
  code: string;
  name: string;
}

/** `p` phường, `x` xã, `d` đặc khu, rỗng khi không rõ (thị trấn đã đổi thành xã/phường). */
export type PastedWardKind = '' | 'p' | 'x' | 'd';

export interface PastedWard {
  kind: PastedWardKind;
  name: string;
}

export interface AddressPaste {
  recipient: string;
  /** `0xxxxxxxxx`, rỗng khi không có số hợp lệ. */
  phone: string;
  street: string;
  province: GeoOption | null;
  /**
   * Phường/xã viết kèm tiền tố (Phường, P., Xã…); so với danh sách phường của tỉnh bằng `matchPastedWard`. Null khi khối dán còn ghi
   * cấp Quận/Huyện: đó là địa chỉ trước 07/2025, tên phường cũ có thể trùng tên một phường mới ở chỗ khác.
   */
  ward: PastedWard | null;
}

export type PasteTextField = 'recipient' | 'phone' | 'street';

const fold = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const hasMarks = (s: string): boolean => /đ/i.test(s) || s.normalize('NFD') !== s.normalize('NFC');

const PROVINCE_HEAD = /^(?:thanh pho|tinh|tp) /;
const HCM = 'ho chi minh';
const HN = 'ha noi';
const ALIAS = new Map<string, string>([
  ['hcm', HCM],
  ['tphcm', HCM],
  ['hcmc', HCM],
  ['sg', HCM],
  ['saigon', HCM],
  ['sai gon', HCM],
  ['ho chi minh city', HCM],
  ['hn', HN],
  ['tphn', HN],
  ['hanoi', HN],
  ['thua thien hue', 'hue'],
]);
const ALIAS_TARGET = new Set(ALIAS.values());

const provinceKey = (s: string): string => {
  const f = fold(s).replace(PROVINCE_HEAD, '');
  return ALIAS.get(f) ?? f;
};

/** Khớp đúng một tỉnh; `null` khi chữ có dáng tên tỉnh ("Tỉnh …", "TP …", tên viết tắt) mà không khớp; `undefined` khi không phải tên tỉnh. */
function provinceOf(text: string, provinces: readonly GeoOption[]): GeoOption | null | undefined {
  const f = fold(text);
  // "Tỉnh lộ 10", "Quốc lộ 1A" là tên đường.
  if (!f || /^(?:tinh|quoc) lo\b/.test(f)) return undefined;
  const key = provinceKey(text);
  const hits = provinces.filter((p) => provinceKey(p.name) === key);
  if (hits.length === 1) return hits[0];
  return PROVINCE_HEAD.test(f) || ALIAS_TARGET.has(key) || hits.length > 1 ? null : undefined;
}

const WARD_HEADS: ReadonlyArray<readonly [string, PastedWardKind]> = [
  ['phường', 'p'],
  ['xã', 'x'],
  ['đặc khu', 'd'],
  ['thị trấn', ''],
  ['p', 'p'],
  ['x', 'x'],
  ['tt', ''],
];
const DISTRICT_HEADS = ['quận', 'huyện', 'thị xã', 'thành phố', 'q', 'tx', 'tp', 'h'];
// Giữa một đoạn (không đứng sau dấu phẩy) chỉ nhận tiền tố viết tắt: "Bà Huyện Thanh Quan", "Xã Đàn" là tên đường.
const ABBR = new Set(['p', 'x', 'tt', 'q', 'tx', 'tp', 'h']);
const STREET_HEADS = new Set(['số', 'đường', 'hẻm', 'ngõ', 'ngách', 'kiệt', 'tổ', 'ấp', 'thôn', 'xóm', 'khu', 'chung', 'tòa', 'toà', 'lô', 'lầu', 'tầng', 'phòng', 'căn', 'block', 'kp']);
const STREET_HEADS_PLAIN = new Set(['hem', 'ngach', 'kiet', 'thon', 'xom', 'khu', 'chung', 'lau', 'tang', 'block', 'kp']);
// Chữ đệm cuối tin nhắn ("…0912345678 nha").
const FILLER = new Set(['nha', 'nhe', 'nhen', 'a', 'nha a', 'nhe a', 'ok', 'oke', 'cam on', 'thanks']);
const SHIP_TO = /^(?:ship|gửi|gui|giao)(?: hàng| hang)? (?:cho|tới|toi|đến|den) /iu;

const low = (tok: string): string => tok.toLowerCase().replace(/[.:]+$/, '');

// Chữ có dấu chỉ khớp đúng dấu ("Huyền" không phải "Huyện"); chữ không dấu khớp bản bỏ dấu, kể cả khi khối dán lẫn chữ có dấu.
const isWord = (tok: string | undefined, w: string): boolean =>
  tok !== undefined && (low(tok) === w || (!hasMarks(tok) && fold(tok) === fold(w)));

function headLen(t: readonly string[], head: string): number {
  const ws = head.split(' ');
  return ws.every((w, j) => isWord(t[j], w)) ? ws.length : 0;
}

function wardFrom(t: readonly string[], inside = false): PastedWard | null {
  const glued = /^p(\d+)$/.exec(low(t[0] ?? ''));
  if (glued) return t.length === 1 ? { kind: 'p', name: glued[1]! } : null;
  // "Xa lộ Hà Nội" là tên đường, không phải xã.
  if (fold(t.slice(0, 2).join(' ')) === 'xa lo') return null;
  for (const [head, kind] of WARD_HEADS) {
    if (inside && !ABBR.has(head)) continue;
    const n = headLen(t, head);
    if (n && t.length > n) return { kind, name: t.slice(n).join(' ') };
  }
  return null;
}

function isDistrict(t: readonly string[], inside = false): boolean {
  if (/^q\d+$/.test(low(t[0] ?? ''))) return t.length === 1;
  return DISTRICT_HEADS.some((head) => {
    if (inside && !ABBR.has(head)) return false;
    const n = headLen(t, head);
    // "H. Củ Chi" là huyện; "H 12/3" là hẻm.
    return n > 0 && t.length > n && (head !== 'h' || /^\p{L}/u.test(t[n]!));
  });
}

const isStreetHead = (tok: string): boolean => STREET_HEADS.has(low(tok)) || (!hasMarks(tok) && STREET_HEADS_PLAIN.has(fold(tok)));

const tokens = (s: string): string[] =>
  s
    // "P.Bến Thành", "TP.HCM", "Q.1": tách tiền tố viết tắt khỏi chữ dính sau dấu chấm.
    .replace(/(?<![\p{L}\p{N}])(\p{L}{1,2})\.(?=[\p{L}\p{N}])/gu, '$1. ')
    .split(/\s+/)
    .filter(Boolean);

type Label = 'name' | 'tel' | 'addr' | 'note';
const LABELS = new Map<string, Label>([
  ['ten', 'name'],
  ['ho ten', 'name'],
  ['ho va ten', 'name'],
  ['nguoi nhan', 'name'],
  ['ten nguoi nhan', 'name'],
  ['nguoi nhan hang', 'name'],
  ['khach hang', 'name'],
  ['sdt', 'tel'],
  ['so dt', 'tel'],
  ['so dien thoai', 'tel'],
  ['dien thoai', 'tel'],
  ['dt', 'tel'],
  ['phone', 'tel'],
  ['tel', 'tel'],
  ['zalo', 'tel'],
  ['dia chi', 'addr'],
  ['d c', 'addr'],
  ['dc', 'addr'],
  ['dia chi nhan hang', 'addr'],
  ['dia chi giao hang', 'addr'],
  ['dia chi nhan', 'addr'],
  ['address', 'addr'],
  ['ghi chu', 'note'],
  ['luu y', 'note'],
  ['note', 'note'],
]);

interface Seg {
  text: string;
  label: Label | '';
  alone: boolean;
}

// Số di động: 0 hoặc (+)84/0084 rồi 9 số, nhóm số cách nhau bằng dấu cách/chấm/gạch.
const PHONE_RE = /(?<![\d+])(?:\(?(?:\+|00)?84\)?|0)(?:[\s.-]?\d){9}(?!\d)/g;
const SPLIT_RE = /\s*[,;|]\s*|\s+[-–—]\s+/;
const COUNTRY = new Set(['viet nam', 'vietnam', 'vn']);
const NAME_RE = /^\p{L}[\p{L} .'’-]*$/u;

function pushSegments(chunk: string, out: Seg[]): void {
  for (const line of chunk.split('\n')) {
    const parts = line
      .replace(/[()[\]{}"“”]/g, ' ')
      .split(SPLIT_RE)
      .map((s) => s.replace(/\s+/g, ' ').replace(/^[\s–—-]+|[\s–—-]+$/g, ''))
      .filter((s) => /[\p{L}\p{N}]/u.test(s));
    let carry: Seg['label'] = '';
    const start = out.length;
    for (const part of parts) {
      const m = /^([^:：]{1,24})[:：]\s*(.*)$/.exec(part);
      const labelled = m ? LABELS.get(fold(m[1]!)) : undefined;
      // Nhãn đứng trơ ("SĐT", "Số:") khi SĐT đã bị cắt ra.
      if ((!m && LABELS.has(fold(part))) || (m && !m[2]!.trim())) continue;
      if (labelled) carry = labelled === 'addr' || labelled === 'note' ? labelled : '';
      const label = labelled ?? carry;
      const text = labelled ? m![2]!.trim() : part;
      if (text && label !== 'note' && !FILLER.has(fold(text))) out.push({ text, label, alone: false });
    }
    if (out.length === start + 1) out[start]!.alone = true;
  }
}

/**
 * Tách khối chữ dán. Trả `null` khi chữ không đủ dáng một địa chỉ (ít hơn 2 trong 5 phần tên/SĐT/đường/tỉnh/phường): khi đó ô nhập
 * dán chữ như thường. `provinces` là danh mục tỉnh đã tải; rỗng thì vẫn tách được tên/SĐT/đường và nhận được HCM/HN viết tắt.
 */
export function parseAddressPaste(raw: string, provinces: readonly GeoOption[]): AddressPaste | null {
  const text = stripInvisible(raw).normalize('NFC').replace(/\r/g, '');
  if (!text || text.length > 600) return null;

  let phone = '';
  const segs: Seg[] = [];
  let telAt = -1;
  let last = 0;
  for (const m of text.matchAll(PHONE_RE)) {
    const parsed = parseVnPhoneInput(m[0]);
    if (!parsed) continue;
    pushSegments(text.slice(last, m.index), segs);
    if (!phone) {
      phone = parsed;
      telAt = segs.length;
    }
    last = m.index + m[0].length;
  }
  pushSegments(text.slice(last), segs);

  const nameText = (i: number): string => segs[i]?.text.replace(SHIP_TO, '') ?? '';
  const isNameLike = (i: number, labelled: boolean): boolean => {
    const s = segs[i];
    const name = nameText(i);
    if (!s || s.label === 'addr' || !NAME_RE.test(name)) return false;
    const t = tokens(name);
    // "Phuong Anh" (không dấu) đứng đầu khối là tên, không phải phường.
    const maybeWard = wardFrom(t) && !(i === 0 && !hasMarks(t[0]!) && fold(t[0]!) === 'phuong');
    return (
      t.length >= (labelled ? 1 : 2) &&
      t.length <= 6 &&
      !isStreetHead(t[0]!) &&
      !maybeWard &&
      !isDistrict(t) &&
      provinceOf(name, provinces) === undefined
    );
  };
  // Tên: ô có nhãn "Tên:", rồi chữ kề trước SĐT, kề sau SĐT, hay dòng đầu đứng riêng.
  const nameAt = [
    segs.findIndex((s, i) => s.label === 'name' && isNameLike(i, true)),
    telAt > 0 && isNameLike(telAt - 1, false) ? telAt - 1 : -1,
    telAt >= 0 && isNameLike(telAt, false) ? telAt : -1,
    segs.length > 1 && segs[0]!.alone && isNameLike(0, false) ? 0 : -1,
  ].find((i) => i >= 0);
  const recipient = nameAt === undefined ? '' : nameText(nameAt);
  const addr = segs.filter((s, i) => i !== nameAt && s.label !== 'tel' && s.label !== 'name');

  // Đọc ngược từ cuối: tỉnh, quận (bỏ), phường, rồi số nhà/đường. Gặp phường (hay một đoạn có số đứng trước tỉnh/quận) thì mọi chữ
  // trước đó là đường.
  let province: GeoOption | null = null;
  let provinceSeen = false;
  let districtSeen = false;
  let ward: PastedWard | null = null;
  let streetSeen = false;
  let firstGeo = -1;
  const rest: string[][] = [];
  for (let i = addr.length - 1; i >= 0; i--) {
    let t = tokens(addr[i]!.text);
    const before = t.length;
    if (!ward && !streetSeen) {
      if (t.length > 1 && COUNTRY.has(fold(t.slice(-2).join(' ')))) t = t.slice(0, -2);
      else if (t.length && COUNTRY.has(fold(t[t.length - 1]!))) t = t.slice(0, -1);
      if (!provinceSeen && !districtSeen) {
        for (let k = Math.min(4, t.length); k >= 1; k--) {
          const tail = t.slice(-k).join(' ');
          const p = provinceOf(tail, provinces);
          // Chữ có dáng tên tỉnh mà không khớp danh mục chỉ bỏ khi đứng riêng một đoạn ("TP Thủ Đức"), không cắt giữa tên đường.
          if (p === undefined || (p === null && k < t.length)) continue;
          const prev = k < t.length ? t[t.length - k - 1]! : '';
          const f = fold(tail);
          // "123 Đồng Nai", "Xa lộ Hà Nội" là tên đường; "Q1 HCM", "Lê Lợi TP.HCM" thì là tỉnh.
          const explicit = PROVINCE_HEAD.test(f) || /^(?:tp)?(?:hcmc?|hn)$|^sg$/.test(f.replace(/ /g, ''));
          if (prev && !explicit && (/^\d/.test(prev) || /^(?:lo|duong|pho)$/.test(fold(prev)))) break;
          // "Phường Bình Dương", "Xã Đồng Nai": tên tỉnh đứng sau tiền tố phường/quận là tên phường/quận.
          if (prev && (wardFrom(t.slice(-k - 1)) || isDistrict(t.slice(-k - 1)))) break;
          province = p;
          provinceSeen = true;
          t = t.slice(0, -k);
          break;
        }
      }
      for (let j = t.length - 1; j >= 0; j--) {
        if (isDistrict(t.slice(j), j > 0)) {
          districtSeen = true;
          t = t.slice(0, j);
          break;
        }
      }
      for (let j = t.length - 1; j >= 0; j--) {
        const w = wardFrom(t.slice(j), j > 0);
        if (w) {
          ward = w;
          t = t.slice(0, j);
          break;
        }
      }
      if (t.length !== before) firstGeo = i;
      // Dòng ghi chú có số ở cuối khối ("Giao sau 17h") chưa chặn việc tìm tỉnh/phường ở các đoạn trước nó.
      else if ((provinceSeen || districtSeen) && /\d/.test(addr[i]!.text)) streetSeen = true;
    }
    rest[i] = t;
  }

  const streetParts = rest
    .slice(0, firstGeo < 0 ? rest.length : firstGeo + 1)
    .map((t) => t.join(' '))
    .filter(Boolean);
  // Không có số nhà, không có tỉnh/phường ("Gọi 0912…") thì không phải địa chỉ.
  const street = province || ward || streetParts.some((p) => /\d/.test(p)) ? streetParts.join(', ') : '';
  if (districtSeen) ward = null;
  const found = [recipient, phone, street, province, ward].filter(Boolean).length;
  return found >= 2 ? { recipient, phone, street, province, ward } : null;
}

function wardCore(name: string): { core: string; exact: string } {
  const f = fold(name);
  return { core: /^\d+$/.test(f) ? String(Number(f)) : f, exact: name.normalize('NFC').toLowerCase().trim() };
}

function wardKey(name: string): { kind: PastedWardKind; core: string; exact: string } {
  const t = tokens(name.normalize('NFC'));
  const w = wardFrom(t) ?? { kind: '' as const, name: t.join(' ') };
  return { kind: w.kind, ...wardCore(w.name) };
}

/** Phường/xã của tỉnh khớp đúng một mục với chữ đã dán (so không dấu; trùng nhiều mục thì lấy mục đúng cả dấu); không chắc thì null. */
export function matchPastedWard(communes: readonly GeoOption[], ward: PastedWard): GeoOption | null {
  const want = { kind: ward.kind, ...wardCore(ward.name) };
  if (!want.core) return null;
  const hits = communes.filter((c) => {
    const k = wardKey(c.name);
    return k.core === want.core && (!want.kind || !k.kind || k.kind === want.kind);
  });
  if (hits.length === 1) return hits[0]!;
  const exact = hits.filter((c) => wardKey(c.name).exact === want.exact);
  return exact.length === 1 ? exact[0]! : null;
}

const FIELD_MAX: Record<PasteTextField, number> = { recipient: ADDRESS_RECIPIENT_MAX, phone: 20, street: ADDRESS_STREET_MAX };

/**
 * Điền chữ đã tách vào ô tên/SĐT/đường. Chỉ đè ô còn trống hoặc ô `canReplace` cho phép (ô app tự điền sẵn mà khách chưa sửa, ô
 * đang nhận cú dán). Không đổi gì thì trả lại đúng object cũ.
 */
export function fillPastedText<T extends Record<PasteTextField, string>>(
  form: T,
  paste: AddressPaste,
  canReplace: (field: PasteTextField) => boolean,
): T {
  let next = form;
  for (const k of ['recipient', 'phone', 'street'] as const) {
    const v = paste[k].slice(0, FIELD_MAX[k]);
    if (v && v !== next[k] && (!next[k].trim() || canReplace(k))) next = { ...next, [k]: v };
  }
  return next;
}

export interface PasteGeo {
  province: string;
  provinceCode: string;
  ward: string;
  wardCode: string;
}

/** Ô khách đã tự gõ (tên/SĐT/đường) hoặc tự chọn (`geo`: tỉnh/phường). */
export type PasteSlot = PasteTextField | 'geo';

/** Form địa chỉ cắm vào `applyAddressPaste`: mỗi app tự đưa trạng thái, cách tải danh mục và cách báo. */
export interface AddressPasteHost<G extends PasteGeo> {
  /** Trạng thái mới nhất của form. */
  read: () => { form: Record<PasteTextField, string>; geo: G };
  /** Đọc trực tiếp, kể cả khi khách sửa trong lúc chờ tải danh sách phường. */
  edited: ReadonlySet<PasteSlot>;
  provinces: () => Promise<readonly GeoOption[]>;
  communes: (provinceCode: string) => Promise<readonly GeoOption[]>;
  setForm: (form: Record<PasteTextField, string>) => void;
  setGeo: (update: (g: G) => G) => void;
  /** Báo "Đã điền từ nội dung dán — kiểm lại Phường" (vùng aria-live). */
  announce: () => void;
}

/**
 * Ô nhận cú dán có tách khối không: ô trống, khách bôi hết ô, hoặc ô còn giá trị app điền sẵn. Ô khách đã tự gõ mà con trỏ chỉ chèn
 * vào giữa thì để trình duyệt dán như thường (khách đang ghép chữ). Gọi đồng bộ trong `onPaste` để kịp `preventDefault`.
 */
export function takesAddressPaste(
  text: string,
  cachedProvinces: readonly GeoOption[] | undefined,
  el: { value: string; selectionStart: number | null; selectionEnd: number | null },
  target: PasteTextField,
  edited: ReadonlySet<PasteSlot>,
): boolean {
  const replacing = el.selectionStart === 0 && el.selectionEnd === el.value.length;
  return (replacing || !edited.has(target)) && parseAddressPaste(text, cachedProvinces ?? []) !== null;
}

/**
 * Điền form từ khối dán (sau khi `takesAddressPaste` đã nhận). Ô khách đã sửa giữ nguyên; tỉnh chỉ đổi khi khách chưa tự chọn; phường
 * chỉ khớp trong tỉnh mà khối dán ghi. Phường điền sẵn từ lần trước bị xoá khi khối dán có địa chỉ mới, kể cả khi không khớp được
 * phường mới. Không tự lưu.
 */
export async function applyAddressPaste<G extends PasteGeo>(text: string, target: PasteTextField, host: AddressPasteHost<G>): Promise<void> {
  const provinces = await host.provinces().catch((): GeoOption[] => []);
  const paste = parseAddressPaste(text, provinces);
  if (!paste) return;
  const free = (k: PasteSlot) => k === target || !host.edited.has(k);
  const { form, geo } = host.read();
  const p = paste.province;
  const geoFree = !geo.provinceCode || free('geo');
  const takeProvince = !!p && geoFree && geo.provinceCode !== p.code;
  const clearWard = !takeProvince && !!(p || paste.ward) && !!geo.wardCode && free('geo') && (!p || p.code === geo.provinceCode);
  const wardInto = p && paste.ward && (takeProvince || (geo.provinceCode === p.code && (!geo.wardCode || clearWard))) ? p.code : '';

  let next = fillPastedText(form, paste, free);
  const filled = next !== form || takeProvince || clearWard;
  // Không ô nào nhận được gì (ô khác khách đã sửa hết): làm như trình duyệt, chữ dán thay ô đang nhận cú dán.
  if (!filled && !wardInto) next = { ...form, [target]: text.replace(/\s+/g, ' ').trim().slice(0, FIELD_MAX[target]) };
  if (next !== form) host.setForm(next);
  if (takeProvince) host.setGeo((g) => ({ ...g, province: p!.name, provinceCode: p!.code, ward: '', wardCode: '' }));
  else if (clearWard) host.setGeo((g) => ({ ...g, ward: '', wardCode: '' }));
  if (filled) host.announce();
  if (!wardInto || !paste.ward) return;

  const w = matchPastedWard(await host.communes(wardInto).catch((): GeoOption[] => []), paste.ward);
  if (!w) return;
  host.setGeo((g) => (g.provinceCode === wardInto && (!g.wardCode || free('geo')) ? { ...g, ward: w.name, wardCode: w.code } : g));
  if (!filled) host.announce();
}
