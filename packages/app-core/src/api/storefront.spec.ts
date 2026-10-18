import { describe, expect, it } from 'vitest';
import { fakeHttp, type RecordedCall } from './fake-http';
import * as s from './storefront';
import type { HttpClient } from '../http';

describe('storefront — đúng route, query, body', () => {
  it.each<[string, (h: HttpClient) => unknown, Partial<RecordedCall>]>([
    [
      'getStorefrontCategories',
      (h) => s.getStorefrontCategories(h),
      { method: 'get', path: '/categories' },
    ],
    [
      'applyStorefrontTemplate',
      (h) => s.applyStorefrontTemplate(h, 'cat1'),
      { method: 'post', path: '/storefront/me/apply-template', body: { categoryId: 'cat1' } },
    ],
    ['createStorefront', (h) => s.createStorefront(h), { method: 'post', path: '/storefront' }],
    ['getMyStorefront', (h) => s.getMyStorefront(h), { method: 'get', path: '/storefront/me' }],
    [
      'getPublicStorefront',
      (h) => s.getPublicStorefront(h, 'ctv-an'),
      { method: 'get', path: '/storefront/public/ctv-an' },
    ],
    [
      'updateStorefront',
      (h) => s.updateStorefront(h, { title: 'Shop', theme: 'green' }),
      { method: 'patch', path: '/storefront/me', body: { title: 'Shop', theme: 'green' } },
    ],
    [
      'publishStorefront',
      (h) => s.publishStorefront(h, true),
      { method: 'post', path: '/storefront/me/publish', body: { isPublished: true } },
    ],
    [
      'createCollection',
      (h) => s.createCollection(h, { title: 'BST', kind: 'COMBO', comboDiscountPct: 10 }),
      {
        method: 'post',
        path: '/storefront/me/collections',
        body: { title: 'BST', kind: 'COMBO', comboDiscountPct: 10 },
      },
    ],
    [
      'updateCollection',
      (h) => s.updateCollection(h, 'c1', { title: 'Mới' }),
      { method: 'patch', path: '/storefront/me/collections/c1', body: { title: 'Mới' } },
    ],
    [
      'deleteCollection',
      (h) => s.deleteCollection(h, 'c1'),
      { method: 'delete', path: '/storefront/me/collections/c1' },
    ],
    [
      'addItem',
      (h) => s.addItem(h, 'c1', { productId: 'p1', note: 'n' }),
      {
        method: 'post',
        path: '/storefront/me/collections/c1/items',
        body: { productId: 'p1', note: 'n' },
      },
    ],
    [
      'updateItem',
      (h) => s.updateItem(h, 'i1', { isPinned: true }),
      { method: 'patch', path: '/storefront/me/items/i1', body: { isPinned: true } },
    ],
    [
      'removeItem',
      (h) => s.removeItem(h, 'i1'),
      { method: 'delete', path: '/storefront/me/items/i1' },
    ],
    [
      'pickerProducts()',
      (h) => s.pickerProducts(h),
      { method: 'get', path: '/storefront/me/products', opts: { query: { search: undefined } } },
    ],
    [
      'pickerProducts(tìm)',
      (h) => s.pickerProducts(h, 'sữa'),
      { method: 'get', path: '/storefront/me/products', opts: { query: { search: 'sữa' } } },
    ],
    [
      'getStorefrontStats',
      (h) => s.getStorefrontStats(h),
      { method: 'get', path: '/storefront/me/stats' },
    ],
    ['getQuests', (h) => s.getQuests(h), { method: 'get', path: '/storefront/me/quests' }],
    [
      'claimQuest',
      (h) => s.claimQuest(h, 'Q1'),
      { method: 'post', path: '/storefront/me/quests/Q1/claim' },
    ],
  ])('%s', async (_n, run, expected) => {
    const { http, calls } = fakeHttp();
    await run(http);
    expect(calls).toEqual([expected]);
  });
});
