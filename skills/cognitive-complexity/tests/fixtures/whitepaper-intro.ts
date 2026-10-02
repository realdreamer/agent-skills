// SonarSource Cognitive Complexity whitepaper v1.7, "Intuitively 'right'
// complexity scores" (p. 10), translated from Java. Comments are the paper's.

function sumOfPrimes(max: number): number {
  let total = 0;
  OUT: for (let i = 1; i <= max; ++i) { // +1
    for (let j = 2; j < i; ++j) { // +2 (nesting = 1)
      if (i % j === 0) { // +3 (nesting = 2)
        continue OUT; // +1
      }
    }
    total += i;
  }
  return total;
} // Cognitive Complexity 7

function getWords(n: number): string {
  switch (n) { // +1
    case 1:
      return 'one';
    case 2:
      return 'a couple';
    case 3:
      return 'a few';
    default:
      return 'lots';
  }
} // Cognitive Complexity 1
