import type { SupportChatSendInput } from '@tubutree/shared-types';
import {
  getSupportChatPage as corePage,
  markSupportChatRead as coreRead,
  sendSupportChat as coreSend,
} from '@tubutree/app-core/api/support-chat';
import { supportChatQuery, supportChatSummaryQuery } from '@tubutree/app-core/queries/support-chat';
import { coreHttp } from './core-http';

export const supportChatQueryOptions = () => supportChatQuery(coreHttp);
export const supportChatSummaryQueryOptions = () => supportChatSummaryQuery(coreHttp);
export const getSupportChatPage = (q: { after?: string; before?: string }) => corePage(coreHttp, q);
export const sendSupportChat = (input: SupportChatSendInput) => coreSend(coreHttp, input);
export const markSupportChatRead = (upToId?: string) => coreRead(coreHttp, upToId);
