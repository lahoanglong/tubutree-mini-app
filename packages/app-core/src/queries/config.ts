import type { HttpClient } from '../http';
import { fetchFaqs, fetchSupportContact, getPublicConfig } from '../api/config';

export const publicConfigQuery = (http: HttpClient) => ({
  queryKey: ['public-config'] as const,
  queryFn: () => getPublicConfig(http),
});

export const faqsQuery = (http: HttpClient) => ({ queryKey: ['faqs'] as const, queryFn: () => fetchFaqs(http) });
export const supportContactQuery = (http: HttpClient) => ({
  queryKey: ['support-contact'] as const,
  queryFn: () => fetchSupportContact(http),
});
