import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

/**
 * Đọc route từ metadata Nest mà không khởi động ứng dụng. Chỉ để spec dùng (endpoint-inventory, beta-removed):
 * danh sách controller phải lấy từ đồ thị import thật của một module gốc, không viết tay, vì danh sách tay
 * không bao giờ chứa controller vừa bị thêm lại ở một module bất kỳ nên các mục "đã gỡ" sẽ không bao giờ đỏ.
 */

export type Ctor = new (...args: never[]) => unknown;
type ModuleRef = Ctor | { module: Ctor; controllers?: Ctor[]; imports?: unknown[] } | Promise<unknown>;

/** Mọi controller đạt được từ `root` qua `imports` (kể cả dynamic module). Module async (`forRootAsync` trả Promise) bị bỏ qua. */
export function collectControllers(root: Ctor): Ctor[] {
  const seen = new Set<Ctor>();
  const controllers = new Set<Ctor>();
  const visit = (ref: ModuleRef): void => {
    if (!ref || ref instanceof Promise) return;
    const mod = typeof ref === 'function' ? ref : ref.module;
    const extra = typeof ref === 'function' ? [] : (ref.controllers ?? []);
    const extraImports = typeof ref === 'function' ? [] : ((ref.imports ?? []) as ModuleRef[]);
    for (const c of extra) controllers.add(c);
    for (const c of (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) as Ctor[] | undefined) ?? []) controllers.add(c);
    if (seen.has(mod)) return;
    seen.add(mod);
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) as ModuleRef[] | undefined) ?? [];
    for (const child of [...imports, ...extraImports]) visit(child);
  };
  visit(root);
  return [...controllers];
}

/** Route của một controller dạng `GET /orders/:code/cancel` (tiền tố controller + đường dẫn handler, bỏ `/` thừa). */
export function routesOf(controller: Ctor): string[] {
  const prefix = (Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined) ?? '';
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  const proto = controller.prototype as Record<string, unknown>;
  const out: string[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[];
    for (const pre of prefixes) {
      for (const p of Array.isArray(path) ? path : [path]) {
        const joined = [pre, p].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
        out.push(`${RequestMethod[method]} /${joined}`);
      }
    }
  }
  return out;
}

/** Guard khai báo ở cấp controller và cấp handler (để spec thay bằng guard cho qua khi cần chạm tới handler). */
export function guardsOf(controller: Ctor): Ctor[] {
  const proto = controller.prototype as Record<string, unknown>;
  const targets: object[] = [controller, ...Object.getOwnPropertyNames(proto).map((n) => proto[n]).filter((h): h is object => typeof h === 'function')];
  return targets.flatMap((t) => (Reflect.getMetadata(GUARDS_METADATA, t) as Ctor[] | undefined) ?? []).filter((g) => typeof g === 'function');
}
