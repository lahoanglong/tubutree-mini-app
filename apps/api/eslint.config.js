import config from '@tubutree/eslint-config';

export default [
  ...config,
  {
    rules: {
      // NestJS dùng decorator + DI nặng; nới một số rule cho thực dụng.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
