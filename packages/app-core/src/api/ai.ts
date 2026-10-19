import type { HttpClient } from '../http';

export interface AiProduct {
  id: string;
  name: string;
  slug: string;
  brand: string;
  shortDesc: string | null;
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
}
export interface AiChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
export interface AiChatResult {
  reply: string;
  products: AiProduct[];
}

export const aiChat = (http: HttpClient, message: string, history: AiChatTurn[]) =>
  http.post<AiChatResult>('/ai-advisor/chat', { message, history });
