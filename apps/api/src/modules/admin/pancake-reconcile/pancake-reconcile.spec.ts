import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RECONCILE_VARIATION_SELECT, buildReport, classifyVariation, expectedLocalStock, type ReconcileVariation } from './pancake-reconcile';
import { PancakeReconcileController, PancakeReconcileQuery } from './pancake-reconcile.controller';

const SYNC = new Date('2026-11-21T03:00:00Z');
const HOOK = new Date('2026-11-21T04:30:00Z');

function v(sku: string, patch: Partial<Omit<ReconcileVariation, 'product'>> & { productActive?: boolean } = {}): ReconcileVariation {
  const { productActive = true, ...rest } = patch;
  return {
    id: `var-${sku}`,
    sku,
    name: `Biến thể ${sku}`,
    stock: 10,
    reservedStock: 0,
    pancakeId: `pk-${sku}`,
    pancakeStock: 10,
    pancakeStockSyncReadAt: SYNC,
    pancakeStockWebhookReceivedAt: null,
    product: { id: `prod-${sku}`, name: `Sản phẩm ${sku}`, isActive: productActive },
    ...rest,
  };
}

describe('classifyVariation: so tồn cửa hàng với số Pancake lần đồng bộ gần nhất', () => {
  it('tồn khớp công thức đồng bộ (Pancake − giữ chỗ) thì không cờ nào, kể cả khi hết hàng vì giữ chỗ', () => {
    expect(expectedLocalStock(10, 3)).toBe(7);
    expect(expectedLocalStock(2, 5)).toBe(0);
    expect(classifyVariation(v('A', { stock: 7, reservedStock: 3, pancakeStock: 10 }), 3).flags).toEqual([]);
    expect(classifyVariation(v('B', { stock: 0, reservedStock: 2, pancakeStock: 2 }), 3).flags).toEqual([]);
  });

  it('lệch quá ngưỡng thì DRIFT; lệch đúng bằng ngưỡng thì chưa báo', () => {
    const over = classifyVariation(v('C', { stock: 14, pancakeStock: 10 }), 3);
    expect(over).toMatchObject({ expectedStock: 10, drift: 4, flags: ['DRIFT'] });
    expect(classifyVariation(v('D', { stock: 13, pancakeStock: 10 }), 3).flags).toEqual([]);
    expect(classifyVariation(v('E', { stock: 2, pancakeStock: 10 }), 3)).toMatchObject({ drift: -8, flags: ['DRIFT'] });
  });

  it('cửa hàng âm hoặc bằng 0 mà Pancake còn hàng chưa ai giữ: cờ riêng, xếp nặng hơn DRIFT', () => {
    expect(classifyVariation(v('F', { stock: -2, pancakeStock: 5 }), 3).flags).toEqual(['NEGATIVE_LOCAL', 'ZERO_LOCAL_PANCAKE_POSITIVE', 'DRIFT']);
    expect(classifyVariation(v('G', { stock: 0, pancakeStock: 2 }), 3).flags).toEqual(['ZERO_LOCAL_PANCAKE_POSITIVE']);
  });

  it('chưa gắn Pancake: báo UNLINKED khi sản phẩm đang bán, sản phẩm đang ẩn thì thôi; đã gắn mà chưa có số thì NEVER_SYNCED', () => {
    expect(classifyVariation(v('H', { pancakeId: null, pancakeStock: null }), 3)).toMatchObject({ linked: false, flags: ['UNLINKED'], expectedStock: null, drift: null });
    expect(classifyVariation(v('I', { pancakeId: null, pancakeStock: null, productActive: false }), 3).flags).toEqual([]);
    expect(classifyVariation(v('J', { pancakeStock: null, pancakeStockSyncReadAt: null }), 3)).toMatchObject({ flags: ['NEVER_SYNCED'], lastSyncedAt: null });
    // Biến thể chưa gắn mà còn sót số Pancake cũ: không so với số đó.
    expect(classifyVariation(v('K', { pancakeId: null, pancakeStock: 99, stock: 1 }), 3)).toMatchObject({ pancakeStock: null, drift: null, flags: ['UNLINKED'] });
  });

  it('mốc đồng bộ là lần áp muộn nhất giữa lượt đồng bộ và webhook', () => {
    expect(classifyVariation(v('L', { pancakeStockWebhookReceivedAt: HOOK }), 3).lastSyncedAt).toBe(HOOK.toISOString());
  });
});

