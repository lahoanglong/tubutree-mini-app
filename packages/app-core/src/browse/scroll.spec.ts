import { describe, expect, it } from 'vitest';
import { scrollDeltaToListTop } from './scroll';

describe('scrollDeltaToListTop', () => {
  it('điểm đánh dấu đã trượt lên trên vạch dính: trả độ lệch âm để kéo về đúng đầu danh sách', () => {
    expect(scrollDeltaToListTop(-1900, 58)).toBe(-1958);
    expect(scrollDeltaToListTop(0, 58)).toBe(-58);
  });

  it('còn ở trên hoặc đúng vạch dính: không cuộn', () => {
    expect(scrollDeltaToListTop(58, 58)).toBe(0);
    expect(scrollDeltaToListTop(300, 58)).toBe(0);
  });

  it('số đo hỏng (NaN) thì không cuộn', () => {
    expect(scrollDeltaToListTop(Number.NaN, 58)).toBe(0);
  });
});
