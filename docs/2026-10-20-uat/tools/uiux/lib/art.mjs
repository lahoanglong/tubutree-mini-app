// Ảnh giả (SVG data URI) thay cho ảnh sản phẩm/avatar — dev DB không có ảnh thật (thumbnail = null).
// Tông xanh/đất sét nhạt để màn hình chụp gần với ảnh sản phẩm thật nhất có thể; KHÔNG phải ảnh thật
// nên đánh giá "ảnh sản phẩm" phải ghi rõ là giới hạn của bộ chụp.
const PALETTES = [
  ['#E8F0E4', '#BFD3B5', '#5E8A5A'],
  ['#F3EADF', '#E2CDB4', '#A7753F'],
  ['#E7EEF0', '#BCD0D6', '#4F7F8C'],
  ['#F2E6E1', '#E3C3B8', '#A55B45'],
  ['#EFEFE0', '#D9D8A8', '#8B8A3A'],
];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function artUri(seed = 'x', kind = 'product') {
  const h = hash(String(seed));
  const [bg1, bg2, fg] = PALETTES[h % PALETTES.length];
  const initials = String(seed)
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'T';
  const shape =
    kind === 'avatar'
      ? `<circle cx="200" cy="200" r="150" fill="${fg}" opacity=".18"/>`
      : `<path d="M110 310c0-110 60-190 190-210-10 110-70 190-190 210z" fill="${fg}" opacity=".22"/><rect x="150" y="120" width="100" height="190" rx="22" fill="#fff" opacity=".65"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>` +
    `<rect width="400" height="400" fill="url(#g)"/>${shape}` +
    `<text x="200" y="${kind === 'avatar' ? 228 : 232}" font-family="Georgia,serif" font-size="${kind === 'avatar' ? 96 : 56}" text-anchor="middle" fill="${fg}">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
