// Whitepaper v1.7 Appendix A, "JavaScript: Missing class structures".
/* global bar, condition */

// Declarative outer function: ignored; the inner function is scored on its own.
function declarative() {
  var foo;
  bar.myFun = function () { // nesting = 0
    if (condition) { // +1
      foo = 1;
    }
  };
} // total complexity = 1

// Non-declarative: a top-level structural increment means the outer function
// is scored normally and includes the inner one.
function nonDeclarative() {
  var foo;
  if (condition) { // +1; top-level structural increment
    foo = 1;
  }
  bar.myFun = function () { // nesting = 1
    if (condition) { // +2
      foo = 2;
    }
  };
} // total complexity = 3
