// Invariant failures are programmer errors, not expected editing failures.
export function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
