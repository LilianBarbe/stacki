import { useState } from 'react';
import type { ComponentProperty } from '../../shared/component-properties';
import { PROPERTY_LIMITS } from '../../shared/component-properties';
import { literalOptions } from '../propertyOptions';

interface DefaultProps {
  readonly property: ComponentProperty;
  readonly onChange: (value: string) => void;
}
export function PropertyDefault({ property, onChange }: DefaultProps) {
  const simple =
    ['string', 'number', 'boolean'].includes(property.type) ||
    literalOptions(property.type) !== undefined;
  const [mode, setMode] = useState<'value' | 'expression'>(
    simple && isLiteralDefault(property) ? 'value' : 'expression'
  );
  return (
    <div className="property-default">
      <div className="property-default-title">
        <span>Default value</span>
        {simple && (
          <button
            className="ghost"
            title="Toggle expression editor"
            onClick={() => setMode((current) => (current === 'value' ? 'expression' : 'value'))}
          >
            {mode === 'value' ? '{ }' : 'Value'}
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
      <div className="property-default-title">
        <small className="property-help">
          {property.defaultValue
            ? 'Used when a value is omitted or undefined.'
            : 'No default value.'}
        </small>
        <button className="ghost" disabled={!property.defaultValue} onClick={() => onChange('')}>
          Clear
        </button>
      </div>
    </div>
  );
}
function DefaultControl({ property, onChange }: DefaultProps) {
  const options = literalOptions(property.type);
  if (options || property.type === 'boolean') {
    const choices = [...new Set(options ?? ['true', 'false'])];
    return (
      <select
        aria-label="Default option"
        value={defaultChoice(choices, property.defaultValue)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">No default</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {propertyDefaultText(choice) ?? choice}
          </option>
        ))}
      </select>
    );
  }
  if (property.type === 'number') {
    return (
      <input
        aria-label="Default number"
        type="number"
        step="any"
        value={Number.isFinite(Number(property.defaultValue)) ? property.defaultValue : ''}
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
export function propertyDefaultText(expression: string): string | undefined {
  if (!expression) {
    return '';
  }
  // Unescaped single quotes are common in Astro defaults; complex escapes use the code control.
  if (/^'[^'\\]*'$/.test(expression)) {
    return expression.slice(1, -1);
  }
  try {
    const value: unknown = JSON.parse(expression);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
function defaultChoice(choices: readonly string[], expression: string): string {
  return (
    choices.find(
      (choice) =>
        choice === expression ||
        (propertyDefaultText(choice) !== undefined &&
          propertyDefaultText(choice) === propertyDefaultText(expression))
    ) ?? ''
  );
}
function isLiteralDefault(property: ComponentProperty): boolean {
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
