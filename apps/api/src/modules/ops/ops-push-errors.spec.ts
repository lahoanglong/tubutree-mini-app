import { tallyPushErrors } from './ops-health.service';

describe('tallyPushErrors', () => {
  it('CONFIG_RECHECK đếm riêng, không cộng vào config (báo động tổng pancake.config chỉ đếm CONFIG)', () => {
    const t = tallyPushErrors([
      { pancakeErrorKind: 'CONFIG', _count: { _all: 2 } },
      { pancakeErrorKind: 'CONFIG_RECHECK', _count: { _all: 5 } },
      { pancakeErrorKind: 'REJECTED', _count: { _all: 1 } },
      { pancakeErrorKind: 'DATA', _count: { _all: 3 } },
      { pancakeErrorKind: 'TRANSIENT', _count: { _all: 4 } },
      { pancakeErrorKind: null, _count: { _all: 7 } },
      { pancakeErrorKind: 'LẠ', _count: { _all: 1 } },
    ]);
    expect(t).toEqual({ transient: 4, data: 3, rejected: 1, config: 2, configRecheck: 5, unclassified: 8 });
  });
});
