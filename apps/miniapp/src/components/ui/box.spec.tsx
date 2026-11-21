import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Box, boxSpacing } from './box';

/**
 * Box nội bộ thay `Box` của zmp-ui: khoảng cách phải ra đúng giá trị mà zaui.css gốc cho ra với cùng prop, kể cả khi hai lớp cùng chạm một cạnh
 * (lớp đứng sau trong tệp thắng). Chuẩn đối chiếu đọc thẳng các luật `.zaui-box-*` của zaui.css trong node_modules, áp theo thứ tự tệp.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const ZAUI_CSS = fs.readFileSync(path.join(fs.realpathSync(path.resolve(here, '../../../node_modules/zmp-ui')), 'zaui.css'), 'utf8');
const SPACE_KEYS = ['m', 'p', 'mt', 'ml', 'mb', 'mr', 'mx', 'my', 'pt', 'pl', 'pb', 'pr', 'px', 'py'] as const;

/** Luật một-lớp `.zaui-box-<x>` theo thứ tự tệp. */
const RULES = (() => {
  const out: { cls: string; decls: [string, string][] }[] = [];
  postcss.parse(ZAUI_CSS).walkRules((rule) => {
    const m = /^\.(zaui-box-[a-z0-9-]+)$/.exec(rule.selector.trim());
    if (!m) return;
    const decls: [string, string][] = [];
    rule.walkDecls((d) => {
      decls.push([d.prop, d.value]);
    });
    out.push({ cls: m[1]!, decls });
  });
  return out;
})();

const px = (v: string): number => {
  const calc = /^calc\((\d+)\s*\*\s*4px\)$/.exec(v);
  if (calc) return Number(calc[1]) * 4;
  const plain = /^(\d+)(px)?$/.exec(v);
  if (plain) return Number(plain[1]);
  throw new Error(`giá trị lạ trong zaui.css: ${v}`);
};

/** Giá trị cạnh mà zaui.css cho ra với tập lớp của zmp-ui Box (`zaui-box-<prop>-<n>`). */
function zauiSpacing(props: Partial<Record<(typeof SPACE_KEYS)[number], number>>): Record<string, number> {
  const classes = new Set(Object.entries(props).map(([k, v]) => `zaui-box-${k}-${v}`));
  const out: Record<string, number> = {};
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  for (const rule of RULES) {
    if (!classes.has(rule.cls)) continue;
    for (const [prop, value] of rule.decls) {
      const shorthand = /^(margin|padding)$/.exec(prop);
      if (shorthand) for (const s of sides) out[`${shorthand[1]}${s}`] = px(value);
      const long = /^(margin|padding)-(top|right|bottom|left)$/.exec(prop);
      if (long) out[`${long[1]}${long[2]![0]!.toUpperCase()}${long[2]!.slice(1)}`] = px(value);
    }
  }
  return out;
}

describe('boxSpacing — trùng zaui.css gốc', () => {
  it('đọc được đủ luật khoảng cách 0–10 của zaui.css', () => {
    for (const k of SPACE_KEYS) for (let n = 0; n <= 10; n++) expect(RULES.some((r) => r.cls === `zaui-box-${k}-${n}`), `${k}-${n}`).toBe(true);
  });

  it('các tổ hợp đang dùng trong Mini (p+pt, px+pt, mt+p, mx+mt…)', () => {
    for (const props of [{ p: 3, pt: 2 }, { px: 3, pt: 2 }, { pt: 4, pb: 2, px: 4 }, { mt: 2, p: 4 }, { mx: 4, mt: 2 }, { p: 5 }, { mt: 6, px: 4 }, { mb: 2 }, { px: 3 }]) {
      expect(boxSpacing(props), JSON.stringify(props)).toEqual(zauiSpacing(props));
    }
    expect(boxSpacing({ p: 3, pt: 2 }).paddingTop).toBe(12);
  });

  it('600 tổ hợp ngẫu nhiên xác định (2–5 thuộc tính, bậc 0–10)', () => {
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 600; i++) {
      const props: Partial<Record<(typeof SPACE_KEYS)[number], number>> = {};
      const count = 2 + rand(4);
      for (let j = 0; j < count; j++) props[SPACE_KEYS[rand(SPACE_KEYS.length)]!] = rand(11);
      expect(boxSpacing(props), JSON.stringify(props)).toEqual(zauiSpacing(props));
    }
  });
});

describe('Box — khung div', () => {
  it('flex và flexDirection đều bật display:flex (flexDirection một mình cũng bật, như zmp-ui); căn chỉnh đi kèm', () => {
    render(
      <>
        <Box data-testid="a" flex alignItems="center" justifyContent="space-between" />
        <Box data-testid="b" flexDirection="column" />
        <Box data-testid="c" alignItems="center" />
      </>,
    );
    const a = screen.getByTestId('a');
    expect(a.style.display).toBe('flex');
    expect(a.style.alignItems).toBe('center');
    expect(a.style.justifyContent).toBe('space-between');
    expect(screen.getByTestId('b').style.display).toBe('flex');
    expect(screen.getByTestId('b').style.flexDirection).toBe('column');
    expect(screen.getByTestId('c').style.display).toBe('');
  });

  it('style của nơi gọi thắng khoảng cách; đặt cả cụm padding thì không còn cạnh lẻ', () => {
    render(
      <>
        <Box data-testid="a" p={4} style={{ paddingTop: 0, background: 'red' }} />
        <Box data-testid="b" p={4} mt={2} style={{ padding: '6px 10px' }} />
      </>,
    );
    const a = screen.getByTestId('a');
    expect(a.style.paddingTop).toBe('0px');
    expect(a.style.paddingLeft).toBe('16px');
    expect(a.style.background).toBe('red');
    const b = screen.getByTestId('b');
    expect(b.style.padding).toBe('6px 10px');
    expect(b.style.marginTop).toBe('8px');
  });

  it('chuyển nguyên id, role, aria-*, data-*, className, onClick và children xuống div', () => {
    const onClick = vi.fn();
    render(
      <Box id="x" role="button" aria-label="Mở" data-pdp-block="main" className="tubu-press" onClick={onClick}>
        nội dung
      </Box>,
    );
    const el = screen.getByRole('button', { name: 'Mở' });
    expect(el.tagName).toBe('DIV');
    expect(el.id).toBe('x');
    expect(el.getAttribute('data-pdp-block')).toBe('main');
    expect(el.className).toBe('tubu-press');
    expect(el.textContent).toBe('nội dung');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
