import React from 'react';
import { useState } from 'react';
import { PROPERTY_LIMITS } from '../../shared/component-properties.mjs';
import { literalOptions } from '../propertyOptions.js';
import Dropdown from '../ui/Dropdown.jsx';
import { BracesIcon } from '../ui/Icons.jsx';
export function PropertyDefault({ property, onChange }) {
  const simple =
    ['string', 'number', 'boolean'].includes(property.type) ||
    literalOptions(property.type) !== undefined;
  const [mode, setMode] = useState(
    simple && isLiteralDefault(property) ? 'value' : 'expression',
  );
  const expression = mode === 'expression';
  const action = expression
    ? 'Use the default value control'
    : 'Write a default expression';
  return (
    <div className="property-default" role="group" aria-label="Default value">
      <div className="property-default-title">
        <span>Default value</span>
        {simple && (
          <button
            type="button"
            className={`prop-expr-toggle${expression ? ' on' : ''}`}
            title={action}
            aria-label={action}
            aria-pressed={expression}
            onClick={() =>
              setMode((current) =>
                current === 'value' ? 'expression' : 'value',
              )
            }
          >
            <BracesIcon size={12} />
          </button>
        )}
      </div>
      {mode === 'value' && simple ? (
        <DefaultControl property={property} onChange={onChange} />
      ) : (
        <textarea
          aria-label="Default expression"
          className="property-code"
          value={property.defaultValue}
          spellCheck={false}
          rows={2}
          maxLength={PROPERTY_LIMITS.textCharsMax}
          placeholder={'"Hello", 42, true, [], {…}'}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
function DefaultControl({ property, onChange }) {
  const options = literalOptions(property.type);
  if (options || property.type === 'boolean') {
    const choices = [...new Set(options ?? ['true', 'false'])];
    return (
      <Dropdown
        value={defaultChoice(choices, property.defaultValue)}
        options={[
          { value: '', label: 'No default' },
          ...choices.map((choice) => ({
            value: choice,
            label: propertyDefaultText(choice) ?? choice,
          })),
        ]}
        onChange={onChange}
        livePreview={false}
        searchable
        searchPlaceholder="Search defaults…"
      />
    );
  }
  if (property.type === 'number') {
    return (
      <input
        aria-label="Default number"
        type="number"
        step="any"
        value={
          Number.isFinite(Number(property.defaultValue))
            ? property.defaultValue
            : ''
        }
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      aria-label="Default text"
      value={propertyDefaultText(property.defaultValue) ?? ''}
      maxLength={PROPERTY_LIMITS.textCharsMax - 2}
      onChange={(event) => onChange(JSON.stringify(event.target.value))}
    />
  );
}
export function propertyDefaultText(expression) {
  if (!expression) {
    return '';
  }
  // Unescaped single quotes are common in Astro defaults; complex escapes use the code control.
  if (/^'[^'\\]*'$/.test(expression)) {
    return expression.slice(1, -1);
  }
  try {
    const value = JSON.parse(expression);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
function defaultChoice(choices, expression) {
  return (
    choices.find(
      (choice) =>
        choice === expression ||
        (propertyDefaultText(choice) !== undefined &&
          propertyDefaultText(choice) === propertyDefaultText(expression)),
    ) ?? ''
  );
}
function isLiteralDefault(property) {
  if (!property.defaultValue) {
    return true;
  }
  const options = literalOptions(property.type);
  if (options) {
    return defaultChoice(options, property.defaultValue) !== '';
  }
  switch (property.type) {
    case 'string':
      return propertyDefaultText(property.defaultValue) !== undefined;
    case 'number':
      return Number.isFinite(Number(property.defaultValue));
    case 'boolean':
      return ['true', 'false'].includes(property.defaultValue);
    default:
      return false;
  }
}
