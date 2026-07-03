export type AuthorBadge = 'EXPERT' | null;

/** Pha 1: badge suy từ role. STAFF/ADMIN = Chuyên gia Tubu. (Badge nhãn hàng để Pha 2.) */
export function authorBadge(role: string): AuthorBadge {
  return role === 'ADMIN' || role === 'STAFF' ? 'EXPERT' : null;
}
