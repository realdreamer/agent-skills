# Test smells

Each smell has an ID for review findings, how to spot it, the pillar it hurts, and the fix. The default severity is in brackets; raise or lower it with the evidence in front of you.

## Tests that cannot go red

**`no-assertion`** [HIGH]. The test acts and stops: no `expect`, or only `expect(fn).not.toThrow()` around code that never throws. It passes whatever the code does. Spot it: the last line is an action (`click`, `render`, a call). Fix: assert the outcome the test name promises.

**`snapshot-only`** [HIGH]. `expect(container).toMatchSnapshot()` is the only check. It fails on every markup change and passes whatever the markup says, so it is updated without being read. Fix: assert the specific text, role or attribute that matters.

**`mocked-unit`** [HIGH]. The test mocks the logic it claims to test, e.g. mocks `isValidEmail` to return `false` and then checks that the error shows. Validation is never exercised: break the regex and the test stays green. Fix: keep your own modules real and drive them with real input (`'not-an-email'`).

**`mirror-expected`** [HIGH]. The expected value is computed with the same formula as the source (`expect(total(items)).toBe(items.reduce(...))`). A bug in the formula is in both. Fix: a literal worked out by hand.

**`call-count-only`** [HIGH]. The only assertion is `toHaveBeenCalled()` / `toHaveBeenCalledTimes(1)` on a boundary mock. The request could carry the wrong body and the UI could show nothing. Fix: assert what the user sees, and the arguments when the outgoing call is the behavior.

**`weak-matcher`** [MEDIUM]. `toBeDefined()` or `toBeTruthy()` on a value that is always defined, e.g. on the result of `getByRole`, which throws when missing. Fix: `toBeInTheDocument()`, or the exact value.

## Tests that go red on a refactor

**`impl-detail`** [HIGH]. Asserts internals: component state, a private helper being called, the order of internal calls, class names, the DOM structure (`container.firstChild.children[2]`). Renaming or restructuring breaks it while users see no change. Fix: assert what the user observes.

**`own-module-mock`** [HIGH]. Mocks or spies on the project's own in-process modules (`vi.mock('./validation')`, `vi.spyOn(utils, 'format')`). The test now checks wiring, and the real collaborator goes untested. Fix: mock only boundaries (network, clock, randomness, third-party SDKs, database client, framework runtime). In Vitest, spying on an ESM namespace can also simply fail.

**`test-id-query`** [MEDIUM]. `getByTestId`, `querySelector` or a class selector where a role, label or text exists, e.g. `getByTestId('subscribe-btn')` on a button labelled "Subscribe". It couples the test to attributes users never see, and it stays green if the button loses its accessible name or becomes a `<div>`. Also covers `data-testid` attributes added to source only so a test can find an element that has no accessible name; that element needs a label instead. Fix: `getByRole('button', { name: 'Subscribe' })`, `getByLabelText('Email')`, `within(…)` for scoping; see the query table in [react-testing-library.md](react-testing-library.md).

## Tests that flake or run slow

**`real-wait`** [MEDIUM]. `await new Promise((r) => setTimeout(r, 500))` or real timers for debounce. Slow, and flaky on a busy CI machine. Fix: `findBy…` for async UI, fake timers for time.

**`waitfor-misuse`** [MEDIUM]. Side effects inside `waitFor` (clicks run again on every retry), an empty `waitFor(() => {})`, or `waitFor` + `getBy` where `findBy` fits. Fix: actions outside, one assertion inside, or `findBy`.

**`fire-event`** [LOW–MEDIUM]. `fireEvent.change` / `fireEvent.click` for user actions. It skips focus, keyboard and pointer events and clicks disabled buttons, so it can pass where a real user is blocked. Fix: `userEvent.setup()` and `await user.type/click`.

**`shared-state`** [MEDIUM]. Mocks, globals (`global.fetch = …`) or module variables set in one test leak into the next; tests pass alone and fail together, or the reverse. Fix: set up per test, `restoreMocks` in config, restore globals in `afterEach`.

**`unpinned-time`** [MEDIUM]. Expected values depend on today's date, the time zone, or `Math.random`. Fix: `setSystemTime`, an explicit time zone, a seeded or stubbed random.

**`act-warning`** [MEDIUM]. The run prints "not wrapped in act(...)". A state update landed after the test stopped looking; an assertion is missing or premature. Fix: await the final UI state.

## Tests that mislead

**`vague-name`** [LOW]. `'works'`, `'renders'`, `'test 1'`, `'handles error'`. A failure doesn't say what broke. Fix: behavior under condition: `'shows "Could not subscribe" when the server returns 500'`.

**`name-mismatch`** [MEDIUM]. The name promises one behavior and the body checks another (`'button disabled'` asserts it is enabled). Fix: make them agree; usually the promised behavior is the missing test.

**`multi-behavior`** [LOW]. One test walks through several unrelated behaviors; the first failure hides the rest. Fix: split by behavior. A user flow that is itself the behavior (fill, submit, see result) stays one test.

**`logic-in-test`** [LOW]. `if`, loops or `try/catch` in the test body. The test itself needs testing. Fix: `it.each` tables, `await expect(p).rejects.toThrow(…)`.

**`framework-test`** [LOW]. Tests React, the router, or a library rather than your code (`useState` updates, `Link` navigates). Fix: delete it.

**`skipped`** [MEDIUM]. `.skip`, `.only`, `xit`, `it.todo` left in. `.only` silently turns off the rest of the file. Fix: remove, or open an issue for the skipped behavior.

**`coverage-padding`** [MEDIUM]. Calls code to light up lines and asserts nothing meaningful (`render(<Page />)` with no expectations, getters checked for being defined). Fix: replace with behavior tests, or delete; the coverage was never real.

## Example rewrite

Before (bad, shown for contrast): `own-module-mock`, `test-id-query`, `fire-event`, `waitfor-misuse`, `vague-name`.

```tsx
it('shows error', async () => {
  vi.spyOn(validation, 'isValidEmail').mockReturnValue(false);
  render(<NewsletterSignup listId="weekly" />);
  await waitFor(() => {
    fireEvent.click(screen.getByTestId('subscribe-btn'));
    expect(document.querySelector('.error')).not.toBeNull();
  });
});
```

After: the input found by its label, the button by role and name, the error by `role="alert"`.

```tsx
it('asks for a valid email and sends nothing when the email is malformed', async () => {
  const user = userEvent.setup();
  render(<NewsletterSignup listId="weekly" />);

  await user.type(screen.getByLabelText('Email'), 'ana@example');
  await user.click(screen.getByRole('button', { name: 'Subscribe' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Please enter a valid email');
  expect(fetch).not.toHaveBeenCalled();
});
```
