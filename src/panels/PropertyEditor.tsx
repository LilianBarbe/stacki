import { TrashIcon } from '../ui/Icons';
import { PropertyOptions } from './PropertyOptions';
import type { OptionRename } from './PropertyOptions';
import { PropertyType } from './PropertyType';
import { PropertyDefault, propertyDefaultText } from './PropertyDefault';
export { literalOptions } from '../propertyOptions';
import { useState } from 'react';
import type { ComponentProperty, PropertyChange } from '../../shared/component-properties';
import { PROPERTY_LIMITS } from '../../shared/component-properties';

interface PropertyEditorProps {
  readonly property: ComponentProperty;
  readonly originalName: string;
  readonly disabled: boolean;
  readonly onClose: () => void;
  readonly onSave: (change: PropertyChange) => Promise<void>;
}
export function PropertyEditor(props: PropertyEditorProps) {
  const [property, setProperty] = useState(props.property);
  const [error, setError] = useState('');
  const update = <Key extends keyof ComponentProperty>(key: Key, value: ComponentProperty[Key]) => {
    setProperty((previous) => ({ ...previous, [key]: value }));
    setError('');
  };
  const submit = (): void => {
    if (!/^[A-Za-z_$][\w$]*$/.test(property.name)) {
      setError('Use a name such as title, imageUrl, or isVisible.');
      return;
    }
    void props.onSave({ kind: 'save', originalName: props.originalName, property });
  };
  return (
    <div className="property-editor">
      <header>
        <strong>{props.originalName ? 'Property settings' : 'New property'}</strong>
        <button
          aria-label="Close property settings"
          disabled={props.disabled}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <fieldset disabled={props.disabled}>
        <PropertyIdentity property={property} originalName={props.originalName} update={update} />
        <PropertyType type={property.type} onChange={(type) => update('type', type)} />
        <PropertyOptions
          type={property.type}
          disabled={props.disabled}
          onChange={(type, rename) =>
            setProperty((previous) => changePropertyOptions(previous, type, rename))
          }
        />
        <PropertyFlags property={property} update={update} />
        <PropertyDefault
          key={property.type}
          property={property}
          onChange={(value) => update('defaultValue', value)}
        />
        <label>
          Tooltip
          <textarea
            value={property.description}
            rows={3}
            maxLength={PROPERTY_LIMITS.textCharsMax}
            placeholder="Describe how to use this property…"
            onChange={(event) => update('description', event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="property-error">
            {error}
          </p>
        )}
        <PropertyActions originalName={props.originalName} onSave={props.onSave} submit={submit} />
      </fieldset>
    </div>
  );
}

function PropertyActions({
  originalName,
  onSave,
  submit,
}: {
  readonly originalName: string;
  readonly onSave: PropertyEditorProps['onSave'];
  readonly submit: () => void;
}) {
  return (
    <div className="property-actions">
      {originalName && (
        <button
          className="danger"
          aria-label={`Delete ${originalName}`}
          title="Delete property"
          onClick={() => void onSave({ kind: 'remove', name: originalName })}
        >
          <TrashIcon size={14} />
        </button>
      )}
      <button className="primary" onClick={submit}>
        Save property
      </button>
    </div>
  );
}

interface PropertyControls {
  readonly property: ComponentProperty;
  readonly update: <Key extends keyof ComponentProperty>(
    key: Key,
    value: ComponentProperty[Key]
  ) => void;
}
function PropertyIdentity({
  property,
  originalName,
  update,
}: PropertyControls & {
  readonly originalName: string;
}) {
  return (
    <>
      <label>
        Name
        <input
          value={property.name}
          maxLength={PROPERTY_LIMITS.nameCharsMax}
          autoFocus
          onChange={(event) => update('name', event.target.value)}
        />
      </label>
      {originalName && originalName !== property.name && (
        <p className="property-help">
          Renaming updates this component’s prop references and its instances across the website.
        </p>
      )}
    </>
  );
}
function PropertyFlags({ property, update }: PropertyControls) {
  return (
    <div className="property-flags">
      <label>
        <input
          type="checkbox"
          checked={property.required}
          onChange={(event) => update('required', event.target.checked)}
        />
        Required
      </label>
      <label>
        <input
          type="checkbox"
          checked={property.readonly}
          onChange={(event) => update('readonly', event.target.checked)}
        />
        Readonly
      </label>
    </div>
  );
}

function changePropertyOptions(
  property: ComponentProperty,
  type: string,
  rename?: OptionRename
): ComponentProperty {
  if (rename && property.defaultValue.trim()) {
    const current = propertyDefaultText(property.defaultValue);
    const same =
      property.defaultValue.trim() === rename.from ||
      (current !== undefined && current === propertyDefaultText(rename.from));
    if (same) {
      return { ...property, type, defaultValue: rename.to };
    }
  }
  return { ...property, type };
}
