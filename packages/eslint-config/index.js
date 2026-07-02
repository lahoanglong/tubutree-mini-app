import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

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
  prettier,
);
