import type { Page } from '@playwright/test';
import { probeLayout } from './layout-probe';
import { probeTapTargets } from './touch-probe';

/**
 * W182: bộ dò nghiệm thu cuối cho một màn đang mở (Mini App và web dùng chung). Mỗi lần gọi đo trong trình duyệt:
 * tràn ngang, vùng chạm < 44px, chữ bị cắt hoặc đè nhau, nút nổi đè nội dung, số tiền thiếu `tabular-nums`,
 * vùng chạm dưới capsule Zalo (Mini App), lưới/cột để so số cột giữa các khổ, và khoảng trống dọc lớn.
 * Chỉ dò, không khẳng định: spec gọi nó tự quyết lỗi nào làm đỏ (guard) hay chỉ ghi nhật ký (kiểm toán).
 */

export interface ProbeOptions {
  /** Khổ chạm: kiểm vùng chạm 44px. */
  touch: boolean;
  /** Mini App: kiểm vùng capsule Zalo ở góc trên phải. */
  capsule: boolean;
}

export interface FixedFinding {
  label: string;
  rect: [number, number, number, number];
  overlaps: string[];
}

export interface GridFinding {
  label: string;
  kids: number;
  cols: number;
  tileW: number;
  tileH: number;
}

export interface W182Findings {
  vw: number;
  vh: number;
  docH: number;
  overflowX: number;
  rightOverflow: { label: string; right: number }[];
  /** Điều khiển có vùng chạm thật < 44×44px (đo bằng `probeTapTargets`, chỉ khi `touch`). */
  small: string[];
  cutText: string[];
  ellipsizedCta: string[];
  textOverlap: string[];
  floating: FixedFinding[];
  bottomBars: number;
  notTabular: string[];
  stickyBar: string[];
  capsule: string[];
  grids: GridFinding[];
  maxVerticalGap: { y: number; h: number };
  contentSpan: number;
}

