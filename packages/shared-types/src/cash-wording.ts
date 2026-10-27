/**
 * Chữ mang nghĩa thưởng hoặc trả bằng tiền mặt. Zalo không cho Mini App thưởng/trả tiền mặt, nên ưu đãi riêng của cửa hàng
 * (chữ cửa hàng tự viết, Tubu duyệt rồi hiện cho khách) không được ghi như vậy. Một nguồn cho API và hai app để cả hai phía chặn cùng luật.
 * Giảm giá ("giảm 10k", "giảm 5%") và quà hiện vật không bị chặn: chỉ chặn cụm nói về tiền mặt/chuyển khoản/hoàn tiền,
 * và động từ tặng/thưởng/hoàn/trả đứng ngay trước một số tiền ("tặng 10k").
 */

const PHRASES = [
  'tien mat',
  'tien thuong',
  'thuong tien',
  'tang tien',
  'tra tien',
  'tra thuong',
  'nhan tien',
  'the cao',
  'hoan tien',
  'rut tien',
  'chuyen tien',
  'chuyen khoan',
  'chia tien',
  'li xi tien',
  'cash',
  'cashback',
  'momo',
  'zalopay',
  'zalo pay',
  'vnpay',
  'shopeepay',
  // Chuyển về ngân hàng; "thanh toán qua thẻ ngân hàng" của khách không phải thưởng nên không chặn cụm "ngân hàng" trần.
  'vao ngan hang',
  've ngan hang',
  'ngan hang cua ban',
  'ngan hang cua khach',
  'so tai khoan',
  'stk',
  // Tiền quy đổi dưới tên khác: hoàn về ví, phiếu/thẻ quà.
  'hoan vi',
  'hoan vao vi',
  'hoan lai vao vi',
  'phieu mua hang',
  'phieu qua tang',
  'the qua tang',
  'gift card',
  'giftcard',
] as const;

// Động từ cho/thưởng ngay trước số tiền: "tặng 10k", "thưởng ngay 20.000đ", "hoàn lại 5 nghìn".
// Không có "tra" trần: bỏ dấu thì "trà" (trà 25k) trùng "trả"; chỉ "trả lại" và cụm "trả tiền" mới tính.
const GIVE_VERB = '(?:tang|thuong|hoan|tra lai|bieu|li ?xi|nhan|cong|chuyen|ck)';
// "cho" đứng trước rất nhiều số không phải tiền ("cho 1.000 khách đầu tiên"): chỉ tính khi số có đơn vị tiền.
const GIVE_VERB_UNIT_ONLY = 'cho';
const FILLER = '(?:\\s+(?:ban|khach|hang|moi|nguoi|thanh vien|tung|cac|ngay|lai|them|luon|toi da|den|tuong duong|tien|menh gia|phong bao|bao li xi|the cao)|\\s+[^\\sa-z0-9.,;:!?()\\/%-]+)*';
const NUMBER_WORDS = '(?:mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi|tram|linh|le|ruoi)';
// Đơn vị tiền nói thường: k, nghìn, triệu, ngoại tệ.
const UNIT = '(?:k|d|vnd|dong|nghin|ngan|trieu|tr|usd|dollar|do la|do|euro)';
// Tiếng lóng: "2 củ" (triệu), "50 cành" (nghìn), "năm chục" (năm mươi nghìn). Chỉ tính khi đứng cuối cụm hay trước từ nối, để
// "tặng 2 củ cải", "tặng 1 chục trứng" không bị chặn.
const SLANG_UNIT = '(?:cu|canh|chuc|tram)';
const SLANG_END = '(?=\\s*(?:$|[.,;:!?)\\/]|cho|moi|vao|khi|nhe|nha|nua|tien|dong|vnd|nghin|ngan|d\\b))';
// Số tiền: số + đơn vị tiền, số có dấu phân cách nghìn, số trần từ 4 chữ số, hoặc số viết bằng chữ ("năm mươi nghìn").
const UNIT_AMOUNT =
  '(?:\\d[\\d.,]*\\s?' + UNIT + '\\b|' +
  NUMBER_WORDS + '(?:\\s+' + NUMBER_WORDS + ')*\\s+(?:nghin|ngan|trieu|ty)\\b|' +
  '(?:\\d[\\d.,]*|' + NUMBER_WORDS + '(?:\\s+' + NUMBER_WORDS + ')*)\\s?' + SLANG_UNIT + '\\b' + SLANG_END + ')';
