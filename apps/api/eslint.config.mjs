import config from '@tubutree/eslint-config';

export default [
  ...config,
  {
    rules: {
      // NestJS dùng decorator + DI nặng; constructor injection cần class value cho reflection metadata
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
