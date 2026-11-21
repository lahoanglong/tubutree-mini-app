/**
 * Bộ mã hoá QR (ISO/IEC 18004) đủ cho Mini App: một đoạn dữ liệu (số, chữ-số hoặc byte UTF-8), mức sửa lỗi M, phiên bản 1–40,
 * mặt nạ chọn theo điểm phạt N1–N4. Thay thư viện `qrcode` (24 KB trong gói, Zalo cân tổng dung lượng).
 * Cách đặt module và tính điểm phạt chép đúng `qrcode` 1.5 nên cùng chế độ thì ra cùng ma trận: `qr-matrix.spec.ts` so từng module.
 * Khác thư viện cũ duy nhất ở chuỗi trộn kiểu ký tự (vd chữ thường lẫn dãy số dài): `qrcode` tự tách nhiều đoạn, ở đây cả chuỗi là một đoạn byte,
 * nên mã có thể lớn hơn một phiên bản nhưng vẫn quét ra đúng chuỗi.
 * Không gọi mạng, không dùng số ngẫu nhiên: cùng chuỗi luôn ra cùng ảnh.
 */

/** Mức M theo phiên bản (chỉ số 0 bỏ trống): số từ mã sửa lỗi của mỗi khối và số khối. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export type QrMode = 'numeric' | 'alphanumeric' | 'byte';

export interface QrMatrix {
  /** Số module mỗi cạnh (21 ở phiên bản 1, thêm 4 mỗi phiên bản). */
  size: number;
  version: number;
  mask: number;
  /** Theo hàng: `modules[row * size + col]` là 1 khi module tối. */
  modules: Uint8Array;
}

/** Chế độ gọn nhất cho CẢ chuỗi (không tách đoạn): toàn chữ số, toàn ký tự chữ-số QR (chữ in hoa), còn lại byte UTF-8. */
export function qrMode(text: string): QrMode {
  if (/^\d+$/.test(text)) return 'numeric';
  if (text !== '' && [...text].every((ch) => ALNUM.includes(ch))) return 'alphanumeric';
  return 'byte';
}

const MODE_BITS: Record<QrMode, number> = { numeric: 1, alphanumeric: 2, byte: 4 };

function countBits(mode: QrMode, version: number): number {
  const tier = version < 10 ? 0 : version < 27 ? 1 : 2;
  return { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] }[mode][tier] ?? 16;
}

/** Số module dành cho dữ liệu + sửa lỗi (bỏ module chức năng). */
function rawModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (version: number): number => Math.floor(rawModules(version) / 8) - (ECC_PER_BLOCK[version] ?? 0) * (BLOCKS[version] ?? 0);

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j]!, root);
      if (j + 1 < degree) r[j] = r[j]! ^ r[j + 1]!;
    }
    root = gfMul(root, 2);
  }
  return r;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (out.shift() ?? 0);
    out.push(0);
    divisor.forEach((coef, i) => {
      out[i] = out[i]! ^ gfMul(coef, factor);
    });
  }
  return out;
}

function bitString(text: string, mode: QrMode): { bits: number[]; length: number } {
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      put(Number(chunk), chunk.length * 3 + 1);
    }
    return { bits, length: text.length };
  }
  if (mode === 'alphanumeric') {
    for (let i = 0; i < text.length; i += 2) {
      const a = ALNUM.indexOf(text[i]!);
      if (i + 1 < text.length) put(a * 45 + ALNUM.indexOf(text[i + 1]!), 11);
      else put(a, 6);
    }
    return { bits, length: text.length };
  }
  const bytes = new TextEncoder().encode(text);
  bytes.forEach((b) => put(b, 8));
  return { bits, length: bytes.length };
}

function codewords(text: string, mode: QrMode): { version: number; data: number[] } {
  const payload = bitString(text, mode);
  let version = 1;
  for (; version <= 40; version++) {
    if (4 + countBits(mode, version) + payload.bits.length <= dataCodewords(version) * 8) break;
  }
  if (version > 40) throw new Error('Chuỗi quá dài cho mã QR');
  const capacityBits = dataCodewords(version) * 8;
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(MODE_BITS[mode], 4);
  put(payload.length, countBits(mode, version));
  bits.push(...payload.bits);
  if (bits.length + 4 <= capacityBits) put(0, 4);
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  for (let pad = 0xec; data.length < capacityBits / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  // Chia khối (nhóm 2 dài hơn nhóm 1 đúng một từ mã dữ liệu) rồi xen kẽ dữ liệu, sau đó xen kẽ sửa lỗi.
  const blocks = BLOCKS[version]!;
  const ecc = ECC_PER_BLOCK[version]!;
  const total = Math.floor(rawModules(version) / 8);
  const group1 = blocks - (total % blocks);
  const short = Math.floor(data.length / blocks);
  const divisor = rsDivisor(ecc);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let b = 0, at = 0; b < blocks; b++) {
    const len = b < group1 ? short : short + 1;
    const block = data.slice(at, at + len);
    at += len;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, divisor));
  }
  const out: number[] = [];
  for (let i = 0; i <= short; i++) for (const block of dataBlocks) if (i < block.length) out.push(block[i]!);
  for (let i = 0; i < ecc; i++) for (const block of eccBlocks) out.push(block[i]!);
  return { version, data: out };
}

