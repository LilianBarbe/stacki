import React from 'react';
import PropertyReadOnlyFields from './PropertyReadOnlyFields.jsx';
import {
  PropertyConditions,
  PropertyDeclarationInfo,
} from './PropertyDeclarationInfo.jsx';
import { TrashIcon } from '../ui/Icons.jsx';
import { PropertyOptions } from './PropertyOptions.jsx';
import { PropertyType } from './PropertyType.jsx';
import { PropertyDefault, propertyDefaultText } from './PropertyDefault.jsx';
export { literalOptions } from '../propertyOptions.js';
import { useRef, useState } from 'react';
import useDismiss from '../ui/useDismiss.js';
import { PROPERTY_LIMITS } from '../../shared/component-properties.mjs';
export function PropertyEditor(props) {
  const editorRef = useRef(null);
  useDismiss(editorRef, props.access !== 'saving', props.onClose);
  const [property, setProperty] = useState(props.property);
  const [error, setError] = useState('');
  const update = (key, value) => {
    setProperty((previous) => ({ ...previous, [key]: value }));
    setError('');
  };
  const submit = () => {
    if (!/^[A-Za-z_$][\w$]*$/.test(property.name)) {
      setError('Use a name such as title, imageUrl, or isVisible.');
      return;
    }
    void props.onSave({
      kind: 'save',
      originalName: props.originalName,
      property,
    });
  };
  return (
    <div className="property-editor" ref={editorRef}>
      <header>
        <div className="property-editor-title">
          <strong>
            {props.originalName ? 'Property settings' : 'New property'}
          </strong>
          <PropertyDeclarationInfo property={props.property} />
        </div>
        <button
          aria-label="Close property settings"
          disabled={props.access === 'saving'}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <PropertyConditions property={props.property} />
      {props.access === 'readonly' ? (
        <PropertyReadOnlyFields property={property} />
      ) : (
        <PropertyEditorFields
          property={property}
          originalName={props.originalName}
          access={props.access}
          onSave={props.onSave}
          update={update}
          error={error}
          submit={submit}
          changeOptions={(type, rename) =>
            setProperty((previous) =>
              changePropertyOptions(previous, type, rename),
            )
          }
        />
      )}
    </div>
  );
}
function PropertyEditorFields({
  property,
  originalName,
  access,
  onSave,
  update,
  error,
  submit,
  changeOptions,
}) {
  return (
    <fieldset disabled={access === 'saving'}>
      <PropertyIdentity
        property={property}
        originalName={originalName}
        update={update}
      />
      <PropertyType
        type={property.type}
        onChange={(type) => update('type', type)}
      />
      <PropertyOptions
        type={property.type}
        disabled={access === 'saving'}
        onChange={(type, rename) => changeOptions(type, rename)}
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
      <PropertyActions
        originalName={originalName}
        onSave={onSave}
        submit={submit}
      />
    </fieldset>
  );
}
function PropertyActions({ originalName, onSave, submit }) {
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
function PropertyIdentity({ property, originalName, update }) {
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
          Renaming updates this component’s prop references and its instances
          across the website.
        </p>
      )}
    </>
  );
}
function PropertyFlags({ property, update }) {
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
function changePropertyOptions(property, type, rename) {
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
