import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVIEW_COMMENT_MAX, ratingFromKey, reviewCommentLength, reviewFormIssue } from './review-form';

describe('reviewFormIssue: lỗi trước khi gửi đánh giá', () => {
  it('1 tới 5 sao, nhận xét trống hoặc tới 2.000 ký tự: gửi được', () => {
    for (const rating of [1, 2, 3, 4, 5]) expect(reviewFormIssue({ rating, comment: '' })).toBeNull();
    expect(reviewFormIssue({ rating: 5, comment: 'a'.repeat(REVIEW_COMMENT_MAX) })).toBeNull();
  });

  it('số sao ngoài 1–5 hoặc không nguyên: lỗi ở hàng sao, nói rõ phải chọn', () => {
    for (const rating of [0, 6, -1, 2.5, Number.NaN]) {
      expect(reviewFormIssue({ rating, comment: 'Hàng tốt' })).toEqual({ field: 'rating', message: 'Chọn từ 1 đến 5 sao để gửi đánh giá.' });
    }
  });

  it('nhận xét quá 2.000 ký tự: lỗi ở ô nhận xét, nêu trần và số đang có', () => {
    expect(reviewFormIssue({ rating: 4, comment: 'a'.repeat(2001) })).toEqual({
      field: 'comment',
      message: 'Nhận xét tối đa 2.000 ký tự, bạn đang có 2.001 ký tự.',
    });
  });

  it('sao sai thì báo sao trước (thứ tự trên màn)', () => {
    expect(reviewFormIssue({ rating: 0, comment: 'a'.repeat(3000) })?.field).toBe('rating');
  });

  it('đếm như API: bỏ khoảng trắng hai đầu, emoji một ký tự', () => {
    expect(reviewCommentLength('  Tốt  ')).toBe(3);
    expect(reviewCommentLength('😀😀')).toBe(2);
    expect(reviewFormIssue({ rating: 5, comment: `${' '.repeat(50)}${'a'.repeat(REVIEW_COMMENT_MAX)}${' '.repeat(50)}` })).toBeNull();
    expect(reviewFormIssue({ rating: 5, comment: '😀'.repeat(REVIEW_COMMENT_MAX) })).toBeNull();
  });

  it('trần khớp DTO của API', () => {
    const dto = readFileSync(resolve(__dirname, '../../../../apps/api/src/modules/reviews/dto/review.dto.ts'), 'utf8');
    expect(dto).toMatch(new RegExp(`@MaxLength\\(${REVIEW_COMMENT_MAX}\\) comment\\?: string`));
  });
});

describe('ratingFromKey: phím trên hàng sao theo mẫu radio group', () => {
  it('phải/xuống tới sao kế, trái/lên lùi một sao', () => {
    expect(ratingFromKey('ArrowRight', 3)).toBe(4);
    expect(ratingFromKey('ArrowDown', 3)).toBe(4);
    expect(ratingFromKey('ArrowLeft', 3)).toBe(2);
    expect(ratingFromKey('ArrowUp', 3)).toBe(2);
  });

  it('đi vòng ở hai đầu; Home 1 sao, End 5 sao', () => {
    expect(ratingFromKey('ArrowRight', 5)).toBe(1);
    expect(ratingFromKey('ArrowLeft', 1)).toBe(5);
    expect(ratingFromKey('Home', 4)).toBe(1);
    expect(ratingFromKey('End', 2)).toBe(5);
  });

  it('số sao sai (0) thì phải tới 1 sao, trái tới 5 sao', () => {
    expect(ratingFromKey('ArrowRight', 0)).toBe(1);
    expect(ratingFromKey('ArrowLeft', 0)).toBe(5);
  });

  it('Enter, Space và phím khác: null (nút sao tự bấm như nút thường)', () => {
    for (const key of ['Enter', ' ', 'Tab', 'a']) expect(ratingFromKey(key, 3)).toBeNull();
  });
});
