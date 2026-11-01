import type { Page } from '@playwright/test';

const KEY = '\\"campaigns\\":';
const UNDEFINED_VALUE = '\\"$undefined\\"';

/** Hết giá trị mảng bắt đầu tại `start` (chỉ số của `[`), tính theo dạng JSON nằm trong chuỗi JS của script `self.__next_f.push`: ngoặc nằm trong chuỗi bị bỏ qua. */
function arrayEnd(html: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '\\') {
      let j = i;
      while (html[j] === '\\') j += 1;
      // Dấu nháy mở/đóng chuỗi JSON nằm trong chuỗi JS là `\"`; dấu nháy nằm TRONG chuỗi JSON là `\\\"`.
      if (html[j] === '"' && j - i === 1) inString = !inString;
      i = html[j] === '"' ? j : j - 1;
      continue;
    }
    if (ch === '<' && html.startsWith('</script>', i)) throw new Error('mảng chiến dịch bị cắt giữa hai đoạn dữ liệu RSC: đổi cách gỡ trong support/server-initial.ts');
    if (inString) continue;
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('không tìm thấy chỗ kết thúc mảng chiến dịch trong HTML');
}

/**
 * Gỡ `initial.campaigns` khỏi dữ liệu RSC mà server nhúng trong HTML (đổi thành `undefined`, đúng như lúc API chiến dịch lỗi khi server dựng trang).
 * `found` là số lần thấy khoá `campaigns`: 0 nghĩa là trang không còn truyền danh sách chiến dịch, hoặc dạng nhúng đã đổi.
 */
export function dropServerCampaigns(html: string): { html: string; found: number } {
  let out = html;
  let found = 0;
  for (let from = 0; ; ) {
    const at = out.indexOf(KEY, from);
    if (at < 0) break;
    found += 1;
    const start = at + KEY.length;
    if (out[start] === '[') {
      out = out.slice(0, start) + UNDEFINED_VALUE + out.slice(arrayEnd(out, start));
    }
    from = start + 1;
  }
  return { html: out, found };
}

/**
 * Trang chủ web được server dựng sẵn cùng danh sách chiến dịch (API thật trả mảng, kể cả rỗng) nên trình duyệt không hỏi lại, và spec đo banner về muộn
 * không còn gì để đo. Chặn tài liệu `/` để gỡ danh sách đó: trình duyệt phải tự hỏi `/campaigns`, như khi server dựng mà API chiến dịch lỗi. Trả về số lần
 * đã thấy khoá `campaigns` (spec khẳng định > 0 để đổi dạng nhúng thì spec đỏ chứ không lặng lẽ không đo gì).
 */
export async function serverWithoutCampaigns(page: Page): Promise<{ found: () => number }> {
  let found = 0;
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      const rewritten = dropServerCampaigns(await response.text());
      found = rewritten.found;
      const headers = { ...response.headers(), 'content-length': String(Buffer.byteLength(rewritten.html)) };
      delete headers['content-encoding'];
      return route.fulfill({ response, headers, body: rewritten.html });
    },
  );
  return { found: () => found };
}
