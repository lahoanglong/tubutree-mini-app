import { describe, expect, it } from 'vitest';
import {
  EDIT_HINT,
  FIRST_REVIEW_ONLY,
  REVIEW_PENDING_SAVED,
  REWARD_ALREADY_GIVEN,
  greenCornerHint,
  greenCornerRules,
  pendingNotice,
  rewardHint,
} from './review-copy';

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

  it('bản build không tải được video: không mời video, chỉ nói ảnh và chữ', () => {
    const off = { ...base, canUploadVideo: false };
    expect(rewardHint(off)).toBe(
      `${FIRST_REVIEW_ONLY}: thêm ảnh +10.000 Điểm Xanh (chỉ chữ +5.000). Chỉ đánh giá được khi đã mua và nhận hàng.`,
    );
    expect(rewardHint({ ...off, hasImages: true })).toBe(`${FIRST_REVIEW_ONLY}, bạn nhận +10.000 Điểm Xanh cho đánh giá có ảnh!`);
    expect(rewardHint({ ...off, isEdit: true })).toBe(EDIT_HINT);
    expect(rewardHint({ ...off, rewardAvailable: false })).toBe(REWARD_ALREADY_GIVEN);
  });

  it('không nói rõ canUploadVideo thì coi như tải được (Mini App cũ, bản có Cloudinary)', () => {
    expect(rewardHint({ ...base, canUploadVideo: true })).toBe(rewardHint(base));
  });
});

describe('Góc Sống Xanh: câu thưởng và lời báo chờ duyệt', () => {
  const rules = { rewardPoints: 100, dailyCap: 3, maxPhotos: 3 };
  const gc = { isEdit: false, rewardAvailable: true, hasMedia: false, rules };

  it('cờ tắt hay API cũ → null (form như cũ)', () => {
    expect(greenCornerRules(undefined)).toBeNull();
    expect(greenCornerRules({ enabled: false, ...rules })).toBeNull();
    expect(greenCornerRules({ enabled: true, ...rules })).toEqual(rules);
  });

  it('chưa có ảnh: mời thêm ảnh, nói số điểm của cấu hình, sau khi duyệt, trần theo ngày', () => {
    expect(greenCornerHint(gc)).toBe('Thêm ảnh thật (tối đa 3) để nhận +100 Điểm Xanh sau khi Tubu duyệt. Mỗi ngày tối đa 3 đánh giá được cộng.');
  });

  it('có ảnh: cộng sau khi duyệt; số lớn có dấu chấm nghìn', () => {
    expect(greenCornerHint({ ...gc, hasMedia: true, rules: { ...rules, rewardPoints: 1500 } })).toBe(
      'Tubu duyệt ảnh xong sẽ cộng +1.500 Điểm Xanh. Mỗi ngày tối đa 3 đánh giá được cộng.',
    );
  });

  it('không hứa điểm khi lần mua này hết thưởng, hoặc cấu hình 0', () => {
    expect(greenCornerHint({ ...gc, rewardAvailable: false })).toBe(
      'Đánh giá có ảnh (tối đa 3) được Tubu duyệt trước khi hiện công khai. Lần mua này không cộng thêm Điểm Xanh.',
    );
    expect(greenCornerHint({ ...gc, rules: { ...rules, rewardPoints: 0 } })).not.toContain('Điểm Xanh');
    expect(greenCornerHint({ ...gc, rules: { ...rules, dailyCap: 0 } })).not.toContain('Điểm Xanh');
  });

  it('sửa: báo đổi ảnh thì duyệt lại, không cộng thêm', () => {
    expect(greenCornerHint({ ...gc, isEdit: true })).toContain('duyệt lại');
  });

  it('lời báo chờ duyệt nêu đơn khi biết', () => {
    expect(pendingNotice('TB-9')).toBe('Đánh giá cho đơn TB-9 của bạn đang chờ Tubu duyệt ảnh nên chưa hiện công khai.');
    expect(pendingNotice(null)).toBe('Đánh giá của bạn đang chờ Tubu duyệt ảnh nên chưa hiện công khai.');
    expect(REVIEW_PENDING_SAVED).toContain('chờ Tubu duyệt');
  });
});
