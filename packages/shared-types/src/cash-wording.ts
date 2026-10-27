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
  'hoan tien',
  'rut tien',
  'chuyen tien',
  'chuyen khoan',
  'nhan tien',
  'chia tien',
  'li xi tien',
  'cash',
  'cashback',
  'momo',
  'zalopay',
  'zalo pay',
  'vnpay',
  'shopeepay',
  'ngan hang',
  'so tai khoan',
  'stk',
  'the cao',
] as const;

// Động từ cho/thưởng ngay trước số tiền: "tặng 10k", "thưởng ngay 20.000đ", "hoàn lại 5 nghìn".
const GIVE_VERB = '(?:tang|thuong|hoan|tra|cho|bieu|li ?xi|nhan|cong|chuyen|ck)';
const FILLER = '(?:\\s+(?:ban|khach|hang|moi|nguoi|thanh vien|tung|cac|ngay|lai|them|luon|toi da|den|tuong duong))*';
const NUMBER_WORDS = '(?:mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi|tram|linh|le|ruoi)';
// Số tiền: số + đơn vị tiền, số có dấu phân cách nghìn, số trần từ 4 chữ số, hoặc số viết bằng chữ ("năm mươi nghìn").
// Bỏ qua khi ngay sau là điểm/xu/giọt hay đơn vị hàng hoá ("tặng 1.000 điểm", "cộng 2k điểm").
const AMOUNT =
  '(?:(?:\\d[\\d.,]*\\s?(?:k|d|vnd|dong|nghin|ngan|trieu|tr|usd|dollar|do la|euro)\\b|' +
  NUMBER_WORDS + '(?:\\s+' + NUMBER_WORDS + ')*\\s+(?:nghin|ngan|trieu|ty)\\b|' +
  '\\d{1,3}(?:[.,]\\d{3})+(?![a-z0-9])|\\d{4,}(?![a-z0-9]))' +
  '(?!\\s?(?:diem|xu|giot|sp|san pham|cai|goi|hop|chai|lit|ml|gram|kg|g)\\b))';
const GIVE_AMOUNT = new RegExp(`(?<![a-z0-9])${GIVE_VERB}${FILLER}\\s+${AMOUNT}`, 'u');
const WORD = '[a-z0-9]';
const PHRASE_RES = PHRASES.map((p) => ({ phrase: p, re: new RegExp(`(?<!${WORD})${p}(?!${WORD})`, 'u') }));

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Đoạn chữ vi phạm đầu tiên tìm thấy (đã bỏ dấu, chữ thường), hoặc null nếu không có. */
export function findCashWording(text: string): string | null {
  // Tiền cọc vỏ chai/hộp được trả lại là hoàn cọc thật, không phải thưởng bằng tiền.
  const t = fold(text).replace(/(?:hoan|tra)(?: lai)? tien coc\b/g, ' ');
  for (const { phrase, re } of PHRASE_RES) if (re.test(t)) return phrase;
  const m = GIVE_AMOUNT.exec(t);
  return m ? m[0] : null;
}

export const CASH_WORDING_MESSAGE =
  'Ưu đãi không được ghi thưởng hay trả bằng tiền (tiền mặt, chuyển khoản, hoàn tiền, "tặng 10k"...) vì Zalo không cho phép. Hãy viết ưu đãi bằng giảm giá hoặc quà, ví dụ "Giảm 10% hoá đơn đầu" hay "Tặng 1 túi vải".';
