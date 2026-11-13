import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from './shop-copy';
import {
  SUBSCRIPTION_PAUSED_GENERIC,
  SUBSCRIPTION_PAUSE_MAX,
  SUBSCRIPTION_PAUSE_REASONS,
  subscriptionPauseView,
} from './subscription-pause-copy';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('subscriptionPauseView', () => {
  it.each(SUBSCRIPTION_PAUSE_REASONS)('%s: có tiêu đề và gợi ý, trong độ dài tối đa, không dùng thuật ngữ cấm', (code) => {
    const v = subscriptionPauseView(code);
    expect(v.title).not.toBe('');
    expect(v.hint).not.toBe('');
    expect(v.title).not.toBe(SUBSCRIPTION_PAUSED_GENERIC);
    expect(v.title.length).toBeLessThanOrEqual(SUBSCRIPTION_PAUSE_MAX.title);
    expect(v.hint.length).toBeLessThanOrEqual(SUBSCRIPTION_PAUSE_MAX.hint);
    for (const text of [v.title, v.hint]) {
      for (const t of FORBIDDEN_TERMS) expect(text, `"${text}" dính thuật ngữ cấm → dùng "${t.use}"`).not.toMatch(t.pattern);
    }
  });

  it('mỗi lý do một tiêu đề riêng để khách phân biệt', () => {
    const titles = SUBSCRIPTION_PAUSE_REASONS.map((c) => subscriptionPauseView(c).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it.each([[null], [undefined], [''], ['mã_lạ_của_api_mới'], ['constructor'], ['toString'], ['__proto__']])(
    'lý do %p (trống, lạ, tên thuộc tính của Object): dòng chung, không gợi ý, không đoán',
    (reason) => {
      expect(subscriptionPauseView(reason as string | null | undefined)).toEqual({ title: SUBSCRIPTION_PAUSED_GENERIC, hint: '' });
    },
  );

  it('gợi ý nào nhắc nút "Sửa" thì chỉ ở lý do khách sửa được (địa chỉ, ví, hạn mức); sản phẩm ngừng bán chỉ khuyên huỷ', () => {
    expect(subscriptionPauseView('invalid_address').hint).toContain('Sửa');
    expect(subscriptionPauseView('insufficient_wallet').hint).toContain('Sửa');
    expect(subscriptionPauseView('cod_limit').hint).toContain('Sửa');
    expect(subscriptionPauseView('inactive_product').hint).not.toContain('Tiếp tục');
    expect(subscriptionPauseView('partner_goods').hint).not.toContain('Tiếp tục');
  });
});

describe('mã lý do khớp API', () => {
  const service = readFileSync(join(REPO, 'apps/api/src/modules/subscriptions/subscriptions.service.ts'), 'utf8');

  it('SystemPauseCode của API + "customer" = SUBSCRIPTION_PAUSE_REASONS', () => {
    const union = /type SystemPauseCode =([^;]+);/.exec(service)?.[1];
    expect(union, 'subscriptions.service.ts mất `type SystemPauseCode`').toBeTruthy();
    const codes = [...union!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect([...codes, 'customer'].sort()).toEqual([...SUBSCRIPTION_PAUSE_REASONS].sort());
  });

  it('API ghi "customer" khi khách tự tạm dừng', () => {
    expect(service).toMatch(/CUSTOMER_PAUSE_REASON = 'customer'/);
  });
});
