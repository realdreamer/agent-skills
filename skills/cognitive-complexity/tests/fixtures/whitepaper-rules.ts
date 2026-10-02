// Whitepaper v1.7 rule examples (pp. 7-9), translated from Java.
declare const a: boolean, b: boolean, c: boolean, d: boolean, e: boolean, f: boolean;
declare const condition1: boolean, condition2: boolean;
declare function schedule(task: () => void): void;

// "Sequences of logical operators"
function mixedSequences() {
  if (a // +1 for `if`
    && b && c // +1
    || d || e // +1
    && f) { // +1
  }
} // 4

function negatedGroup() {
  if (a // +1 for `if`
    && // +1
    !(b && c)) { // +1
  }
} // 3

// "Increment for nested flow-break structures". Java's multi-catch
// `catch (ExcepType1 | ExcepType2 e)` is a single catch clause.
function myMethod() {
  try {
    if (condition1) { // +1
      for (let i = 0; i < 10; i++) { // +2 (nesting = 1)
        while (condition2) { /* ... */ } // +3 (nesting = 2)
      }
    }
  } catch (e) { // +1
    if (condition2) { /* ... */ } // +2 (nesting = 1)
  }
} // Cognitive Complexity 9

// Lambdas add no increment but raise the nesting level. The lambda is passed
// to a call: in JS, a function holding only declarations (`const r = () => ...`)
// is a declarative wrapper (Appendix A) and its lambda is scored on its own.
function myMethod2() {
  schedule(() => { // +0 (but nesting level is now 1)
    if (condition1) { /* ... */ } // +2 (nesting = 1)
  });
} // Cognitive Complexity 2
