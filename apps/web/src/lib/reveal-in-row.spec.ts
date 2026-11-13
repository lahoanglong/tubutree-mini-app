import { describe, expect, it } from 'vitest';
import { revealInRow } from './reveal-in-row';

const box = (left: number, right: number) => ({ left, right, top: 0, bottom: 44, width: right - left, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
const row = (left: number, right: number, scrollLeft = 0, clientWidth = right - left) => ({ clientWidth, scrollLeft, getBoundingClientRect: () => box(left, right) }) as unknown as HTMLElement;
const item = (left: number, right: number) => ({ getBoundingClientRect: () => box(left, right) }) as unknown as HTMLElement;

describe('revealInRow', () => {
  it('phần tử bị đẩy ra ngoài mép phải thì cuộn vừa đủ để nằm trọn, cách mép 16px', () => {
    const r = row(0, 800);
    revealInRow(r, item(800, 898));
    expect(r.scrollLeft).toBe(114);
  });

  it('phần tử đã nằm trong khung (cách mép ≥ 16px) thì không cuộn', () => {
    const r = row(0, 800, 40);
    revealInRow(r, item(673, 771));
    expect(r.scrollLeft).toBe(40);
  });

  it('phần tử chạm hoặc vượt mép trái thì cuộn ngược về, cách mép 16px', () => {
    const r = row(0, 800, 200);
    revealInRow(r, item(-30, 68));
    expect(r.scrollLeft).toBe(154);
  });

  it('phần tử rộng hơn khung thì canh theo mép đầu, không đẩy mép đầu ra ngoài', () => {
    const r = row(0, 300);
    revealInRow(r, item(100, 700));
    expect(r.scrollLeft).toBe(84);
  });

  it('hàng đang ẩn (clientWidth 0, như thanh đầu dưới md) thì bỏ qua', () => {
    const r = row(0, 0, 5, 0);
    revealInRow(r, item(900, 1000));
    expect(r.scrollLeft).toBe(5);
  });
});
