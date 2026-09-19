// Validate records and arrays before reading fields from an external value.
/** The record behind `input`, or undefined when it isn't a plain object. */
export function toRecord(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  return input;
}
/** The array behind `input`, or undefined when it isn't one. */
export function toArray(input) {
  if (!Array.isArray(input)) {
    return undefined;
  }
  return input;
}
