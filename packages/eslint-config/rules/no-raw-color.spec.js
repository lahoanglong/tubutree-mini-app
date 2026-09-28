import { RuleTester } from 'eslint';
import rule from './no-raw-color.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-raw-color', rule, {
  valid: [
    { code: `const s = { color: 'var(--color-text-primary)' };` },
    { code: `const s = { padding: 8 };` },
    // game/tier illustration files are exempt via filename-based override in index.js, not the rule itself
  ],
  invalid: [
    {
      code: `const s = { color: '#E08C1C' };`,
      errors: [{ messageId: 'rawColor' }],
    },
    {
      code: `const s = { background: 'rgba(0,0,0,.5)' };`,
      errors: [{ messageId: 'rawColor' }],
    },
  ],
});
