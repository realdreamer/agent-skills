# Refactor patterns

Each pattern names the increments it removes. Work from the largest increments in the `--explain` breakdown down. Re-score after each step: a refactor that only moves complexity into one new function hasn't helped.

Every pattern runs under the **behaviour lock** in `SKILL.md`: literals, signatures and error handling stay exactly as they are. Run the tests after each pattern.

## 1. Guard clauses (invert and return early)

Removes: one nesting level for everything inside the wrapped block, and usually an `else`.

```ts
// before: 7
function ship(order: Order) {
  if (order.paid) {                       // +1
    if (order.items.length > 0) {         // +2
      for (const item of order.items) {   // +3
        reserve(item);
      }
    } else {                              // +1
      throw new EmptyOrderError();
    }
  }
}

// after: 3
function ship(order: Order) {
  if (!order.paid) return;                // +1
  if (order.items.length === 0) throw new EmptyOrderError(); // +1
  for (const item of order.items) {       // +1
    reserve(item);
  }
}
```

## 2. Extract the nested block into a named function

Removes: all the nesting increments inside the block. The new function starts at nesting 0, and its name documents the intent.

```ts
// before: for +1, if +2, if +3, for +4 = 10
for (const user of users) {
  if (user.active) {
    if (user.plan === 'pro') {
      for (const seat of user.seats) assign(seat);
    }
  }
}

// after: caller for +1, if +2 = 3; assignProSeats if +1, for +1 = 2
for (const user of users) {
  if (user.active) assignProSeats(user);
}

function assignProSeats(user: User) {
  if (user.plan !== 'pro') return;
  for (const seat of user.seats) assign(seat);
}
```

Extract along a responsibility (validate, price, persist), not at an arbitrary line. Pure functions are easiest to test.

## 3. Lookup map instead of a branch chain

Removes: `if` +1 and each `else if` / `else` +1, or a `switch` +1 with nested logic in its cases.

```ts
// before: if +1, else if +1, else if +1, else +1 = 4
function statusCode(error: AppError): number {
  if (error.kind === 'not-found') return 404;
  else if (error.kind === 'conflict') return 409;
  else if (error.kind === 'unauthorized') return 401;
  else return 500;
}

// after: 0
const STATUS_BY_KIND: Partial<Record<AppError['kind'], number>> = {
  'not-found': 404,
  conflict: 409,
  unauthorized: 401,
};
const statusCode = (error: AppError): number => STATUS_BY_KIND[error.kind] ?? 500;
```

Keep the chain's fallback (`?? 500` for the final `else`). Without it, unknown kinds would return `undefined` instead of 500: a behaviour change. When each branch runs behaviour instead of returning a value, map to functions (a strategy object).

## 4. Name the condition

Removes: nothing by itself, but moving a mixed `&&`/`||` condition into a named boolean or predicate splits its runs off the hot function and makes the branch readable.

```ts
// before: if +1, && +1, || +1, && +1 = 4
if (user.role === 'admin' && !doc.locked || doc.ownerId === user.id && doc.draft) { ... }

// after: caller if +1 = 1; canEdit: || +1, && +1, && +1 = 3
if (canEdit(user, doc)) { ... }

function canEdit(user: User, doc: Doc): boolean {
  const adminOverride = user.role === 'admin' && !doc.locked;
  const ownerDraft = doc.ownerId === user.id && doc.draft;
  return adminOverride || ownerDraft;
}
```

## 5. Flatten promise chains and callbacks

Removes: one nesting level per callback layer. Callbacks score as part of their enclosing function, one level deeper (see `scoring-rules.md`).

```ts
// before: if +2 (inside .then), if +3 (inside nested .then) = 5
function load(id: string) {
  return fetchUser(id).then((user) => {
    if (!user) return null;
    return fetchOrders(user.id).then((orders) => {
      if (orders.length === 0) return { user, orders: [] };
      return { user, orders };
    });
  });
}

// after: 1
async function load(id: string) {
  const user = await fetchUser(id);
  if (!user) return null;
  return { user, orders: await fetchOrders(user.id) };
}
```

## 6. Use null-coalescing and optional chaining

Removes: `if` / ternary / `&&` increments spent on null handling. `?.` is free. `??` is free in the whitepaper, but Biome (and `--biome`) counts each `??` run +1, so the after below scores 1 there.

```ts
// before: ternary +1, && +1 = 2
const city = user && user.address ? user.address.city : 'unknown';

// after: 0
const city = user?.address?.city ?? 'unknown';
```

Watch the semantics: `??` only replaces `null`/`undefined`, while `||` also replaces `0`, `''` and `false`.

## 7. Replace loops with array methods, when it reads better

Removes: `for` +1 and an `if` inside it, when the callback carries no branches of its own. A callback with an `if` inside costs the same nesting as the loop did.

```ts
// before: for +1, if +2 = 3
const active = [];
for (const u of users) {
  if (u.active) active.push(u.email);
}

// after: 0
const active = users.filter((u) => u.active).map((u) => u.email);
```

## 8. Split the Lambda handler (or controller) by stage

Removes: the accumulated nesting of parse → validate → act → map-to-response written in one body.

```ts
export const handler = async (event: APIGatewayProxyEventV2) => {
  const input = parseCreateOrder(event);     // throws BadRequest
  const order = await createOrder(input);    // domain use-case
  return toHttpResponse(201, order);
};
```

Error mapping goes in one wrapper (`withHttpErrors(handler)`) instead of a `try`/`catch` with branches in every handler.

## Choosing

| Breakdown shows | Try first |
|---|---|
| Large `+N (nesting k)` values | 1 guard clauses, 2 extract |
| Many `else if` / `switch` increments selecting a value | 3 lookup map |
| Several `&&` / `\|\|` increments on one line | 4 name the condition |
| Increments inside `.then` / callbacks | 5 async/await |
| Ternaries and `&&` used for null checks | 6 `??` / `?.` |
| A loop whose body is a single `if` | 7 array methods |
| A handler doing everything | 8 split by stage |
