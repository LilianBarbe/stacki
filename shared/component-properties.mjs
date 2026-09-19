// Source text is the revision token: edits cannot overwrite a newer disk revision.
import {
  pathText,
  boolean,
  count,
  list,
  object,
  optional,
  text,
} from './boundary.mjs';
import { LIMITS } from './limits.mjs';
import { toRecord } from './record.mjs';
export const PROPERTY_LIMITS = {
  fieldsMax: LIMITS.propSchemaFieldsMax,
  sourceCharsMax: 2 * 1024 * 1024,
  textCharsMax: 32768,
  nameCharsMax: 128,
  filesMax: 10000,
  totalCharsMax: 32 * 1024 * 1024,
  nodesMax: 200000,
};
export function propertyText(input) {
  const value = text(input);
  if (value.length > PROPERTY_LIMITS.textCharsMax) {
    throw new Error('Property text exceeds limit');
  }
  return value;
}
export function propertySource(input) {
  const value = text(input);
  if (value.length > PROPERTY_LIMITS.sourceCharsMax) {
    throw new Error('Component source exceeds limit');
  }
  return value;
}
export function propertyName(input) {
  const value = propertyText(input);
  if (value.length > PROPERTY_LIMITS.nameCharsMax) {
    throw new Error('Property name exceeds limit');
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) {
    throw new Error('Use a TypeScript identifier for the property name');
  }
  return value;
}
export function parseComponentProperty(input) {
  return object({
    name: propertyLabel,
    type: propertyText,
    required: boolean,
    readonly: boolean,
    defaultValue: propertyText,
    description: propertyText,
    origin: optional(parsePropertyOrigin),
    editing: optional(parsePropertyEditing),
    conditions: optional((value) => propertyList(value, propertyText)),
  })(input);
}
function parsePropertyEditing(input) {
  const value = toRecord(input);
  if (value?.['kind'] === 'editable') {
    return { kind: 'editable' };
  }
  if (value?.['kind'] === 'restricted') {
    const reason = propertyText(value['reason']);
    if (reason.trim()) {
      return { kind: 'restricted', reason };
    }
  }
  throw new Error('Invalid property editing permission');
}
function parsePropertyOrigin(input) {
  return object({
    declarations: (value) => propertyList(value, parsePropertySource),
    defaultValue: optional(parsePropertySource),
  })(input);
}
function parsePropertySource(input) {
  const source = object({
    label: propertyText,
    expression: propertyText,
    line: count,
  })(input);
  if (!source.label.trim()) {
    throw new Error('Property source label must be nonempty');
  }
  if (source.line < 1 || source.line > PROPERTY_LIMITS.sourceCharsMax) {
    throw new Error('Property source line is out of bounds');
  }
  return source;
}
export function propertyList(input, parse) {
  const values = list(parse)(input);
  if (values.length > PROPERTY_LIMITS.fieldsMax) {
    throw new Error('Too many component properties');
  }
  return values;
}
export function parsePropertyChange(input) {
  const value = toRecord(input);
  switch (value?.['kind']) {
    case 'save':
      return {
        kind: 'save',
        ...object({
          originalName: propertyText,
          property: parseEditableProperty,
        })(input),
      };
    case 'remove':
      return { kind: 'remove', name: propertyName(value['name']) };
    case 'order':
      return {
        kind: 'order',
        names: propertyList(value['names'], propertyName),
      };
    case 'source':
      return {
        kind: 'source',
        frontmatter: propertySource(value['frontmatter']),
      };
    default:
      throw new Error('Unknown component property change');
  }
}
export function parseComponentProperties(input) {
  return object({
    source: propertySource,
    frontmatter: propertySource,
    advanced: boolean,
    properties: (value) => propertyList(value, parseComponentProperty),
  })(input);
}
export function parsePropertiesResult(input, parse) {
  const value = toRecord(input);
  if (value?.['ok'] === true) {
    return { ok: true, value: parse(value['value']) };
  }
  if (value?.['ok'] === false) {
    return {
      ok: false,
      error: object({ code: propertyText, message: propertyText })(
        value['error'],
      ),
    };
  }
  throw new Error('Invalid component properties result');
}
function propertyLabel(input) {
  const value = propertyText(input);
  if (value.length === 0 || value.length > PROPERTY_LIMITS.nameCharsMax) {
    throw new Error('Property name must be nonempty and within the name limit');
  }
  return value;
}
function parseEditableProperty(input) {
  const property = parseComponentProperty(input);
  return { ...property, name: propertyName(property.name) };
}

export function parsePropertyLocation(input) {
  return object({ projectPath: pathText, file: pathText })(input);
}
export function parsePropertyRequest(input) {
  return {
    ...parsePropertyLocation(input),
    ...object({ source: propertySource, change: parsePropertyChange })(input),
  };
}
