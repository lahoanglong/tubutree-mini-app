import { Fragment as RuntimeFragment, jsx as runtimeJsx, jsxs as runtimeJsxs } from 'react/jsx-runtime';

/**
 * Chỉ bản build (build-vendor-shims.ts trỏ `react/jsx-runtime` của mã app và zmp-ui về đây). `react/jsx-runtime` là CommonJS nên Rollup để mọi chỗ gọi JSX
 * ở dạng thuộc tính của một object (`j.jsx(…)`, `j.jsxs(…)`, `j.Fragment`), ~7 000 lần trong bản build. Xuất lại thành binding ES module thì mỗi chunk
 * nhập thẳng hàm và gọi bằng tên ngắn (`a(…)`). Ba hàm của runtime production không dùng `this` nên tách khỏi object không đổi hành vi.
 */
export const jsx = runtimeJsx;
export const jsxs = runtimeJsxs;
export const Fragment = RuntimeFragment;