// Bỏ qua khi ngay sau là điểm/xu/giọt hay đơn vị hàng hoá ("tặng 5k điểm").
const NOT_MONEY_AFTER_UNIT = '(?!\\s?(?:diem|xu|giot|sp|san pham|cai|goi|hop|chai|lit|ml|gram|kg|g|voucher|phieu giam|ma giam)\\b)';
// Số trần: ngoài điểm/xu/hàng hoá còn người, lần, suất, thời gian ("cho 1.000 khách đầu tiên", "tặng 5000 lượt").
const BARE_AMOUNT = '(?:\\d{1,3}(?:[.,]\\d{3})+(?![a-z0-9])|\\d{4,}(?![a-z0-9]))';
const NOT_MONEY_AFTER_BARE =
  '(?!\\s?(?:diem|xu|giot|sp|san pham|cai|goi|hop|chai|lit|ml|gram|kg|g|tui|cay|ly|coc|voucher|phieu giam|ma giam|khach|nguoi|ban|don|lan|luot|suat|phan|thanh vien|cua hang|ngay|thang|tuan|nam|tuoi|phut|gio)\\b)';
const MONEY = `(?:${UNIT_AMOUNT}${NOT_MONEY_AFTER_UNIT}|${BARE_AMOUNT}${NOT_MONEY_AFTER_BARE})`;
const GIVE_AMOUNT = new RegExp(
  `(?<![a-z0-9])(?:${GIVE_VERB}${FILLER}\\s+${MONEY}|${GIVE_VERB_UNIT_ONLY}${FILLER}\\s+${UNIT_AMOUNT}${NOT_MONEY_AFTER_UNIT})`,
  'u',
);
// "Hoàn 5% giá trị đơn", "thưởng 3%": hoàn/thưởng theo phần trăm là tiền trừ khi nói rõ là điểm.
// Hoàn/trả lại theo điều kiện hàng lỗi/vỡ là bảo hành hàng hoá, không phải thưởng tiền; "thưởng X%" thì luôn chặn.
const REFUND_PERCENT = new RegExp(
  '(?<![a-z0-9])(?:' +
    '(?:hoan(?: lai)?|tra lai)(?: ngay)? \\d+(?:[.,]\\d+)? ?%(?![^.;,]*\\bdiem\\b)' +
    '(?![^.;,]*\\b(?:neu|khi|truong hop)\\b[^.;,]*\\b(?:hang (?:loi|hu|hong|sai|vo|bep)|bi (?:loi|hu|hong|vo|bep|sai)|giao sai|loi san xuat|hu hong|vo hong)\\b)' +
    '|thuong(?: ngay)? \\d+(?:[.,]\\d+)? ?%(?![^.;,]*\\bdiem\\b)' +
    ')',
  'u',
);
// Tiền trả cho rác: "Trả 10k cho mỗi kg giấy", "Mỗi kg giấy trả 10k", "Thu mua giấy 5k/kg", "1kg giấy = 10k".
// "qua"/"tra" bỏ dấu trùng "quá"/"trà", nên chỉ tính khi mở đầu một ý, đi với người, hoặc đi với đơn vị rác. Đơn vị cho dạng
// `<tiền>/<đơn vị>` không gồm "chai"/"hộp" trơn để "Nước suối 5k/chai" qua.
const WASTE_UNIT = '(?:kg|ky|ki|kilo|can|thung|chai|vo|hop|lon|bao|bich)';
const SLASH_UNIT = '(?:kg|ky|kilo|can|vo)';
// Từ chỉ rác/phế liệu: giá theo đơn vị (`5k/kg`) chỉ là tiền trả cho rác khi cùng ý có từ này; `Gạo 2k/kg` là giá hàng.
// "bia" trơn trùng "bia" (đồ uống) sau khi bỏ dấu, nên chỉ nhận "bìa cứng"/"bìa carton".
const MATERIAL = '(?<![a-z0-9])(?:giay|carton|thung|vo|chai|lon|nhua|sat|nhom|dong|rac|phe lieu|ve chai|hop sua|pin|nilon|bao bi|bia cung|bia carton|bao cu|bao giay|do cu|thu mua|thu gom|mua lai|tai che|quy doi)(?![a-z0-9])';
const GIFT_AMOUNT = new RegExp(
  `(?:^|[.,;:!?(\\-]\\s*)(?:qua${FILLER}\\s*[:=]?\\s+${MONEY}|tra\\s+(?:khach|ban|nguoi|thanh vien)${FILLER}\\s+${MONEY})` +
    `|(?<![a-z0-9])tra(?:\\s+(?:ngay|lai|luon|them))*\\s+${UNIT_AMOUNT}(?=\\s*(?:\\/\\s*${SLASH_UNIT}|(?:cho\\s+)?(?:moi\\s*)?(?:\\d+|mot|moi)\\s*${WASTE_UNIT})\\b)` +
    `|(?:${MATERIAL}[^.;!?]{0,40}?${UNIT_AMOUNT}\\s*\\/\\s*${SLASH_UNIT}\\b|${UNIT_AMOUNT}\\s*\\/\\s*${SLASH_UNIT}\\b[^.;!?]{0,40}?${MATERIAL})` +
    `|(?<![a-z0-9])(?:moi|1|mot)\\s*${WASTE_UNIT}\\b[^.;!?]{0,40}?(?:(?<![a-z0-9])(?:tra|duoc|nhan|lay)|=)\\s+${UNIT_AMOUNT}${NOT_MONEY_AFTER_UNIT}(?!\\s?(?:uong|an)\\b)(?!\\s+tra\\b)`,
  'u',
);
const WORD = '[a-z0-9]';
const PHRASE_RES = PHRASES.map((p) => ({ phrase: p, re: new RegExp(`(?<!${WORD})${p}(?!${WORD})`, 'u') }));

