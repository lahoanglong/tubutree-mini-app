import { authorBadge } from './author-badge';

describe('authorBadge', () => {
  it('ADMIN → EXPERT', () => expect(authorBadge('ADMIN')).toBe('EXPERT'));
  it('STAFF → EXPERT', () => expect(authorBadge('STAFF')).toBe('EXPERT'));
  it('CUSTOMER → null', () => expect(authorBadge('CUSTOMER')).toBeNull());
  it('AFFILIATE → null', () => expect(authorBadge('AFFILIATE')).toBeNull());
});