describe('buildReport', () => {
  const rows = [
    v('OK1'),
    v('DRIFT_SMALL', { stock: 15, pancakeStock: 10 }),
    v('DRIFT_BIG', { stock: 40, pancakeStock: 10, pancakeStockWebhookReceivedAt: HOOK }),
    v('NEG', { stock: -1, pancakeStock: 0 }),
    v('UNLINKED', { pancakeId: null, pancakeStock: null }),
    v('NEVER', { pancakeStock: null }),
  ];

  it('đếm theo cờ trên mọi biến thể, xếp dòng nặng trước rồi lệch nhiều trước, bỏ dòng không có cờ', () => {
    const r = buildReport(rows, 3, SYNC);
    expect(r.counts).toEqual({ scanned: 6, linked: 5, withIssues: 5, NEGATIVE_LOCAL: 1, ZERO_LOCAL_PANCAKE_POSITIVE: 0, DRIFT: 2, UNLINKED: 1, NEVER_SYNCED: 1 });
    expect(r.rows.map((x) => x.sku)).toEqual(['NEG', 'DRIFT_BIG', 'DRIFT_SMALL', 'UNLINKED', 'NEVER']);
    expect(r.lastSyncedAt).toBe(HOOK.toISOString());
    expect(r.truncated).toBe(false);
    expect(r.minDrift).toBe(3);
  });

  it('cắt bảng ở trần dòng nhưng số đếm vẫn đủ', () => {
    const r = buildReport(rows, 3, SYNC, 2);
    expect(r.rows.map((x) => x.sku)).toEqual(['NEG', 'DRIFT_BIG']);
    expect(r.truncated).toBe(true);
    expect(r.counts.withIssues).toBe(5);
  });
});

describe('PancakeReconcileController', () => {
  const SECRETS = { PANCAKE_API_KEY: 'pk_live_SECRET_9f8e7d6c', PANCAKE_WEBHOOK_SECRET: 'whsec_TOPSECRET_123', PANCAKE_SHOP_ID: 'shop-777001' };
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [k, val] of Object.entries(SECRETS)) {
      saved[k] = process.env[k];
      process.env[k] = val;
    }
  });
  afterAll(() => {
    for (const k of Object.keys(SECRETS)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('chỉ đọc biến thể đang bán của hàng kho Tubu, đúng bộ cột đã duyệt, rồi dựng báo cáo theo ngưỡng', async () => {
    const findMany = jest.fn().mockResolvedValue([v('A', { stock: 20, pancakeStock: 10 }), v('B', { pancakeId: null, pancakeStock: null })]);
    const ctrl = new PancakeReconcileController({ variation: { findMany } } as never);
    const r = await ctrl.report({ minDrift: 5 });
    expect(findMany).toHaveBeenCalledWith({ where: { isActive: true, product: { fulfilment: 'TUBU' } }, select: RECONCILE_VARIATION_SELECT, orderBy: { sku: 'asc' } });
    expect(Object.keys(RECONCILE_VARIATION_SELECT).sort()).toEqual(
      ['id', 'name', 'pancakeId', 'pancakeStock', 'pancakeStockSyncReadAt', 'pancakeStockWebhookReceivedAt', 'product', 'reservedStock', 'sku', 'stock'].sort(),
    );
    expect(r.rows.map((x) => [x.sku, x.flags])).toEqual([
      ['A', ['DRIFT']],
      ['B', ['UNLINKED']],
    ]);
    expect((await ctrl.report({})).minDrift).toBe(3);
  });

  it('không lộ khoá, mã cửa hàng hay mã biến thể Pancake: không giá trị bí mật, không trường token/secret/apiKey/pancakeId nào trong phản hồi', async () => {
    const findMany = jest.fn().mockResolvedValue([v('A', { stock: 20, pancakeStock: 10 }), v('B', { pancakeStock: null })]);
    const ctrl = new PancakeReconcileController({ variation: { findMany } } as never);
    const json = JSON.stringify(await ctrl.report({ minDrift: 0 }));
    for (const val of Object.values(SECRETS)) expect(json).not.toContain(val);
    expect(json).not.toMatch(/token|secret|apikey|api_key|password|pancakeId|pk-A|pk-B/i);
  });

  it('ngưỡng là số nguyên 0..10000', () => {
    const errs = (q: object) => validateSync(plainToInstance(PancakeReconcileQuery, q)).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(errs({ minDrift: '5' })).toEqual([]);
    expect(errs({ minDrift: '-1' })).toContain('Ngưỡng lệch không được âm.');
    expect(errs({ minDrift: '2.5' })).toContain('Ngưỡng lệch phải là số nguyên.');
    expect(errs({ minDrift: '10001' })).toContain('Ngưỡng lệch tối đa 10000.');
  });

  it('RolesGuard thật: ADMIN và KHO vào được; CSKH, KE_TOAN, MARKETING, nhân viên chưa có nhóm, khách bị 403', () => {
    const guard = new RolesGuard(new Reflector());
    const can = (user: object) => {
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => PancakeReconcileController.prototype.report,
        getClass: () => PancakeReconcileController,
      } as unknown as ExecutionContext;
      try {
        return guard.canActivate(ctx);
      } catch (e) {
        if (e instanceof ForbiddenException) return false;
        throw e;
      }
    };
    expect(can({ role: 'ADMIN' })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['KHO'] })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['CSKH', 'KE_TOAN', 'MARKETING'] })).toBe(false);
    expect(can({ role: 'STAFF', staffPermissions: [] })).toBe(false);
    expect(can({ role: 'CUSTOMER', staffPermissions: ['KHO'] })).toBe(false);
  });
});
