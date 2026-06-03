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
    ignores: ['dist/**', '.next/**', 'www/**', 'node_modules/**', 'coverage/**'],
  },
  prettier,
);
