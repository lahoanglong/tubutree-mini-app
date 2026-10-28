import { getOrderStatusCounts } from '@tubutree/app-core/api/order-counts';
import { coreHttp } from './core-http';

/** Số đơn theo từng tab (Cá nhân): một lời gọi thay cho mỗi tab một GET /orders. */
export const fetchOrderStatusCounts = () => getOrderStatusCounts(coreHttp);