export async function probeW182(page: Page, options: ProbeOptions): Promise<W182Findings> {
  const base = await page.evaluate(
    ({ capsule }) => {
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const label = (el: Element): string => {
        const id = el.getAttribute('data-testid');
        const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        const txt = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28);
        return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}${txt ? ` "${txt}"` : ''}`;
      };
      const shown = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const s = getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
      };
      const fixedAncestor = (el: Element): boolean => {
        for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
          const p = getComputedStyle(n).position;
          if (p === 'fixed' || p === 'sticky') return true;
        }
        return false;
      };
      // Thân của <details> đang gập không được vẽ, nhưng Chrome vẫn trả hộp bao thật (dàn trang ép buộc) nằm đè lên khối phía sau: coi như ẩn, trừ <summary>.
      const collapsed = (el: Element): boolean => {
        const d = el.closest('details:not([open])');
        return !!d && !el.closest('summary');
      };
      const hidden = (el: Element): boolean => !!el.closest('[aria-hidden="true"], [hidden], [inert], script, style, noscript, [data-probe-ignore]') || collapsed(el);
      const all = Array.from(document.body.querySelectorAll('*'));

      const scrollers = [document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>('.zaui-page'))];
      const overflowX = Math.max(...scrollers.map((el) => el.scrollWidth - el.clientWidth));
      const rightOverflow = all
        .filter((el) => shown(el) && !hidden(el))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => r.right > vw + 1 && !el.closest('[data-hscroll], [class*="scroll" i], [class*="carousel" i], [class*="rail" i]'))
        .slice(0, 8)
        .map(({ el, r }) => ({ label: label(el), right: Math.round(r.right) }));

      const interactiveSel =
        'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="option"], input:not([type="hidden"]), select, textarea';

      // Chữ riêng của từng phần tử (text node trực tiếp) và hộp của chính đoạn chữ đó.
      // Vùng cắt gần nhất (cha có overflow khác visible): chữ trong vùng cuộn và chữ ngoài nó không thể đè nhau dù hộp hình học chồng.
      const clipperOf = (el: Element): Element | null => {
        for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return n;
        }
        return null;
      };
      // `lines`: từng dòng chữ riêng (đã cắt theo vùng ẩn tràn); hộp bao `r` của link xuống dòng phủ cả chỗ chữ khác nên chỉ so từng dòng với nhau.
      // Chữ nằm hoàn toàn ngoài vùng cuộn (không còn dòng nào sau khi cắt): chỉ dùng cho phép đo khoảng trống dọc.
      const rawOnly: { el: Element; raw: [number, number] }[] = [];
      const textBoxes: { el: Element; r: DOMRect; raw: [number, number]; text: string; clip: Element | null; lines: DOMRect[] }[] = [];
      for (const el of all) {
        if (hidden(el) || !shown(el)) continue;
        // Chữ chỉ dành cho trình đọc màn hình (sr-only: hộp 1×1px, bị cắt) không phải chữ nhìn thấy.
        const box = el.getBoundingClientRect();
        if (box.width <= 2 || box.height <= 2) continue;
        const own = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
        if (own.length === 0) continue;
        const range = document.createRange();
        let x1 = Infinity;
        let y1 = Infinity;
        let x2 = -Infinity;
        let y2 = -Infinity;
        const lines: DOMRect[] = [];
        // `raw`: khoảng y của chữ CHƯA cắt theo vùng cuộn (Mini cuộn trong `.zaui-page`: chữ dưới nếp gập bị cắt khỏi `lines` nhưng vẫn là nội dung của trang, cần cho phép đo khoảng trống dọc).
        let rawY1 = Infinity;
        let rawY2 = -Infinity;
        // Chữ bị cắt bởi chính phần tử (line-clamp, truncate) hay bởi cha cuộn/ẩn tràn không nhìn thấy được: chỉ tính phần nằm trong mọi vùng cắt,
        // nếu không dòng bị ẩn của đoạn rút gọn sẽ bị coi là đè lên chữ bên dưới.
        const clips: DOMRect[] = [];
        for (let n: Element | null = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clips.push(n.getBoundingClientRect());
        }
        for (const n of own) {
          range.selectNodeContents(n);
          for (const rr of Array.from(range.getClientRects())) {
            if (rr.width > 1 && rr.height > 1) {
              rawY1 = Math.min(rawY1, rr.top);
              rawY2 = Math.max(rawY2, rr.bottom);
            }
            let left = rr.left;
            let top = rr.top;
            let right = rr.right;
            let bottom = rr.bottom;
            for (const c of clips) {
              left = Math.max(left, c.left);
              top = Math.max(top, c.top);
              right = Math.min(right, c.right);
              bottom = Math.min(bottom, c.bottom);
            }
            if (right - left < 1 || bottom - top < 1) continue;
            lines.push(new DOMRect(left, top + window.scrollY, right - left, bottom - top));
            x1 = Math.min(x1, left);
            y1 = Math.min(y1, top);
            x2 = Math.max(x2, right);
            y2 = Math.max(y2, bottom);
          }
        }
        if (!Number.isFinite(x1)) {
          if (Number.isFinite(rawY1)) rawOnly.push({ el, raw: [rawY1 + window.scrollY, rawY2 + window.scrollY] });
          continue;
        }
        textBoxes.push({ el, r: new DOMRect(x1, y1 + window.scrollY, x2 - x1, y2 - y1), raw: [rawY1 + window.scrollY, rawY2 + window.scrollY], text: own.map((n) => n.textContent ?? '').join(' ').trim().replace(/\s+/g, ' ').slice(0, 24), clip: clipperOf(el), lines });
      }

      // Chữ bị cắt không có dấu hiệu (không ellipsis, không line-clamp).
      const cutText: string[] = [];
      const ellipsizedCta: string[] = [];
      for (const { el } of textBoxes) {
        const s = getComputedStyle(el);
        const clamp = (s as unknown as { webkitLineClamp?: string }).webkitLineClamp;
        const clamped = clamp && clamp !== 'none';
        const clipX = s.overflowX === 'hidden' || s.overflowX === 'clip';
        const clipY = s.overflowY === 'hidden' || s.overflowY === 'clip';
        if (clipX && s.textOverflow !== 'ellipsis' && !clamped && el.scrollWidth > el.clientWidth + 1 && s.whiteSpace !== 'normal') cutText.push(`x ${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
        if (clipY && !clamped && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 2 && s.display !== 'flex' && s.display !== 'grid') cutText.push(`y ${label(el)} ${el.scrollHeight}>${el.clientHeight}`);
        // Nhãn nút ngắn bị cắt thành "…" (thẻ có nhiều chữ như thẻ đơn hàng không tính: tên sản phẩm cắt là bình thường).
        const control = s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 ? el.closest('button, a[role="button"], [role="button"], [class*="btn" i], [class*="cta" i]') : null;
        if (control && (control.textContent ?? '').trim().length <= 32) ellipsizedCta.push(label(el));
      }

      // Hai đoạn chữ đè nhau (không cha-con, không dưới phần tử dính/cố định).
      const boxes = textBoxes.filter(({ el }) => !fixedAncestor(el)).slice(0, 900).sort((a, b) => a.r.top - b.r.top);
      const textOverlap: string[] = [];
      for (let i = 0; i < boxes.length && textOverlap.length < 8; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          if (!a || !b) continue;
          if (b.r.top >= a.r.bottom) break;
          if (a.el.contains(b.el) || b.el.contains(a.el) || a.clip !== b.clip) continue;
          let hit: { w: number; h: number } | null = null;
          for (const la of a.lines) {
            for (const lb of b.lines) {
              const w = Math.min(la.right, lb.right) - Math.max(la.left, lb.left);
              const h = Math.min(la.bottom, lb.bottom) - Math.max(la.top, lb.top);
              if (w <= 2 || h <= 2) continue;
              if ((w * h) / Math.min(la.width * la.height, lb.width * lb.height) < 0.2) continue;
              hit = { w, h };
            }
          }
          if (!hit) continue;
          const { w, h } = hit;
          textOverlap.push(`${label(a.el)} × ${label(b.el)} (${Math.round(w)}×${Math.round(h)})`);
        }
      }

      // Phần tử cố định: thanh phủ ngang (header/đáy) hay nút nổi; nút nổi đè nội dung ở khung nhìn hiện tại.
      const fixedEls = all.filter((el) => shown(el) && getComputedStyle(el).position === 'fixed' && !hidden(el));
      const floating: { label: string; rect: [number, number, number, number]; overlaps: string[] }[] = [];
      let bottomBars = 0;
      const contentLeaves = all.filter((el) => {
        if (hidden(el) || !shown(el) || fixedAncestor(el)) return false;
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
        return hasText || el.matches('img, button, a[href], input, select, textarea, video, canvas, svg');
      });
      for (const el of fixedEls) {
        if (fixedEls.some((o) => o !== el && o.contains(el))) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= vw * 0.95) {
          if (r.bottom >= vh - 4 && r.top > vh * 0.5) bottomBars += 1;
          continue;
        }
        if (getComputedStyle(el).pointerEvents === 'none' || (r.width < 6 && r.height < 6)) continue;
        // Nút Quay lại của web (BackButton): khi trang đã cuộn nó đi cùng thanh nền đặc cao 56px phủ ngang nên đè nội dung đã cuộn qua là thiết kế (trang có tự cuộn xuống tin mới như /chat). Ở đầu trang vẫn kiểm.
        if (el.getAttribute('aria-label') === 'Quay lại' && window.scrollY > 8) continue;
        const overlaps: string[] = [];
        for (const c of contentLeaves) {
          if (el.contains(c)) continue;
          const cr = c.getBoundingClientRect();
          const w = Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
          const h = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
          if (w > 4 && h > 4 && cr.top < vh && cr.bottom > 0) overlaps.push(label(c));
          if (overlaps.length >= 3) break;
        }
        floating.push({ label: label(el), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], overlaps });
      }

      // Vùng capsule Zalo: 104×44 góc trên phải khi --safe-top là 47px (đã ép ở spec).
      const capsuleHits: string[] = [];
      if (capsule) {
        for (const el of contentLeaves.concat(fixedEls.flatMap((f) => Array.from(f.querySelectorAll('button, a[href], [role="button"]'))))) {
          if (!el.matches(interactiveSel) && !Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim())) continue;
          const cr = el.getBoundingClientRect();
          if (cr.right > vw - 104 && cr.left < vw && cr.top < 44 && cr.bottom > 0) capsuleHits.push(label(el));
          if (capsuleHits.length >= 6) break;
        }
      }

      // Lưới/cột: container có >= 4 con cùng cỡ; cols = số mép trái khác nhau.
      const grids: { label: string; kids: number; cols: number; tileW: number; tileH: number }[] = [];
      for (const el of all) {
        if (hidden(el) || !shown(el)) continue;
        const s = getComputedStyle(el);
        if (s.display !== 'grid' && s.display !== 'flex' && s.display !== 'inline-grid') continue;
        if (s.display === 'flex' && s.flexWrap === 'nowrap') continue;
        const kids = Array.from(el.children).filter(shown);
        if (kids.length < 4) continue;
        const rects = kids.map((k) => k.getBoundingClientRect());
        const first = rects[0];
        if (!first) continue;
        const w0 = first.width;
        const same = rects.filter((r) => Math.abs(r.width - w0) <= 4);
        if (same.length < 4 || w0 < 40) continue;
        const cols = new Set(same.map((r) => Math.round(r.left / 4))).size;
        grids.push({ label: label(el).replace(/ ".*$/, ''), kids: kids.length, cols, tileW: Math.round(w0), tileH: Math.round(first.height) });
      }
      grids.sort((a, b) => b.kids - a.kids);

      // Khoảng trống dọc: hợp các khoảng y của lá nội dung, tìm khe lớn nhất bên trong trang. Phần tử `sticky` (thanh điều hướng tài khoản) là nội dung thật nên tính vào;
      // chỉ `fixed` mới bị loại. Trang ngắn hơn khung nhìn thì chân trang bị đẩy xuống đáy (`flex-1` ở layout.tsx): khe giữa nội dung và chân trang là thiết kế, không tính.
      const fixedOnly = (el: Element): boolean => {
        for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true;
        return false;
      };
      const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const inFooter = (el: Element): boolean => !!el.closest('footer');
      const spans: [number, number, boolean][] = [...textBoxes, ...rawOnly]
        .filter(({ el }) => !fixedOnly(el))
        .map(({ el, raw }) => [raw[0], raw[1], inFooter(el)] as [number, number, boolean])
        .concat(
          all
            .filter(
              (el) =>
                !hidden(el) &&
                shown(el) &&
                !fixedOnly(el) &&
                // Thẻ ảnh dựng bằng nền CSS (ảnh thương hiệu thay ảnh sản phẩm) là nội dung thật dù không có chữ trong DOM.
                (el.matches('img, svg, video, canvas, input, select, textarea, button') || (getComputedStyle(el).backgroundImage !== 'none' && el.getBoundingClientRect().height >= 40)),
            )
            .map((el) => {
              const r = el.getBoundingClientRect();
              return [r.top + window.scrollY, r.bottom + window.scrollY, inFooter(el)] as [number, number, boolean];
            }),
        )
        .sort((a, b) => a[0] - b[0]);
      let maxGap = { y: 0, h: 0 };
      let reach = spans[0]?.[1] ?? 0;
      for (const [t, b, footer] of spans) {
        const byDesign = footer && docHeight <= vh + 2;
        if (!byDesign && t - reach > maxGap.h) maxGap = { y: Math.round(reach), h: Math.round(t - reach) };
        reach = Math.max(reach, b);
      }

      let minL = Infinity;
      let maxR = 0;
      for (const { el, r } of textBoxes) {
        if (fixedAncestor(el)) continue;
        minL = Math.min(minL, r.left);
        maxR = Math.max(maxR, r.right);
      }

      return {
        vw,
        vh,
        docH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        overflowX,
        rightOverflow,
        cutText: cutText.slice(0, 10),
        ellipsizedCta: ellipsizedCta.slice(0, 6),
        textOverlap,
        floating,
        bottomBars,
        capsule: capsuleHits,
        grids: grids.slice(0, 8),
        maxVerticalGap: maxGap,
        contentSpan: Number.isFinite(minL) ? Math.round(((maxR - minL) / vw) * 100) / 100 : 0,
      };
    },
    { capsule: options.capsule },
  );
  const layout = await probeLayout(page, { ignoreNumeric: ['[data-testid="coupon-discount"]'] });
  // Cuối cùng vì probeTapTargets cuộn từng điều khiển vào giữa khung nhìn.
  const small = options.touch ? await probeTapTargets(page) : [];
  return { ...base, small, notTabular: layout.notTabular, stickyBar: layout.stickyBar };
}
