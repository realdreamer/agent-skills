export type Item = { sku: string; priceCents: number; qty: number };

type CouponBase = { code: string; minSubtotalCents?: number; expiresAt?: string };
export type Coupon =
  | (CouponBase & { kind: 'percent'; value: number })
  | (CouponBase & { kind: 'fixed'; valueCents: number });

export const MAX_QTY_PER_SKU = 10;
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000;
export const SHIPPING_CENTS = 495;

export function addItem(items: Item[], item: Item): Item[] {
  if (item.qty <= 0) throw new RangeError('qty must be positive');
  const existing = items.find((i) => i.sku === item.sku);
  if (!existing) return [...items, { ...item, qty: Math.min(item.qty, MAX_QTY_PER_SKU) }];
  return items.map((i) => (i.sku === item.sku ? { ...i, qty: Math.min(i.qty + item.qty, MAX_QTY_PER_SKU) } : i));
}

export function subtotal(items: Item[]): number {
  return items.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
}

export function discount(subtotalCents: number, coupon: Coupon | undefined, now: Date = new Date()): number {
  if (!coupon) return 0;
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return 0;
  if (coupon.minSubtotalCents && subtotalCents < coupon.minSubtotalCents) return 0;
  const raw = coupon.kind === 'percent' ? Math.round((subtotalCents * coupon.value) / 100) : coupon.valueCents;
  return Math.min(raw, subtotalCents);
}

export function total(items: Item[], coupon?: Coupon, now: Date = new Date()) {
  const subtotalCents = subtotal(items);
  const discountCents = discount(subtotalCents, coupon, now);
  const discountedCents = subtotalCents - discountCents;
  const shippingCents = subtotalCents === 0 || discountedCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_CENTS;
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: discountedCents + shippingCents,
  };
}
