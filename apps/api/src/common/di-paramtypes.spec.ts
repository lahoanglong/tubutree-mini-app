import 'reflect-metadata';
// AppModule nạp đầu tiên, đúng thứ tự main.ts: vòng import chỉ lộ ra theo thứ tự nạp của tiến trình thật.
import { AppModule } from '../app.module';
import {
  EXCEPTION_FILTERS_METADATA,
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  MODULE_METADATA,
  PARAMTYPES_METADATA,
  PIPES_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';

jest.mock('../config/env.validation', () => ({ validateEnv: (config: Record<string, unknown>) => config }));

type Ctor = abstract new (...args: never[]) => unknown;
type ModuleRef = Ctor | { module?: Ctor; providers?: unknown[]; controllers?: Ctor[]; imports?: unknown[]; forwardRef?: () => unknown };
type FactoryProvider = { provide: unknown; useFactory: unknown; inject?: unknown[] };

const ENHANCER_KEYS = [GUARDS_METADATA, INTERCEPTORS_METADATA, PIPES_METADATA, EXCEPTION_FILTERS_METADATA];

/** Mọi lớp Nest tự dựng trong đồ thị module của AppModule: provider, controller, guard/interceptor/pipe/filter gắn bằng decorator. */
function collect(root: Ctor): { classes: Map<Ctor, string>; factories: { owner: string; provider: FactoryProvider }[] } {
  const seen = new Set<unknown>();
  const classes = new Map<Ctor, string>();
  const factories: { owner: string; provider: FactoryProvider }[] = [];
  const addEnhancers = (target: object, owner: string) => {
    for (const key of ENHANCER_KEYS) {
      for (const e of (Reflect.getMetadata(key, target) as unknown[] | undefined) ?? []) {
        if (typeof e === 'function') classes.set(e as Ctor, owner);
      }
    }
  };
  const addController = (c: Ctor, owner: string) => {
    classes.set(c, owner);
    addEnhancers(c, owner);
    const proto = c.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name !== 'constructor' && typeof handler === 'function') addEnhancers(handler, owner);
    }
  };
  const addProvider = (p: unknown, owner: string) => {
    if (typeof p === 'function') classes.set(p as Ctor, owner);
    else if (p && typeof p === 'object') {
      const useClass = (p as { useClass?: unknown }).useClass;
      if (typeof useClass === 'function') classes.set(useClass as Ctor, owner);
      if (typeof (p as { useFactory?: unknown }).useFactory === 'function') factories.push({ owner, provider: p as FactoryProvider });
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
      for (const c of ref.controllers ?? []) addController(c, name);
      for (const child of ref.imports ?? []) visit(child);
    }
    if (seen.has(mod)) return;
    seen.add(mod);
    for (const p of (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, mod) as unknown[] | undefined) ?? []) addProvider(p, name);
    for (const c of (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) as Ctor[] | undefined) ?? []) addController(c, name);
    for (const child of (Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) as unknown[] | undefined) ?? []) visit(child);
  };
  visit(root);
  return { classes, factories };
}

/**
 * Vòng import (A import B, B import A) làm kiểu tham số constructor thành `undefined` trong metadata lúc decorate; Nest báo
 * "can't resolve dependencies ... argument Object at index [n]" và API không khởi động. Unit test dựng service bằng tay nên không
 * thấy lỗi này; spec này đọc metadata sau khi nạp AppModule như main.ts. Không phủ: property injection, module động trả Promise.
 */
describe('DI: tham số constructor và token inject của mọi lớp Nest tự dựng đều giải được', () => {
  const { classes, factories } = collect(AppModule as unknown as Ctor);

  it('tham số constructor không là undefined/Object (thiếu @Inject) và token @Inject không là undefined', () => {
    expect(classes.size).toBeGreaterThan(100);
    const problems: string[] = [];
    for (const [cls, owner] of classes) {
      const types = (Reflect.getMetadata(PARAMTYPES_METADATA, cls) as unknown[] | undefined) ?? [];
      const declared = (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, cls) as { index: number; param: unknown }[] | undefined) ?? [];
      // @Inject(ClassToken) mà ClassToken còn undefined lúc decorate (vòng import) thì Nest lấy luôn paramtype, cũng undefined.
      for (const d of declared) if (d.param === undefined) problems.push(`${owner} › ${cls.name} @Inject tham số #${d.index}`);
      const declaredIdx = new Set(declared.map((d) => d.index));
      types.forEach((t, i) => {
        if ((t === undefined || t === Object) && !declaredIdx.has(i)) problems.push(`${owner} › ${cls.name} tham số #${i}`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('mảng inject của provider useFactory không có token undefined', () => {
    const problems: string[] = [];
    for (const { owner, provider } of factories) {
      (provider.inject ?? []).forEach((token, i) => {
        if (token === undefined) problems.push(`${owner} › ${String(provider.provide)} inject #${i}`);
      });
    }
    expect(problems).toEqual([]);
  });
});
