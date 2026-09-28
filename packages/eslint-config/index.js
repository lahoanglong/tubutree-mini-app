import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import { tubuDsPlugin } from './rules/index.js';

/**
 * Cấu hình ESLint dùng chung cho toàn monorepo Tubu Tree.
 * TypeScript strict, cấm `any` (quy tắc code mục 19 của build spec).
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
  {
    // Test files: mock/stub cần `any` và `require()` là idiom hợp lệ. Quy tắc "cấm any"
    // (build spec §19) áp cho code sản phẩm; nới cho *.spec/*.test để không kẹt CI vì mock.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.spec.tsx', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: ['dist/**', '.next/**', 'www/**', 'node_modules/**', 'coverage/**'],
  },
  {
    // Design System v2 guardrails (spec §6): cấm màu thô trong style={{}} và icon-only
    // button thiếu nhãn a11y. Loại trừ file game/tier — minh hoạ dùng màu tuỳ ý theo thiết kế.
    files: ['**/*.tsx'],
    ignores: ['**/*.spec.tsx', '**/game/**', '**/tier/**'],
    plugins: { 'tubu-ds': tubuDsPlugin },
    rules: {
      'tubu-ds/no-raw-color': 'error',
      'tubu-ds/icon-button-aria-label': 'error',
    },
  },
  {
    // Buộc dùng Button (Design System v2) trong components/ui thay vì import thẳng
    // Button gốc của zmp-ui bên trong pages/ — tránh bỏ sót styling/token chuẩn.
    // Pattern có tiền tố `**/` (không phải "apps/miniapp/...") vì ESLint flat config phân
    // giải `files` tương đối theo thư mục chứa file config *đang được ESLint nạp*
    // (ở đây là apps/miniapp/eslint.config.mjs, chỉ re-export mảng này) chứ không phải theo
    // nơi mảng này được khai báo trong package @tubutree/eslint-config — đã verify bằng
    // `eslint --print-config` thật, xem task-6-report.md.
    files: ['**/src/pages/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zmp-ui',
              importNames: ['Button'],
              message:
                'Dùng Button từ components/ui (Design System v2), không import thẳng từ zmp-ui trong pages/.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
