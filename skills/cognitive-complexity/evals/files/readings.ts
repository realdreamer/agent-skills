export type Reading = { sensor: string; value: number | null; radius?: number };

export function average(a: number, b: number): number {
  return a + b;
}

export function summarizeReadings(readings: Reading[], mode: string): string[] {
  const lines: string[] = [];
  for (const reading of readings) {
    if (reading.value !== null) {
      if (mode === 'area') {
        if (reading.radius) {
          lines.push(`${reading.sensor}: ${3.14 * reading.radius * reading.radius}`);
        } else {
          lines.push(`${reading.sensor}: no radius`);
        }
      } else if (mode === 'pair') {
        for (const other of readings) {
          if (other.sensor !== reading.sensor && other.value !== null) {
            lines.push(`${reading.sensor}+${other.sensor}: ${average(reading.value, other.value)}`);
          }
        }
      } else {
        if (reading.value % 15 === 0) {
          lines.push('fizzbuzz');
        } else {
          lines.push(String(reading.value));
        }
      }
    } else {
      lines.push(`${reading.sensor}: Missing value!`);
    }
  }
  return lines;
}
