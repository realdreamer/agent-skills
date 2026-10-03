# React Testing Library

Guiding principle: "The more your tests resemble the way your software is used, the more confidence they can give you." A component test finds elements the way a person does and acts the way a person does.

## Finding elements

Query priority ([Testing Library docs](https://testing-library.com/docs/queries/about#priority)), best first:

1. `getByRole` with a `name`: `screen.getByRole('button', { name: /create account/i })`. It finds the element the way assistive tech does, so the test also fails if the element loses its role or accessible name.
2. `getByLabelText` for form fields: the label a user reads.
3. `getByPlaceholderText` only when a field truly has no label (and report the missing label). `getByText` for non-interactive content (paragraphs, headings without a level you care about). `getByDisplayValue` for a field's current value.
4. `getByAltText` for images, `getByTitle` rarely.
5. `getByTestId`, the last resort, for elements with no role, label or text (a canvas, a chart container).

| Element | Query |
| --- | --- |
| `<button>`, `role="button"` | `getByRole('button', { name: 'Subscribe' })` |
| link | `getByRole('link', { name: 'About' })` |
| text input with a label | `getByLabelText('Email')` or `getByRole('textbox', { name: 'Email' })` |
| password input | `getByLabelText('Password')` (password fields have no role) |
| checkbox, radio | `getByRole('checkbox', { name: 'Remember me' })` |
| select | `getByRole('combobox', { name: 'Country' })` |
| heading | `getByRole('heading', { name: 'Orders', level: 1 })` |
| error message | `getByRole('alert')` |
| status / success message | `getByRole('status')` |
| dialog | `getByRole('dialog', { name: 'Confirm cancel' })` |
| list rows | `getAllByRole('listitem')`, or `within(getByRole('row', { name: /order 42/ }))` |

- Use `screen` rather than destructuring queries from `render`.
- To narrow the search to one region, use `within(screen.getByRole('dialog'))` instead of a test id on the container.
- `container.querySelector` with a class, id or tag couples the test to markup and styling. It belongs nowhere in a component test.
- An existing `data-testid` in the source doesn't change the order: if the button has a name, query it by role. Leave the attribute alone; removing it is the team's call.
- `name` matches the accessible name exactly as a string, or use a regex (`/subscribe/i`) when surrounding text or casing may vary. When unsure what the accessible names are, `screen.logTestingPlaygroundURL()` or the error output of a failed `getByRole` lists every role and name on the page.

Variants:

- `getBy…` when the element is there now. It throws with a readable DOM dump when it isn't.
- `queryBy…` only to assert absence: `expect(screen.queryByRole('alert')).not.toBeInTheDocument()`.
- `findBy…` when the element appears asynchronously. It retries until found (1000 ms default timeout).

A query that cannot find an element by role usually means the markup is inaccessible (a clickable `div`, an input without a label). Report it; it is a real finding for users.

## Acting like a user

```ts
import userEvent from '@testing-library/user-event';

const user = userEvent.setup();
render(<SignupForm />);
await user.type(screen.getByLabelText('Email'), 'ana@example.com');
await user.click(screen.getByRole('button', { name: 'Create account' }));
```

- Call `userEvent.setup()` before `render`, and `await` every interaction.
- `user-event` fires the full event sequence (focus, keydown, input, keyup, click) and respects `disabled`. `fireEvent` dispatches one synthetic event and clicks disabled buttons; keep it for events `user-event` doesn't model (e.g. `scroll`).
- Submitting with Enter: `await user.type(input, 'text{Enter}')`.

## Assertions with jest-dom

`toBeInTheDocument`, `toHaveTextContent`, `toBeDisabled`, `toBeEnabled`, `toHaveValue`, `toBeChecked`, `toHaveAccessibleName`, `toHaveAttribute`, `toHaveFocus`, `toBeVisible`. They read like the behavior and fail with useful messages. `expect(button.disabled).toBe(true)` works but reports `expected false to be true`.

## Async UI

- Wait for the outcome with `await screen.findByRole('alert')` or `await screen.findByText(/check your inbox/i)`.
- `waitFor` holds assertions only, for things `findBy` can't express (e.g. a mock being called). Side effects such as clicks inside `waitFor` run again on every retry.
- For loading states, assert the in-between state *before* resolving the request: render, act, `expect(button).toBeDisabled()`, then let the response arrive and assert the end state.
- `await waitForElementToBeRemoved(() => screen.queryByText(/loading/i))` for spinners.
- An `act(...)` warning means a state update happened after the test stopped waiting. Fix it by awaiting the final UI state, not by wrapping code in `act`.

## Network

Prefer MSW: the component's real `fetch` code runs, and the test controls the response.

```ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.post('/api/signup', () => HttpResponse.json({ ok: true }, { status: 201 })),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('shows an error when the email is already registered', async () => {
  server.use(http.post('/api/signup', () => HttpResponse.json({}, { status: 409 })));
  // ...
});
```

Without MSW, stub `fetch` per test (`vi.spyOn(globalThis, 'fetch')` / `jest.spyOn(global, 'fetch')`) and restore it after. Return a real `Response` (`new Response(JSON.stringify(body), { status })`) rather than a hand-made `{ ok: true }` object, so `res.json()` and `res.status` behave like production. When the request body matters, assert it as an outcome (what was sent), not only the call count.

A promise that never resolves (`new Promise(() => {})`) holds the UI in its pending state for loading assertions.

## Providers

Components that need context (router, theme, query client, store, i18n) are rendered through the project's custom render helper. If there is none and several tests need the same providers, write one:

```tsx
export function renderWithProviders(ui: React.ReactElement, { store = makeStore() } = {}) {
  return { store, ...render(<Provider store={store}>{ui}</Provider>) };
}
```

Use real providers with test data (a fresh store, a `QueryClient` with `retry: false`) rather than mocking the hooks that read them.

## Hooks

- A hook used by one component is tested through that component.
- A reusable hook gets `renderHook`:

```ts
import { renderHook, act } from '@testing-library/react';

const { result } = renderHook(() => useCounter({ max: 3 }));
act(() => result.current.increment());
expect(result.current.count).toBe(1);
```

`result.current` is the hook's public interface, so asserting on it is fine.

## Forms: the usual inventory

- each validation rule: the message shown, and that nothing is submitted
- the submitted payload, including trimming and type conversion
- the pending state: submit disabled, label changes, double submit blocked
- each server outcome: success (navigation or message), known errors (409, 422), unknown errors (500), network failure
- recovery: the error clears and resubmission works after fixing input

## Snapshots

A snapshot of a whole component fails on every markup change and passes no matter what the markup says, so it protects nothing in particular and gets updated without being read. Assert the specific text, role or attribute that matters. Small inline snapshots of a pure function's output (`toMatchInlineSnapshot`) are fine when the output is data that a reviewer reads in the diff.