// Cụm có chữ giống chữ cấm nhưng không phải thưởng tiền: được thay bằng khoảng trắng cùng độ dài trước khi dò.
const HARMLESS: RegExp[] = [
  // Tiền cọc vỏ chai/hộp được trả lại là hoàn cọc thật.
  /(?:hoan|tra)(?: lai)? tien coc\b/g,
  // "không phải trả tiền ship", "miễn trả tiền", "trả tiền ship/vận chuyển": khách trả chứ không nhận tiền.
  /(?:khong|ko|khoi|dung|mien|chua)(?: (?:phai|can|bi|mat))* (?:tra|nop|dong) tien\b/g,
  // Khách trả tiền khi nhận hàng / bằng chuyển khoản...: khách là người trả.
  /(?:khach|nguoi mua|nguoi nhan)(?: hang)? (?:tra|nop|dong) tien\b/g,
  /tra tien (?:khi|luc|sau khi|truoc khi|bang|qua|tai|o) /g,
  /tra tien (?:ship|van chuyen|giao hang|phi)\b/g,
  // Số điện thoại: 0901234567, 0909 123 456, +84 909 123 456 (9-11 chữ số, có thể cách bằng dấu cách, chấm, gạch).
  /(?<![\d])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/g,
];

const ACCENTED_HARMLESS = /nhân tiện|trà thượng|thể cao|thế cao/iu;

type Folded = { text: string; src: number[] };

/** Bỏ dấu, chữ thường, gộp khoảng trắng (xuống dòng, •, | là ngắt ý nên thành dấu chấm); `src[i]` là vị trí trong chuỗi gốc của ký tự thứ i để lấy lại đoạn chữ gốc cho lời nhắn. */
function fold(text: string): Folded {
  let out = '';
  const src: number[] = [];
  let i = 0;
  let lastSpace = false;
  for (const ch of text) {
    const folded = ch
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
    for (const c of folded) {
      if (/[\r\n•|]/.test(c)) {
        out += '.';
        src.push(i);
        lastSpace = false;
      } else if (/\s/.test(c)) {
        if (!lastSpace) {
          out += ' ';
          src.push(i);
        }
        lastSpace = true;
      } else {
        out += c;
        for (let k = 0; k < c.length; k += 1) src.push(i);
        lastSpace = false;
      }
    }
    i += ch.length;
  }
  return { text: out, src };
}

