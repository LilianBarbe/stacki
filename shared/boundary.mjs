// Small bounded parsers shared by IPC and disk readers. Parsers construct typed
// values; no library or assertion is needed to trust a field after this boundary.
import { toArray, toRecord } from './record.mjs';
export const BOUNDARY_LIMITS = {
  textLengthMax: 5 * 1024 * 1024,
  pathLengthMax: 32768,
  itemsMax: 100000,
  depthMax: 128,
};
export function text(input) {
  if (typeof input !== 'string') {
    throw new Error('Expected string');
  }
  if (input.length > BOUNDARY_LIMITS.textLengthMax) {
    throw new Error('String exceeds limit');
  }
  return input;
}
export function pathText(input) {
  const value = text(input);
  if (value.length > BOUNDARY_LIMITS.pathLengthMax) {
    throw new Error('Path exceeds limit');
  }
  if (value.includes('\0')) {
    throw new Error('Path contains NUL');
  }
  return value;
}
export function boolean(input) {
  if (typeof input !== 'boolean') {
    throw new Error('Expected boolean');
  }
  return input;
}
export function count(input) {
  if (typeof input !== 'number') {
    throw new Error('Expected number');
  }
  if (!Number.isSafeInteger(input)) {
    throw new Error('Expected safe integer');
  }
  if (input < 0) {
    throw new Error('Expected nonnegative integer');
  }
  return input;
}
export function optional(parse) {
  return (input) => (input === undefined ? undefined : parse(input));
}
export function nullable(parse) {
  return (input) => (input === null ? null : parse(input));
}
export function list(parse) {
  return (input) => {
    const values = toArray(input);
    if (!values) {
      throw new Error('Expected array');
    }
    if (values.length > BOUNDARY_LIMITS.itemsMax) {
      throw new Error('Array exceeds limit');
    }
    return values.map(parse);
  };
}
export function record(input) {
  const value = toRecord(input);
  if (!value) {
    throw new Error('Expected object');
  }
  if (Object.keys(value).length > BOUNDARY_LIMITS.itemsMax) {
    throw new Error('Object exceeds limit');
  }
  return value;
}
export function object(shape) {
  return (input) => {
    const source = record(input);
    const result = {};
    for (const [key, parse] of Object.entries(shape)) {
      const value = parse(source[key]);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    // Each declared field was parsed above, and the shape controls the keys.
    return result;
  };
}
export function dictionary(parse) {
  return (input) =>
    Object.fromEntries(
      Object.entries(record(input)).map(([key, value]) => [
        pathText(key),
        parse(value),
      ]),
    );
}
export function data(input) {
  // A per-message node budget also bounds wide nested objects, not just depth.
  let remaining = BOUNDARY_LIMITS.itemsMax;
  const visit = (value, depth) => {
    if (--remaining < 0) {
      throw new Error('Data exceeds item limit');
    }
    if (depth > BOUNDARY_LIMITS.depthMax) {
      throw new Error('Data exceeds depth limit');
    }
    if (value == null) {
      return value;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return text(value);
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error('Expected finite number');
      }
      return value;
    }
    const values = toArray(value);
    if (values) {
      return list((entry) => visit(entry, depth + 1))(values);
    }
    return dictionary((entry) => visit(entry, depth + 1))(value);
  };
  return visit(input, 0);
}
export function definedFields(source) {
  // Dropping undefined keys makes explicit options safe for exact optional types.
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  );
}
