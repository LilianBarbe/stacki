import React from 'react';
import { useRef } from 'react';
import { assert } from '../../shared/assert.mjs';
import { PROPERTY_LIMITS } from '../../shared/component-properties.mjs';
import { arrayItems, arrayText, moveItem } from '../arrayValue.js';
import { literalOptions } from '../propertyOptions.js';
import ListField from './ListField.jsx';
export function PropertyOptions({ type, disabled, onChange }) {
  // Retain the original scalar kind through intermediate edits such as '-' in a number.
  const scalarKind = useRef();
  const options = literalOptions(type);
  if (!options) {
    return null;
  }
  const value = arrayText(
    options.map((option) => ({ text: optionLabel(option), quote: '"' })),
  );
  const change = (value, immediate, change) => {
    if (disabled) {
      return;
    }
    if (change.kind === 'edit') {
      const original = options[change.index];
      assert(original !== undefined, 'Edited option exists');
      scalarKind.current ??= /^["']/.test(original) ? 'text' : 'literal';
    }
    const next = changePropertyOptionList(
      options,
      value,
      change,
      scalarKind.current ?? 'text',
    );
    if (immediate) {
      scalarKind.current = undefined;
    }
    onChange(next.options.join(' | '), next.rename);
  };
  return (
    <div className="property-options props-field">
      <span>Options</span>
      <ListField
        value={value}
        onChange={change}
        disabled={disabled}
        itemsMin={1}
        itemsMax={PROPERTY_LIMITS.fieldsMax}
        valueCharsMax={PROPERTY_LIMITS.sourceCharsMax}
      />
    </div>
  );
}
function optionLabel(option) {
  const item = arrayItems(`[${option}]`)?.[0];
  return item && !item.fields ? item.text : option;
}
function changePropertyOptionList(options, value, change, scalarKind) {
  assert(
    options.length <= PROPERTY_LIMITS.fieldsMax,
    'Option count is bounded',
  );
  switch (change.kind) {
    case 'move':
      return { options: moveItem(options, change.index, change.gap) };
    case 'remove':
      return { options: options.filter((_, index) => index !== change.index) };
    case 'add': {
      const item = arrayItems(value)?.at(-1);
      assert(item !== undefined, 'Added option has a value');
      assert(item.fields === undefined, 'Options are scalar values');
      return { options: [...options, JSON.stringify(item.text)] };
    }
    case 'edit': {
      const original = options[change.index];
      const item = arrayItems(value)?.[change.index];
      assert(original !== undefined, 'Edited option has a source');
      assert(item !== undefined, 'Edited option has a value');
      assert(item.fields === undefined, 'Options are scalar values');
      const replacement = optionExpression(original, item.text, scalarKind);
      return {
        options: options.map((option, index) =>
          index === change.index ? replacement : option,
        ),
        rename: { from: original, to: replacement },
      };
    }
    default: {
      const exhaustive = change;
      return exhaustive;
    }
  }
}
function optionExpression(original, text, scalarKind) {
  if (optionLabel(original) === text) {
    return original;
  }
  if (
    scalarKind === 'literal' &&
    /^(?:-?\d+(?:\.\d+)?|true|false)$/.test(text.trim())
  ) {
    return text.trim();
  }
  return JSON.stringify(text);
}
