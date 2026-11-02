import config from '@tubutree/eslint-config';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...config,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // Chỉ quy tắc gọi hook. exhaustive-deps để tắt: các mảng phụ thuộc thiếu trong mã hiện có đều cố ý (đã soát 21 chỗ).
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
];
