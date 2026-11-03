import 'reflect-metadata';
// AppModule nạp đầu tiên, đúng thứ tự main.ts: vòng import chỉ lộ ra theo thứ tự nạp của tiến trình thật.
import { AppModule } from '../app.module';
import { MODULE_METADATA, PARAMTYPES_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';

jest.mock('../config/env.validation', () => ({ validateEnv: (config: Record<string, unknown>) => config }));

type Ctor = abstract new (...args: never[]) => unknown;
type ModuleRef = Ctor | { module?: Ctor; providers?: unknown[]; controllers?: Ctor[]; imports?: unknown[]; forwardRef?: () => unknown };

/** Mọi lớp provider/controller trong đồ thị module của AppModule (gồm module động và forwardRef). */
function collectClasses(root: Ctor): Map<Ctor, string> {
  const seen = new Set<unknown>();
  const out = new Map<Ctor, string>();
  const addProvider = (p: unknown, owner: string) => {
    if (typeof p === 'function') out.set(p as Ctor, owner);
    else if (p && typeof p === 'object' && typeof (p as { useClass?: unknown }).useClass === 'function') {
      out.set((p as { useClass: Ctor }).useClass, owner);
    }
  };
  const visit = (raw: unknown): void => {
    let ref = raw as ModuleRef | undefined;
    if (!ref || ref instanceof Promise) return;
    if (typeof ref === 'object' && typeof ref.forwardRef === 'function') ref = ref.forwardRef() as ModuleRef;
    const mod = typeof ref === 'function' ? ref : ref.module;
    if (!mod) return;
    const name = mod.name;
    if (typeof ref === 'object') {
      for (const p of ref.providers ?? []) addProvider(p, name);
      for (const c of ref.controllers ?? []) out.set(c, name);
      for (const child of ref.imports ?? []) visit(child);
    }
    if (seen.has(mod)) return;
    seen.add(mod);
    for (const p of (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, mod) as unknown[] | undefined) ?? []) addProvider(p, name);
    for (const c of (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) as Ctor[] | undefined) ?? []) out.set(c, name);
    for (const child of (Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) as unknown[] | undefined) ?? []) visit(child);
  };
  visit(root);
  return out;
}

/**
 * Vòng import (A import B, B import A) làm kiểu tham số constructor thành `undefined` trong metadata lúc decorate; Nest báo
 * "can't resolve dependencies ... argument Object at index [n]" và API không khởi động. Unit test dựng service bằng tay nên không
 * thấy lỗi này; spec này đọc metadata của mọi provider/controller sau khi nạp AppModule như main.ts.
 */
describe('DI: kiểu tham số constructor của mọi provider/controller đều giải được', () => {
  it('không tham số nào là undefined/Object mà thiếu @Inject(token)', () => {
    const classes = collectClasses(AppModule as unknown as Ctor);
    expect(classes.size).toBeGreaterThan(100);
    const problems: string[] = [];
    for (const [cls, owner] of classes) {
      const types = (Reflect.getMetadata(PARAMTYPES_METADATA, cls) as unknown[] | undefined) ?? [];
      const declared = new Set(
        ((Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, cls) as { index: number }[] | undefined) ?? []).map((d) => d.index),
      );
      types.forEach((t, i) => {
        if ((t === undefined || t === Object) && !declared.has(i)) problems.push(`${owner} › ${cls.name} tham số #${i}`);
      });
    }
    expect(problems).toEqual([]);
  });
});
