Next.js 16 app (App Router), Vitest + React Testing Library.

- `@/lib/auth` exports `getSession(): Promise<{ userId: string; role: 'customer' | 'admin' } | null>`.
- `@/lib/db` exports a Prisma client `db`. An order row has `id`, `userId`, `status` (`'pending' | 'paid' | 'shipped' | 'cancelled'`), `totalCents`, `items`, and `paymentIntentId` (a Stripe reference that must never reach the browser).