function alignmentCoords(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = size === 145 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
  const pos = [size - 7];
  for (let i = 1; i < count - 1; i++) pos.push(pos[i - 1]! - step);
  pos.push(6);
  return pos.reverse();
}

function formatBits(mask: number): number {
  // Mức M mang 2 bit "00" nên phần dữ liệu chỉ còn số mặt nạ.
  let rem = mask;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((mask << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function maskAt(mask: number, i: number, j: number): boolean {
  switch (mask) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    default: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
  }
}

function penalty(m: Uint8Array, size: number): number {
  const at = (r: number, c: number) => m[r * size + c]!;
  let points = 0;
  for (let r = 0; r < size; r++) {
    let runRow = 0;
    let runCol = 0;
    let lastRow = -1;
    let lastCol = -1;
    let bitsRow = 0;
    let bitsCol = 0;
    for (let c = 0; c < size; c++) {
      const a = at(r, c);
      const b = at(c, r);
      if (a === lastRow) runRow++;
      else {
        if (runRow >= 5) points += runRow - 2;
        lastRow = a;
        runRow = 1;
      }
      if (b === lastCol) runCol++;
      else {
        if (runCol >= 5) points += runCol - 2;
        lastCol = b;
        runCol = 1;
      }
      bitsRow = ((bitsRow << 1) & 0x7ff) | a;
      bitsCol = ((bitsCol << 1) & 0x7ff) | b;
      if (c >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) points += 40;
      if (c >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) points += 40;
    }
    if (runRow >= 5) points += runRow - 2;
    if (runCol >= 5) points += runCol - 2;
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const sum = at(r, c) + at(r, c + 1) + at(r + 1, c) + at(r + 1, c + 1);
      if (sum === 0 || sum === 4) points += 3;
    }
  }
  const dark = m.reduce((acc, v) => acc + v, 0);
  return points + Math.abs(Math.ceil((dark * 100) / m.length / 5) - 10) * 10;
}

export function qrMatrix(text: string): QrMatrix {
  const mode = qrMode(text);
  const { version, data } = codewords(text, mode);
  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const reserved = new Uint8Array(size * size);
  const set = (r: number, c: number, dark: boolean | number) => {
    modules[r * size + c] = dark ? 1 : 0;
    reserved[r * size + c] = 1;
  };

  for (const [row, col] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (row + r < 0 || row + r >= size || col + c < 0 || col + c >= size) continue;
        const ring = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        set(row + r, col + c, ring || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  const coords = alignmentCoords(version, size);
  coords.forEach((row, i) => {
    coords.forEach((col, j) => {
      const last = coords.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) set(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
      }
    });
  });
  const putFormat = (mask: number) => {
    const bits = formatBits(mask);
    for (let i = 0; i < 15; i++) {
      const dark = (bits >> i) & 1;
      set(i < 6 ? i : i < 8 ? i + 1 : size - 15 + i, 8, dark);
      set(8, i < 8 ? size - i - 1 : i < 9 ? 15 - i : 14 - i, dark);
    }
    set(size - 8, 8, 1);
  };
  putFormat(0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = (bits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // Đặt bit dữ liệu theo đường zíc-zắc hai cột, từ góc dưới phải, bỏ qua cột định thời 6 và module chức năng.
  let bit = 0;
  for (let col = size - 1, up = true; col > 0; col -= 2, up = !up) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = up ? size - 1 - k : k;
      for (let c = 0; c < 2; c++) {
        const idx = row * size + col - c;
        if (reserved[idx]) continue;
        const byte = data[bit >>> 3];
        modules[idx] = byte !== undefined ? (byte >>> (7 - (bit & 7))) & 1 : 0;
        bit++;
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        if (!reserved[idx] && maskAt(mask, r, c)) modules[idx] = modules[idx]! ^ 1;
      }
    }
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    putFormat(mask);
    applyMask(mask);
    const score = penalty(modules, size);
    applyMask(mask);
    if (score < lowest) {
      lowest = score;
      best = mask;
    }
  }
  applyMask(best);
  putFormat(best);
  return { size, version, mask: best, modules };
}
