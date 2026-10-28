import { describe, expect, it } from 'vitest';
import { EDIT_HINT, FIRST_REVIEW_ONLY, REWARD_ALREADY_GIVEN, rewardHint } from './review-copy';

const base = { isEdit: false, rewardAvailable: true, hasImages: false, hasVideo: false };

describe('rewardHint — câu thưởng dưới form đánh giá, một bản cho Mini App và web', () => {
  it('sửa đánh giá: nói thẳng không cộng thêm, bất kể có ảnh/video', () => {
    expect(rewardHint({ ...base, isEdit: true, hasVideo: true })).toBe(EDIT_HINT);
  });

  it('đã nhận thưởng sản phẩm này: không hứa điểm nữa', () => {
    expect(rewardHint({ ...base, rewardAvailable: false, hasVideo: true })).toBe(REWARD_ALREADY_GIVEN);
  });

  it('chưa có ảnh/video: mời cả video (+15.000) lẫn ảnh (+10.000), chữ thuần +5.000', () => {
    expect(rewardHint(base)).toBe(
      `${FIRST_REVIEW_ONLY}: thêm video +15.000 / ảnh +10.000 Điểm Xanh (chỉ chữ +5.000). Chỉ đánh giá được khi đã mua và nhận hàng.`,
    );
  });

  it('có ảnh: nêu +10.000 và mời thêm video để lên +15.000', () => {
    expect(rewardHint({ ...base, hasImages: true })).toBe(
      `${FIRST_REVIEW_ONLY}, bạn nhận +10.000 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15.000.`,
    );
  });

  it('có video (kể cả cùng ảnh): mức +15.000', () => {
    const line = `Tuyệt! ${FIRST_REVIEW_ONLY}, đánh giá có video nhận +15.000 Điểm Xanh!`;
    expect(rewardHint({ ...base, hasVideo: true })).toBe(line);
    expect(rewardHint({ ...base, hasVideo: true, hasImages: true })).toBe(line);
  });
});