function original(text: string, f: Folded, start: number, end: number): string {
  const from = f.src[start] ?? 0;
  const to = (f.src[end - 1] ?? text.length - 1) + 1;
  return text.slice(from, to).replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

const SLANG_TAIL = new RegExp(`${SLANG_UNIT}$`, 'u');

/**
 * Khớp đầu tiên của `re`, trừ lối nói lóng lặp lại hàng hoá đã nêu ngay trước đó: "mua 1 chục trứng tặng 1 chục",
 * "mua 2 củ tặng 1 củ" là hàng, không phải tiền.
 */
function firstReal(re: RegExp, t: string): RegExpExecArray | null {
  const g = new RegExp(re.source, 'gu');
  for (let m = g.exec(t); m; m = g.exec(t)) {
    const unit = SLANG_TAIL.exec(m[0]);
    const goodsBefore = unit && new RegExp(`(?:\\d|${NUMBER_WORDS})\\s?${unit[0]}\\b`, 'u').test(t.slice(0, m.index));
    // "Tặng 5 cành cho khách nữ": tặng/biếu + lóng + "cho" là quà hiện vật; thưởng/hoàn/chuyển... + lóng thì vẫn là tiền.
    const softGift = unit && /^(?:canh|chuc)$/u.test(unit[0]) && /^(?:tang|bieu)\b/u.test(m[0]) && /^\s*cho\b/u.test(t.slice(m.index + m[0].length));
    if (!goodsBefore && !softGift) return m;
  }
  return null;
}

/** Đoạn chữ vi phạm đầu tiên tìm thấy, đúng như đại lý đã viết (có dấu), hoặc null nếu không có. */
export function findCashWording(input: string): string | null {
  const text = input.normalize('NFC');
  const f = fold(text);
  let t = f.text;
  // Chữ vô hại còn dấu: bỏ dấu thì "nhân tiện", "trà thượng", "thể cao" trùng "nhận tiền", "trả thưởng", "thẻ cào".
  const accented = new RegExp(ACCENTED_HARMLESS.source, 'giu');
  const masked = new Set<number>();
  for (let m = accented.exec(text); m; m = accented.exec(text)) for (let k = m.index; k < m.index + m[0].length; k += 1) masked.add(k);
  if (masked.size > 0) t = t.split('').map((c, k) => (masked.has(f.src[k] ?? -1) ? ' ' : c)).join('');
  for (const re of HARMLESS) t = t.replace(re, (m) => ' '.repeat(m.length));
  for (const { re } of PHRASE_RES) {
    const m = re.exec(t);
    if (m) return original(text, f, m.index, m.index + m[0].length);
  }
  for (const re of [GIVE_AMOUNT, GIFT_AMOUNT, REFUND_PERCENT]) {
    const m = firstReal(re, t);
    if (m) return original(text, f, m.index, m.index + m[0].length);
  }
  return null;
}

export const CASH_WORDING_MESSAGE =
  'Ưu đãi không được ghi thưởng hay trả bằng tiền (tiền mặt, chuyển khoản, hoàn tiền, "tặng 10k"...) vì Zalo không cho phép. Hãy viết ưu đãi bằng giảm giá hoặc quà, ví dụ "Giảm 10% hoá đơn đầu" hay "Tặng 1 túi vải".';

/** Lời nhắn kèm đoạn chữ bị chặn, để đại lý biết phải sửa chỗ nào. */
export function cashWordingMessage(text: string): string {
  const found = findCashWording(text);
  return found ? `Chữ "${found}" nói về thưởng hay trả bằng tiền. ${CASH_WORDING_MESSAGE}` : CASH_WORDING_MESSAGE;
}
