import { GoneException } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import type { WalletService } from './wallet.service';
import type { RewardPointsService } from './reward-points.service';

// PD-3 (spec 5, 7.1, T18): hai route xu cũ giữ lại một bản phát hành để client lạ nhận 410 đọc được.
describe('WalletController — route TubuXu đã ngừng (PD-3)', () => {
  const wallet = { convertToXu: jest.fn(() => Promise.reject(new GoneException('Đổi Ví sang xu đã ngừng.'))) };
  const rewards = { getReferralOverview: jest.fn() };
  const ctl = new WalletController(wallet as unknown as WalletService, rewards as unknown as RewardPointsService);

  it('POST /wallet/convert-xu → 410, không phụ thuộc body', async () => {
    await expect(ctl.convertXu()).rejects.toBeInstanceOf(GoneException);
    expect(wallet.convertToXu).toHaveBeenCalledTimes(1);
  });

  it('POST /wallet/withdraw → 410 (chính sách Zalo 4.5), không đụng service', () => {
    let err: unknown;
    try {
      ctl.withdraw();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GoneException);
    expect((err as GoneException).getStatus()).toBe(410);
    expect((err as Error).message).toMatch(/không rút ra ngoài/);
  });

  it('GET /me/coins → 410, chỉ dẫn sang /me/referral và Điểm Xanh', () => {
    let err: unknown;
    try {
      ctl.coinsOverview();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GoneException);
    expect((err as GoneException).getStatus()).toBe(410);
    expect((err as Error).message).toMatch(/Điểm Xanh/);
    expect((err as Error).message).not.toMatch(/TubuXu/);
  });

  it('GET /me/referral vẫn hoạt động', async () => {
    rewards.getReferralOverview.mockResolvedValue({ successCount: 1 });
    await expect(ctl.referralOverview('u1')).resolves.toEqual({ successCount: 1 });
  });
});
