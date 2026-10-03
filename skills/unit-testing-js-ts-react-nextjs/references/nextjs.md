# Next.js

Setup guides: [Vitest](https://nextjs.org/docs/app/guides/testing/vitest) and [Jest](https://nextjs.org/docs/app/guides/testing/jest). With Jest, `next/jest` configures SWC transforms, loads `.env` files, and auto-mocks CSS, images and `next/font`. With Vitest, `@vitejs/plugin-react` plus `vite-tsconfig-paths` for path aliases.

Check the Next.js version in `package.json` first; several APIs below changed between 14, 15 and 16.

## What to test at which level

| Code | Unit test | Leave to E2E |
| --- | --- | --- |
| Client Component (`'use client'`) | RTL, like any React component | full navigation flows |
| Synchronous Server Component | RTL render | |
| `async` Server Component | the data and logic functions it calls; its synchronous presentational children | the composed page (Jest and Vitest do not support async Server Components) |
| Route handler (`route.ts`) | call `GET`/`POST`/… directly | |
| Server action | call the function directly | form wiring with `useActionState` |
| Middleware / proxy | call the function with a `NextRequest` | |

For an async Server Component with real logic, move the logic into a plain function (`getOrderSummary(orderId)`) and test that. The component then only fetches and renders, which E2E covers.

## Environment

Route handlers, server actions and middleware run on the server: give their test files the Node environment so `Request`, `Response` and `Headers` are Node's, not jsdom's.

```ts
// @vitest-environment node
```

```ts
/** @jest-environment node */
```

## Route handlers

Import the handler and call it like the framework does. Assert the status and the body; they are the HTTP client's whole view.

```ts
// @vitest-environment node
import { GET } from '@/app/api/orders/[id]/route';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { buildOrder } from '@/test/factories';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { order: { findUnique: vi.fn(), update: vi.fn() } } }));

const call = (id: string) =>
  GET(new Request(`http://localhost/api/orders/${id}`), { params: Promise.resolve({ id }) });

it('returns 404 for another user’s order, so its existence is not revealed', async () => {
  vi.mocked(getSession).mockResolvedValue({ userId: 'u1', role: 'customer' });
  vi.mocked(db.order.findUnique).mockResolvedValue(buildOrder({ id: 'o1', userId: 'u2' }));

  const res = await call('o1');

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Not found' });
});
```

- In Next.js 15 and later, `params` is a `Promise`. In 14 it is a plain object.
- If the handler reads `request.nextUrl` or `request.cookies`, construct `new NextRequest(url)` from `next/server`.
- Mock the auth and database modules: they are the handler's boundaries. Assert the response, and assert a write (`db.order.update`) only for handlers whose job is the write, checking the data written.
- Check what must *not* be in the body too (internal ids, payment references) when the handler maps a record to a response.

## Server actions

A server action is an async function. Call it with the arguments the form sends.

```ts
const formData = new FormData();
formData.set('title', '');
const result = await createPost(undefined, formData);
expect(result).toEqual({ errors: { title: 'Title is required' } });
```

Framework functions throw or fail outside a request, so mock them:

- `next/cache`: `revalidatePath`, `revalidateTag`. Assert the path when revalidation is part of the behavior.
- `next/navigation`: `redirect` and `notFound` throw special errors to stop rendering. Mock them as functions and assert the redirect target.
- `next/headers`: `cookies()` and `headers()` are async in 15+. Return an object with the methods the code uses (`get`, `set`).
- `server-only`: importing it outside the React server build throws. Mock it to an empty module (`vi.mock('server-only', () => ({}))`).

## Client Components and `next/navigation`

`useRouter`, `usePathname` and `useSearchParams` need the App Router context. Mock the module and assert navigation as an outcome:

```ts
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/signup',
  useSearchParams: () => new URLSearchParams(),
}));

// ...
expect(push).toHaveBeenCalledWith('/welcome');
```

In Jest, a variable used inside a `jest.mock` factory must be named with a `mock` prefix (`mockPush`); in Vitest, create it with `vi.hoisted`. See [jest-vitest.md](jest-vitest.md).

`next/link` renders a real `<a>`; assert its `href` with `getByRole('link', { name })` rather than mocking it.

## Middleware / proxy

Next.js 16 renames `middleware.ts` to `proxy.ts`; the function signature is the same. Call it with a `NextRequest` and assert the response:

```ts
const res = await middleware(new NextRequest('http://localhost/dashboard'));
expect(res?.status).toBe(307);
expect(res?.headers.get('location')).toBe('http://localhost/login?next=%2Fdashboard');
```

Test the `config.matcher` separately if the version provides `unstable_doesMiddlewareMatch` in `next/experimental/testing/server`; check that it exists in the installed version before using it.
