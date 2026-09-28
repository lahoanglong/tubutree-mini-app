import { RuleTester } from 'eslint';
import rule from './icon-button-aria-label.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('icon-button-aria-label', rule, {
  valid: [
    { code: `<IconButton icon={<X />} label="Đóng" />` },
    { code: `<button aria-label="Đóng"><X /></button>` },
  ],
  invalid: [
    {
      code: `<IconButton icon={<X />} />`,
      errors: [{ messageId: 'missingLabel' }],
    },
  ],
});
