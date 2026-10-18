import type { HttpClient } from '../http';
import { getPublicConfig } from '../api/config';

export const publicConfigQuery = (http: HttpClient) => ({
  queryKey: ['public-config'] as const,
  queryFn: () => getPublicConfig(http),
});
