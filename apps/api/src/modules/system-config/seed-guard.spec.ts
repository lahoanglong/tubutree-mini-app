import { assertSeedAllowed } from './seed-guard';

describe('assertSeedAllowed', () => {
  it('chặn khi NODE_ENV=production và chưa có cờ cho phép', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/ALLOW_PROD_SEED=1/);
  });

  it('nêu điều seed sẽ ghi đè để người chạy hiểu vì sao bị chặn', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/tài khoản ngân hàng/);
  });

  it('chỉ cờ đúng giá trị "1" mới mở khoá, giá trị khác vẫn chặn', () => {
    for (const v of ['0', 'true', 'yes', '', ' 1']) {
      expect(() => assertSeedAllowed({ NODE_ENV: 'production', ALLOW_PROD_SEED: v })).toThrow();
    }
  });

  it('có ALLOW_PROD_SEED=1 thì cho chạy ở production (lần đầu trên DB mới)', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', ALLOW_PROD_SEED: '1' })).not.toThrow();
  });

  it('dev, test và NODE_ENV không đặt đều cho chạy', () => {
    for (const env of [{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, {}]) {
      expect(() => assertSeedAllowed(env)).not.toThrow();
    }
  });
});
