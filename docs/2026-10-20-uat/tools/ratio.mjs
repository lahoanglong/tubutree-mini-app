// Tính tỉ lệ tương phản nhanh: node ratio.mjs <chữ> <nền> [opacityChữ] [opacityPhầnTử] [nềnPhía sau]
//   vd: node ratio.mjs '#96650A' '#EFEBE2' 1 0.7 '#F6F4EF'
const hexToC = (h) => { h = h.replace('#', ''); const n = (i) => parseInt(h.slice(i, i + 2), 16); return { r: n(0), g: n(2), b: n(4) }; };
const mix = (f, b, a) => ({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const [fg, bg, fo = '1', eo = '1', behind = '#F6F4EF'] = process.argv.slice(2);
const back = hexToC(behind);
const bgEff = mix(hexToC(bg), back, +eo); // phần tử mờ trộn cả nền lẫn chữ vào nền sau
const fgEff = mix(mix(hexToC(fg), hexToC(bg), +fo), back, +eo);
const [hi, lo] = [lum(fgEff), lum(bgEff)].sort((a, b) => b - a);
console.log(((hi + 0.05) / (lo + 0.05)).toFixed(2));
