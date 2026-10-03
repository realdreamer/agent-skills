import { describe, expect, it } from 'vitest';
import { addItem, total } from './cart';

describe('addItem', () => {
  it('adds a new sku to the cart', () => {
    expect(addItem([], { sku: 'mug', priceCents: 1200, qty: 1 })).toEqual([{ sku: 'mug', priceCents: 1200, qty: 1 }]);
  });

  it('merges the quantity of a sku already in the cart', () => {
    const items = [{ sku: 'mug', priceCents: 1200, qty: 2 }];
    expect(addItem(items, { sku: 'mug', priceCents: 1200, qty: 3 })).toEqual([{ sku: 'mug', priceCents: 1200, qty: 5 }]);
  });
});

describe('total', () => {
  it('charges shipping below the free-shipping threshold', () => {
    expect(total([{ sku: 'mug', priceCents: 1000, qty: 1 }]).totalCents).toBe(1495);
  });
});
