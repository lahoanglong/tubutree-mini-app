import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppGates } from './app-gates';

describe('AppGates', () => {
  it('chưa có cổng nào thì không vẽ gì', () => {
    expect(renderToStaticMarkup(<AppGates />)).toBe('');
  });
});
