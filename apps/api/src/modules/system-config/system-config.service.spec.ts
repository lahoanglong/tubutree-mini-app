import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SystemConfigService } from './system-config.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(opts: {
  existing?: { value: unknown } | null;
  findUnique?: jest.Mock;
  upsert?: jest.Mock;
  historyCreate?: jest.Mock;
}) {
  const findUnique = opts.findUnique ?? jest.fn().mockResolvedValue(opts.existing ?? null);
  const upsert = opts.upsert ?? jest.fn().mockResolvedValue({});
  const historyCreate = opts.historyCreate ?? jest.fn().mockResolvedValue({});
  const base: Record<string, unknown> = {
    systemConfig: { findUnique, upsert },
    systemConfigHistory: { create: historyCreate },
  };
  base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));
  return { prisma: base as unknown as PrismaService, findUnique, upsert, historyCreate };
}

describe('SystemConfigService.get', () => {
  it('trả giá trị từ DB khi có row, và cache lại cho lần gọi sau', async () => {
    const { prisma, findUnique } = makePrisma({
      findUnique: jest.fn().mockResolvedValue({ value: 200000 }),
    });
    const service = new SystemConfigService(prisma);
    expect(await service.get<number>('shipping.free_threshold')).toBe(200000);
    expect(await service.get<number>('shipping.free_threshold')).toBe(200000);
    expect(findUnique).toHaveBeenCalledTimes(1); // lần 2 lấy từ cache, không query lại
  });

  it('không có row + không fallback → NotFoundException', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    await expect(service.get('missing.key')).rejects.toThrow(NotFoundException);
  });

  it('không có row + có fallback → trả fallback VÀ cache lại (không query DB lần sau)', async () => {
    const { prisma, findUnique } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    expect(await service.get('shipping.free_threshold', 200000)).toBe(200000);
    expect(await service.get('shipping.free_threshold', 200000)).toBe(200000);
    // Trước fix: mỗi lần get() key vắng mặt đều query DB (route @Public /config/public bị ảnh hưởng).
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('SystemConfigService.set', () => {
  it('chặn ghi value null/undefined để tránh crash nơi khác đọc get<T>() không validate runtime', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    await expect(service.set('wallet.withdraw_min', null as unknown as number, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('chặn đổi kiểu dữ liệu so với giá trị hiện tại (number → string)', async () => {
    const { prisma, upsert } = makePrisma({ existing: { value: 100000 } });
    const service = new SystemConfigService(prisma);
    await expect(service.set('wallet.withdraw_min', 'khong-phai-so' as unknown as number, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('cho phép ghi cùng kiểu dữ liệu, ghi history đúng oldValue/newValue', async () => {
    const { prisma, upsert, historyCreate } = makePrisma({ existing: { value: 100000 } });
    const service = new SystemConfigService(prisma);
    await service.set('wallet.withdraw_min', 150000, 'admin1');
    expect(historyCreate).toHaveBeenCalledWith({
      data: { key: 'wallet.withdraw_min', oldValue: 100000, newValue: 150000, changedBy: 'admin1' },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'wallet.withdraw_min' },
        update: { value: 150000, updatedBy: 'admin1' },
      }),
    );
  });

  it('key chưa tồn tại + không có dấu chấm → category = misc (không phải chính key đó)', async () => {
    const { prisma, upsert } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    await service.set('maintenanceMode', true, 'admin1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: 'maintenanceMode', value: true, category: 'misc', updatedBy: 'admin1' },
      }),
    );
  });

  it('key có dấu chấm → category = phần trước dấu chấm đầu tiên', async () => {
    const { prisma, upsert } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    await service.set('shipping.free_threshold', 200000, 'admin1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: 'shipping.free_threshold', value: 200000, category: 'shipping', updatedBy: 'admin1' },
      }),
    );
  });

  it('set() xoá cache của key để lần get() tiếp theo đọc giá trị mới', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ value: 100000 }) // get() ban đầu
      .mockResolvedValueOnce({ value: 100000 }) // set() đọc existing trong transaction
      .mockResolvedValueOnce({ value: 150000 }); // get() sau khi set() xoá cache
    const { prisma } = makePrisma({ findUnique });
    const service = new SystemConfigService(prisma);
    expect(await service.get<number>('wallet.withdraw_min')).toBe(100000);
    await service.set('wallet.withdraw_min', 150000, 'admin1');
    expect(await service.get<number>('wallet.withdraw_min')).toBe(150000);
  });
});

/**
 * Kiểm tra kiểu không cứu được lỗi ĐƠN VỊ. Mô tả trong seed ghi "User nhận 70%" nhưng giá trị
 * thật là 0.7 — admin nâng lên 80% rất dễ gõ "80": hoa hồng 50.000đ thành 4.000.000đ cộng thẳng
 * vào ví rút được, và sau khi đã trả thì không đòi lại được.
 */
describe('SystemConfigService.set — biên đơn vị cho khoá nhạy cảm', () => {
  function mk() {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: 0.7 }), upsert: jest.fn().mockResolvedValue({}) },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { svc: new SystemConfigService(prisma), tx };
  }

  it('tỉ lệ chia hoa hồng gõ 80 thay vì 0.8 → từ chối, không ghi gì', async () => {
    const { svc, tx } = mk();
    await expect(svc.set('cashback.merchant_user_share', 80, 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('tỉ lệ âm → từ chối (trước đây trừ ngược vào ví user)', async () => {
    const { svc } = mk();
    await expect(svc.set('cashback.merchant_user_share', -0.5, 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('0.8 hợp lệ → ghi bình thường', async () => {
    const { svc, tx } = mk();
    await svc.set('cashback.merchant_user_share', 0.8, 'admin1');
    expect(tx.systemConfig.upsert).toHaveBeenCalled();
  });

  it('cùng hậu tố _pct nhưng khác đơn vị: groupbuy nhận 15 (phần trăm nguyên), subscribe từ chối 15', async () => {
    const a = mk();
    await a.svc.set('groupbuy.discount_pct', 15, 'admin1');
    expect(a.tx.systemConfig.upsert).toHaveBeenCalled();

    const b = mk();
    await expect(b.svc.set('subscribe.discount_pct', 15, 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('khoá không nằm trong bảng → không bị ràng buộc thêm', async () => {
    const { svc, tx } = mk();
    await svc.set('shipping.free_threshold', 500000, 'admin1');
    expect(tx.systemConfig.upsert).toHaveBeenCalled();
  });
});

describe('SystemConfigService.set — khoá seed null = "chưa đặt" (ETA giao hàng, C-054)', () => {
  function mk(existing: { value: unknown } | null) {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(existing), upsert: jest.fn().mockResolvedValue({}) },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { svc: new SystemConfigService(prisma), tx };
  }

  it('dòng đang null → đặt được số (null không bị coi là kiểu "object" chặn đổi kiểu), history ghi oldValue là JSON null', async () => {
    const { svc, tx } = mk({ value: null });
    await svc.set('shipping.eta_min_days', 2, 'admin1');
    expect(tx.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: 2, updatedBy: 'admin1' } }));
    expect(tx.systemConfigHistory.create).toHaveBeenCalledWith({
      data: { key: 'shipping.eta_min_days', oldValue: Prisma.JsonNull, newValue: 2, changedBy: 'admin1' },
    });
  });

  it('dòng đã có số → vẫn chặn đổi sang chuỗi (luật đổi kiểu không đổi)', async () => {
    const { svc } = mk({ value: 2 });
    await expect(svc.set('shipping.eta_min_days', 'hai' as unknown as number, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SystemConfigService.set — biên cho khoá hạn ngày (đúng tên khoá code đọc)', () => {
  function mk() {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: 7 }), upsert: jest.fn().mockResolvedValue({}) },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { svc: new SystemConfigService(prisma), tx };
  }

  it("returns.window_days (khoá orders/affiliate đọc) bị giới hạn 0–365", async () => {
    await expect(mk().svc.set('returns.window_days', 400, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    const ok = mk();
    await ok.svc.set('returns.window_days', 10, 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
  });

  it.each(['shipping.eta_min_days', 'shipping.eta_max_days'])('%s (ETA đặt hàng thành công) bị giới hạn 0–60', async (key) => {
    await expect(mk().svc.set(key, -1, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(mk().svc.set(key, 61, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(mk().svc.set(key, '3', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    for (const v of [0, 3, 60]) {
      const ok = mk();
      await ok.svc.set(key, v, 'admin1');
      expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    }
  });

  it('dealer.reward_claim_grace_days bị giới hạn 0–366', async () => {
    await expect(mk().svc.set('dealer.reward_claim_grace_days', -1, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(mk().svc.set('dealer.reward_claim_grace_days', 367, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    const ok = mk();
    await ok.svc.set('dealer.reward_claim_grace_days', 30, 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
  });

  it('dealer.bonus_topup_window_days là số ngày nguyên 0–120 (0 = tắt trả bù thưởng quý)', async () => {
    for (const bad of [-1, 121, 30.5]) {
      await expect(mk().svc.set('dealer.bonus_topup_window_days', bad, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    }
    for (const v of [0, 60, 120]) {
      const ok = mk();
      await ok.svc.set('dealer.bonus_topup_window_days', v, 'admin1');
      expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    }
  });

  // Cron cấp mã giảm giá đọc thẳng các khoá voucher.* — gõ nhầm đơn vị/số âm sẽ cấp mã hàng loạt sai giá trị.
  it.each([
    ['voucher.welcome_amount', 30_000, [0, -1, 999, 1_000_001]],
    ['voucher.birthday_amount', 50_000, [0, -5000, 1_000_001]],
    ['voucher.winback_amount', 50_000, [0, -5000, 1_000_001]],
    ['voucher.welcome_min_order', 199_000, [-1, 50_000_001]],
    ['voucher.winback_days', 60, [0, -1, 366]],
  ] as const)('%s: nhận giá trị hợp lý, từ chối %j ngoài biên', async (key, fine, badValues) => {
    const ok = mk();
    await ok.svc.set(key, fine, 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    for (const v of badValues) {
      await expect(mk().svc.set(key, v, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(mk().svc.set(key, '30000' as unknown as number, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SystemConfigService.set — biên cho khoá tiền/điểm/thanh toán (ADMINOPS-3)', () => {
  function mk(existing: unknown = null) {
    const tx = {
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(existing === null ? null : { value: existing }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { svc: new SystemConfigService(prisma), tx };
  }

  it.each([
    ['shipping.flat_fee_below_threshold', 19_000, [-19_000, 1_000_001, 1.5]],
    ['shipping.free_threshold', 200_000, [-1, 50_000_001]],
    ['loyalty.earn_pct', 2, [0, 0.05, 20.5, 100, -1]],
    ['referral.min_order_amount', 200_000, [-5]],
    ['groupbuy.max_open_per_user', 3, [-3, 0, 101]],
    ['game.max_plots', 5, [0, 100_000]],
    ['game.spin_voucher_min_order_multiplier', 6, [0, 0.5, 51]],
  ] as const)('%s: nhận %d, từ chối %j', async (key, fine, badValues) => {
    const ok = mk(fine);
    await ok.svc.set(key, fine, 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    for (const v of badValues) {
      const bad = mk(fine);
      await expect(bad.svc.set(key, v, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(bad.tx.systemConfig.upsert).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['payment.bank_account_no', '9984606774', ['abc 12', '', '12345', '1'.repeat(21), 9984606774]],
    ['payment.bank_bin', '970407', ['', '97040', '9704071', 'abcdef']],
    // R4-ADMIN-8: trang chuyển khoản của khách in hai dòng này — để trống là khách thấy "Ngân hàng: " trống trơn.
    ['payment.bank_name', 'Techcombank', ['', '   ', 970407, 'x'.repeat(101)]],
    ['payment.bank_account_name', 'CONG TY TUBU TREE', ['', ' \t ', 1, 'X'.repeat(101)]],
    ['shipping.tier_freeship_overrides', { LOC_BIEC: 99_000, DAI_THU: 0 }, [{ CO_THU: -50_000 }, { CO_THU: 1.5 }, [1], 'x']],
    [
      'subscribe.discount_tiers',
      [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }],
      [[{ minActive: 1, pct: 1.5 }], [{ minActive: 0, pct: 0.1 }], [{ minActive: 1, pct: -0.1 }], { pct: 0.1 }],
    ],
    [
      'community.banned_keywords',
      ['cá độ', 'vay nong'],
      ['casino', [''], ['   '], [1], [{ w: 'x' }], ['x'.repeat(61)], Array.from({ length: 301 }, (_, i) => `t${i}`)],
    ],
    // Vai trò hưởng hoa hồng CTV: rỗng là không ai hưởng, sai tên vai trò là âm thầm về mặc định — chặn ngay lúc ghi.
    ['affiliate.commission_eligible_roles', ['AFFILIATE', 'DEALER'], [[], 'AFFILIATE', ['CTV'], ['AFFILIATE', 1], { AFFILIATE: true }]],
    // Bậc thưởng doanh số quý đại lý (DealerService.bonusTiers): ngưỡng tăng dần không trùng, % trong (0, 10], không giảm, tối đa 1 chữ số lẻ, không rỗng.
    [
      'dealer.quarterly_bonus_tiers',
      [{ min: 50_000_000, pct: 3 }, { min: 100_000_000, pct: 4.5 }],
      [
        [{ min: 50_000_000, pct: 4 }, { min: 100_000_000, pct: 3 }],
        [{ min: 50_000_000, pct: 2.5 }, { min: 100_000_000, pct: 3 }, { min: 200_000_000, pct: 2.9 }],
        [{ min: 50_000_000, pct: 2.55 }],
        [{ min: 50_000_000, pct: 3.333 }],
        [{ min: 50_000_000, pct: 0.05 }],
        [],
        'x',
        { min: 50_000_000, pct: 3 },
        [{ min: 50_000_000, pct: 3 }, { min: 50_000_000, pct: 4 }],
        [{ min: 100_000_000, pct: 3 }, { min: 50_000_000, pct: 4 }],
        [{ min: 0, pct: 3 }],
        [{ min: -1, pct: 3 }],
        [{ min: 50_000_000.5, pct: 3 }],
        [{ min: '50000000', pct: 3 }],
        [{ min: 50_000_000, pct: 0 }],
        [{ min: 50_000_000, pct: -2 }],
        [{ min: 50_000_000, pct: 10.5 }],
        [{ min: 50_000_000, pct: 300 }],
        [{ min: 50_000_000, pct: '3' }],
        [{ min: 50_000_000, pct: null }],
        [{ min: 50_000_000 }],
        [{ pct: 3 }],
        [{ min: 50_000_000, percent: 3 }],
        [{ min: 50_000_000, pct: 3, note: 'x' }],
        [null],
        [[50_000_000, 3]],
        Array.from({ length: 11 }, (_, i) => ({ min: (i + 1) * 10_000_000, pct: 1 })),
        [{ min: 100_000_000_001, pct: 3 }],
      ],
    ],
    // Cờ gian hàng: chuỗi "false" hay số 0 mà lọt vào thì đọc ra tắt âm thầm, nên chỉ nhận boolean ngay lúc ghi.
    ['storefront.require_approval', true, ['true', 'false', 1, 0, null, {}]],
    ['storefront.subdomain_enabled', false, ['true', 'false', 1, 0, null, []]],
  ] as const)('%s: nhận giá trị hợp lệ, từ chối giá trị sai', async (key, fine, badValues) => {
    const ok = mk(fine);
    await ok.svc.set(key, fine as never, 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    for (const v of badValues) {
      const bad = mk(null);
      await expect(bad.svc.set(key, v as never, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('dealer.quarterly_bonus_tiers: % bằng nhau giữa các bậc và 1 chữ số lẻ được nhận', async () => {
    for (const v of [
      [{ min: 50_000_000, pct: 3 }, { min: 100_000_000, pct: 3 }],
      [{ min: 50_000_000, pct: 2.5 }, { min: 100_000_000, pct: 2.6 }, { min: 200_000_000, pct: 10 }],
      [{ min: 50_000_000, pct: 0.7 }, { min: 100_000_000, pct: 1.1 }, { min: 200_000_000, pct: 2.3 }],
    ]) {
      const ok = mk(v);
      await ok.svc.set('dealer.quarterly_bonus_tiers', v as never, 'admin1');
      expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    }
  });

  it('dealer.quarterly_bonus_tiers: lỗi trả tiếng Việt nêu đúng chỗ sai', async () => {
    const msg = async (v: unknown) =>
      mk(null).svc.set('dealer.quarterly_bonus_tiers', v as never, 'admin1').then(
        () => '',
        (e: Error) => e.message,
      );
    expect(await msg([])).toMatch(/ít nhất một bậc/);
    expect(await msg([{ min: 50_000_000, pct: 3 }, { min: 50_000_000, pct: 4 }])).toMatch(/tăng dần, không trùng/);
    expect(await msg([{ min: 50_000_000, pct: 30 }])).toMatch(/lớn hơn 0 và không quá 10/);
    expect(await msg([{ min: 50_000_000, pct: 4 }, { min: 100_000_000, pct: 3 }])).toMatch(/bậc thứ 2.*không được thấp hơn bậc thứ 1/);
    expect(await msg([{ min: 50_000_000, pct: 2.55 }])).toMatch(/bậc thứ 1.*tối đa 1 chữ số/);
    expect(await msg([{ min: 50_000_000, pct: 3, note: 'x' }])).toMatch(/chỉ gồm "min"/);
  });

  it.each([
    ['attendance.late_fine', 10_000, [-1, 1.5, 500_001]],
    ['game.streak_repair_cost', 150, [-1, 0]],
    ['game.streak_freeze_cost', 80, [-1, 0]],
    ['game.dew_seeds', 15, [-1, 10_001]],
    ['game.daily_login_seeds', 10, [-5]],
    ['game.harvest_coupon_min_order', 199_000, [-1, 50_000_001]],
    ['groupbuy.target_size', 3, [-1, 0, 1, 51]],
    ['referral.window_days', 30, [-1, 0, 366]],
    ['affiliate.attribution_days', 7, [-1, 0, 366]],
    ['flashsale.default_per_user_limit', 5, [-1, 0]],
  ] as const)('round 2 (ADMINOPS-3) %s: nhận %d, từ chối %j', async (key, fine, badValues) => {
    const ok = mk(fine);
    await ok.svc.set(key, fine, 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    for (const v of badValues) {
      const bad = mk(fine);
      await expect(bad.svc.set(key, v, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('ETA giao hàng đặt lại null (ẩn dòng "Giao dự kiến") được; khoá khác vẫn chặn null', async () => {
    const eta = mk(3);
    await eta.svc.set('shipping.eta_min_days', null as never, 'admin1');
    expect(eta.tx.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: Prisma.JsonNull, updatedBy: 'admin1' } }));
    await expect(mk(3).svc.set('game.dew_seeds', null as never, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hasWriteRule: khoá có luật ghi là khoá hệ thống biết, khoá gõ sai thì không', () => {
    expect(SystemConfigService.hasWriteRule('shipping.free_threshold')).toBe(true);
    expect(SystemConfigService.hasWriteRule('payment.bank_bin')).toBe(true);
    expect(SystemConfigService.hasWriteRule('shipping.freeship_threshold_typo')).toBe(false);
  });
});

describe('SystemConfigService.set — phí sàn mặc định của gian hàng đối tác (Q8 review S1)', () => {
  function makeTx(existing: { value: unknown } | null, stores: { id: string; consignmentFeePct: number; consignmentFeeFixed: number }[], withHistory: string[]) {
    const { prisma } = makePrisma({ existing });
    const tx = prisma as unknown as Record<string, unknown>;
    tx.$executeRaw = jest.fn().mockResolvedValue(0);
    tx.$queryRaw = jest.fn().mockResolvedValue(stores);
    const createMany = jest.fn().mockResolvedValue({ count: 0 });
    tx.storefrontTermsHistory = {
      groupBy: jest.fn().mockResolvedValue(withHistory.map((storefrontId) => ({ storefrontId }))),
      createMany,
    };
    return { prisma, tx, createMany };
  }

  it('đổi mặc định 15% → 20%: gian hàng đang theo mặc định được thêm dòng lịch sử 20% từ bây giờ; chưa có lịch sử thì ghi mốc gốc 15% trước', async () => {
    const { prisma, tx, createMany } = makeTx({ value: 0.15 }, [
      { id: 'sf-new', consignmentFeePct: 0.02, consignmentFeeFixed: 3_400 },
      { id: 'sf-old', consignmentFeePct: 0, consignmentFeeFixed: 0 },
    ], ['sf-old']);
    await new SystemConfigService(prisma).set('merchant.commission_pct', 0.2, 'admin-1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const rows = createMany.mock.calls.flatMap((c) => c[0].data);
    expect(rows).toEqual([
      { storefrontId: 'sf-new', commissionPct: 0.15, consignmentFeePct: 0.02, consignmentFeeFixed: 3_400, effectiveFrom: new Date(0) },
      expect.objectContaining({ storefrontId: 'sf-new', commissionPct: 0.2, consignmentFeePct: 0.02, consignmentFeeFixed: 3_400, changedById: 'admin-1' }),
      expect.objectContaining({ storefrontId: 'sf-old', commissionPct: 0.2, changedById: 'admin-1' }),
    ]);
  });

  it('chưa từng đặt khoá: mức cũ là mặc định trong mã (15%); ghi lại đúng số cũ thì không thêm dòng', async () => {
    const first = makeTx(null, [{ id: 'sf-a', consignmentFeePct: 0, consignmentFeeFixed: 0 }], []);
    await new SystemConfigService(first.prisma).set('merchant.commission_pct', 0.1, 'admin-1');
    expect(first.createMany.mock.calls.flatMap((c) => c[0].data).map((r: { commissionPct: number }) => r.commissionPct)).toEqual([0.15, 0.1]);

    const same = makeTx({ value: 0.1 }, [{ id: 'sf-a', consignmentFeePct: 0, consignmentFeeFixed: 0 }], ['sf-a']);
    await new SystemConfigService(same.prisma).set('merchant.commission_pct', 0.1, 'admin-1');
    expect(same.createMany).not.toHaveBeenCalled();
  });
});

describe('SystemConfigService.set — mốc bắt đầu đối soát giao hộ (Q8 review S6)', () => {
  it('chặn thời điểm không có thật hoặc sai dạng; nhận ISO 8601 hợp lệ', async () => {
    const { prisma, upsert } = makePrisma({ existing: { value: '2026-10-14T00:00:00Z' } });
    const service = new SystemConfigService(prisma);
    for (const bad of ['2026-13-01', '2026-02-30T00:00:00Z', 'mai']) {
      await expect(service.set('merchant.consignment_settle_from', bad, 'admin1')).rejects.toThrow(BadRequestException);
    }
    expect(upsert).not.toHaveBeenCalled();
    await service.set('merchant.consignment_settle_from', '2026-11-01T00:00:00+07:00', 'admin1');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe('SystemConfigService.set — nội dung điều khoản/chính sách (D5-01)', () => {
  const keys = ['legal.dieu-khoan', 'legal.bao-mat', 'legal.doi-tra', 'legal.van-chuyen'];

  it('hệ thống biết bốn khoá này dù DB chưa có dòng (admin ghi được lần đầu)', () => {
    for (const key of keys) expect(SystemConfigService.hasWriteRule(key)).toBe(true);
  });

  it('chỉ nhận chuỗi: object/số/null bị từ chối, không ghi gì', async () => {
    const { prisma, upsert } = makePrisma({ existing: { value: '' } });
    const service = new SystemConfigService(prisma);
    for (const bad of [{ a: 1 }, 5, ['x'], true]) {
      await expect(service.set('legal.doi-tra', bad, 'admin1')).rejects.toThrow(BadRequestException);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it('chặn nội dung quá dài (50.000 ký tự) để một lần dán nhầm không làm nặng mọi trang chính sách', async () => {
    const { prisma, upsert } = makePrisma({ existing: { value: '' } });
    const service = new SystemConfigService(prisma);
    await expect(service.set('legal.bao-mat', 'a'.repeat(50_001), 'admin1')).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('nhận markdown tiếng Việt và chuỗi rỗng (rỗng = dùng lại bản nháp mặc định)', async () => {
    const { prisma, upsert } = makePrisma({ existing: { value: '' } });
    const service = new SystemConfigService(prisma);
    await service.set('legal.dieu-khoan', '# Điều khoản\n\n- Mục 1', 'admin1');
    await service.set('legal.dieu-khoan', '', 'admin1');
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});

describe('SystemConfigService.set — điểm uy tín cộng đồng và thưởng chuỗi 7 ngày (seed-reference nạp các khoá này)', () => {
  function mk() {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)) } as unknown as PrismaService;
    return { svc: new SystemConfigService(prisma), tx };
  }

  it.each([
    ['community.rep_post', 5, [-1, 101, 2.5]],
    ['community.rep_answer', 2, [-2, 101, 0.5]],
    ['community.rep_best', 10, [-10, 101, 1.5]],
    ['community.daily_rep_cap', 30, [-1, 1001, 30.5]],
  ] as const)('%s: nhận %d và 0, từ chối %j', async (key, fine, badValues) => {
    for (const ok of [fine, 0]) {
      const good = mk();
      await good.svc.set(key, ok, 'admin1');
      expect(good.tx.systemConfig.upsert).toHaveBeenCalled();
    }
    for (const v of badValues) {
      const bad = mk();
      await expect(bad.svc.set(key, v, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(bad.tx.systemConfig.upsert).not.toHaveBeenCalled();
    }
  });

  it('community.rep_thresholds: nhận 4 mốc tăng dần bắt đầu từ 0; từ chối sai số mốc, mốc đầu khác 0, không tăng dần, số lẻ/âm/chuỗi', async () => {
    const good = mk();
    await good.svc.set('community.rep_thresholds', [0, 50, 200, 500], 'admin1');
    expect(good.tx.systemConfig.upsert).toHaveBeenCalled();
    const bads: unknown[] = [[0, 50, 200], [0, 50, 200, 500, 900], [10, 50, 200, 500], [0, 200, 50, 500], [0, 50, 50, 500], [0, 50, 200.5, 500], [0, -5, 200, 500], [0, '50', 200, 500], [0, 50, 200, 2_000_000], { 0: 0 }];
    for (const bad of bads) {
      const m = mk();
      await expect(m.svc.set('community.rep_thresholds', bad as number[], 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(m.tx.systemConfig.upsert).not.toHaveBeenCalled();
    }
  });

  it('game.streak_7_bonus: nhận { seeds } và bản seed { seeds, free_spins }; từ chối seeds âm/lẻ/quá lớn/thiếu và free_spins sai', async () => {
    for (const ok of [{ seeds: 20 }, { seeds: 10, free_spins: 1 }, { seeds: 0 }]) {
      const good = mk();
      await good.svc.set('game.streak_7_bonus', ok, 'admin1');
      expect(good.tx.systemConfig.upsert).toHaveBeenCalled();
    }
    const bads: object[] = [{ seeds: -1 }, { seeds: 10.5 }, { seeds: 10_001 }, {}, { seeds: '20' }, { seeds: 10, free_spins: -1 }, { seeds: 10, free_spins: 1.5 }, { seeds: 10, free_spins: 101 }, []];
    for (const bad of bads) {
      const m = mk();
      await expect(m.svc.set('game.streak_7_bonus', bad, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(m.tx.systemConfig.upsert).not.toHaveBeenCalled();
    }
  });
});

describe('SystemConfigService.set — freeship đơn đầu và link Mini App cho thẻ hộp hàng (D2-08, D2-03)', () => {
  function mk() {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)) } as unknown as PrismaService;
    return { svc: new SystemConfigService(prisma), tx };
  }

  it.each([
    ['shipping.first_order_free_enabled', [true, false], ['true', 'false', 1, 0, null]],
    ['pancake.total_mismatch_check', [true, false], ['true', 'false', 1, 0, null]],
    ['shipping.first_order_free_min_subtotal', [0, 99000], [-1, 99000.5, 50_000_001, '99000']],
    ['home.new_customer_layout', [true, false], ['true', 'false', 1, 0, null]],
    ['community.public_preview', [true, false], ['true', 'false', 1, 0, null]],
    ['community.zalo_group_url', ['', 'https://zalo.me/g/abcxyz', 'https://www.zalo.me/g/abc'], ['http://zalo.me/g/a', 'https://evil.com/zalo.me', 'https://zalo.me.evil.com/g', 'https://facebook.com@evil.com/x', 'zalo.me/g/a', ' https://zalo.me/g/a', 5, null]],
    ['community.facebook_url', ['', 'https://www.facebook.com/tubutree', 'https://fb.com/tubutree', 'https://m.facebook.com/tubutree'], ['https://notfacebook.com/x', 'javascript:alert(1)', 'https://facebook.com:8080/x']],
    ['community.tiktok_url', ['', 'https://www.tiktok.com/@tubutree', 'https://vt.tiktok.com/abc'], ['https://tiktok.com.cn/x', 'ftp://tiktok.com/x']],
    ['dealer.review_hours', [1, 24, 720], [0, -1, 1.5, 721, '24', null]],
    ['app.miniapp_base_url', ['', 'https://zalo.me/s/1234567890', 'https://zalo.me/s/1234567890/'], ['zalo.me/s/123', 'http://zalo.me/s/123', 'https://zalo.me/s/1 23', 'https://zalo.me/s/123?x=1', 5]],
  ] as const)('%s: nhận %j, từ chối %j', async (key, goods, bads) => {
    for (const ok of goods) {
      const good = mk();
      await good.svc.set(key, ok, 'admin1');
      expect(good.tx.systemConfig.upsert).toHaveBeenCalled();
    }
    for (const bad of bads) {
      const m = mk();
      await expect(m.svc.set(key, bad as never, 'admin1')).rejects.toThrow(BadRequestException);
      expect(m.tx.systemConfig.upsert).not.toHaveBeenCalled();
    }
  });
});

describe('SystemConfigService.set — mặc định hoa hồng không vượt trần', () => {
  const svc = (values: Record<string, unknown>) => {
    const { prisma } = makePrisma({ findUnique: jest.fn(async ({ where }: { where: { key: string } }) => (where.key in values ? { value: values[where.key] } : null)) });
    return new SystemConfigService(prisma);
  };

  it('affiliate.default_rate_pct lớn hơn max_rate_pct hiện hành → 400', async () => {
    await expect(svc({ 'affiliate.max_rate_pct': 10 }).set('affiliate.default_rate_pct', 12, 'a')).rejects.toThrow('vượt trần 10%');
    await expect(svc({ 'affiliate.max_rate_pct': 10 }).set('affiliate.default_rate_pct', 10, 'a')).resolves.toBeUndefined();
  });

  it('hạ max_rate_pct xuống dưới mức mặc định đang áp → 400', async () => {
    await expect(svc({ 'affiliate.default_rate_pct': 8 }).set('affiliate.max_rate_pct', 5, 'a')).rejects.toThrow('thấp hơn mức mặc định 8%');
    await expect(svc({}).set('affiliate.max_rate_pct', 8, 'a')).resolves.toBeUndefined();
  });
});

describe('SystemConfigService.set — khoá chat CSKH (chat.*)', () => {
  function mk(existing: unknown) {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: existing }), upsert: jest.fn().mockResolvedValue({}) },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { svc: new SystemConfigService(prisma), tx };
  }
  const hours = { start: '08:00', end: '21:00' };

  it('chat.hours nhận {start, end} hợp lệ', async () => {
    const { svc, tx } = mk(hours);
    await svc.set('chat.hours', { start: '07:30', end: '22:00' }, 'admin1');
    expect(tx.systemConfig.upsert).toHaveBeenCalled();
  });

  it.each([
    ['giờ sai dạng', { start: '8h', end: '21:00' }],
    ['start >= end', { start: '21:00', end: '08:00' }],
    ['start == end', { start: '08:00', end: '08:00' }],
    ['thiếu end', { start: '08:00' }],
    ['giờ 24:00', { start: '08:00', end: '24:00' }],
  ])('chat.hours từ chối: %s', async (_name, value) => {
    const { svc, tx } = mk(hours);
    await expect(svc.set('chat.hours', value, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('chat.enabled chỉ nhận boolean', async () => {
    const ok = mk(false);
    await ok.svc.set('chat.enabled', true, 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    const bad = mk(false);
    await expect(bad.svc.set('chat.enabled', 'true', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    expect(bad.tx.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('chat.off_hours_text: chuỗi không rỗng sau trim, tối đa 1000 ký tự', async () => {
    const ok = mk('x');
    await ok.svc.set('chat.off_hours_text', 'Mai trả lời nhé', 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    const blank = mk('x');
    await expect(blank.svc.set('chat.off_hours_text', '   ', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    expect(blank.tx.systemConfig.upsert).not.toHaveBeenCalled();
    const long = mk('x');
    await expect(long.svc.set('chat.off_hours_text', 'a'.repeat(1001), 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    expect(long.tx.systemConfig.upsert).not.toHaveBeenCalled();
    const edge = mk('x');
    await edge.svc.set('chat.off_hours_text', 'a'.repeat(1000), 'admin1');
    expect(edge.tx.systemConfig.upsert).toHaveBeenCalled();
  });

  it('chat.zalo_group_id: chuỗi rỗng được nhận (bỏ chọn nhóm) và được ghi', async () => {
    const m = mk('g-old');
    await m.svc.set('chat.zalo_group_id', '', 'admin1');
    expect(m.tx.systemConfig.upsert).toHaveBeenCalledTimes(1);
    expect(m.tx.systemConfig.upsert.mock.calls[0]![0]).toMatchObject({ update: { value: '' } });
  });

  it.each([
    ['toàn khoảng trắng', '   '],
    ['có khoảng trắng giữa', '123 456'],
    ['dài hơn 64 ký tự', '1'.repeat(65)],
    ['không phải chuỗi', 123],
  ])('chat.zalo_group_id từ chối: %s, không ghi', async (_name, value) => {
    const m = mk('g-old');
    await expect(m.svc.set('chat.zalo_group_id', value, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    expect(m.tx.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('chat.zalo_group_id: đúng 64 ký tự được nhận', async () => {
    const m = mk('x');
    await m.svc.set('chat.zalo_group_id', '1'.repeat(64), 'admin1');
    expect(m.tx.systemConfig.upsert).toHaveBeenCalled();
  });

  it('retention.support_chat_days: số nguyên 90–3650', async () => {
    const ok = mk(365);
    await ok.svc.set('retention.support_chat_days', 90, 'admin1');
    expect(ok.tx.systemConfig.upsert).toHaveBeenCalled();
    for (const bad of [89, 3651, 100.5]) {
      const m = mk(365);
      await expect(m.svc.set('retention.support_chat_days', bad, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(m.tx.systemConfig.upsert).not.toHaveBeenCalled();
    }
  });
});
