import React from 'react';
export default function PropertyReadOnlyFields({ property }) {
  const reason =
    property.editing?.kind === 'restricted'
      ? property.editing.reason
      : 'Edit this prop’s declaration in source.';
  return (
    <div className="property-readonly-fields">
      <p className="property-help">{reason}</p>
      <ReadOnlyField label="Name" value={property.name} />
      <ReadOnlyField label="Type expression" value={property.type} />
      <div className="property-flags">
        <label>
          <input type="checkbox" checked={property.required} disabled />
          Required
        </label>
        <label>
          <input type="checkbox" checked={property.readonly} disabled />
          Readonly
        </label>
      </div>
      <ReadOnlyField label="Default value" value={property.defaultValue} />
      <ReadOnlyField label="Tooltip" value={property.description} />
    </div>
  );
}
function ReadOnlyField({ label, value }) {
  return (
    <label>
      {label}
      <textarea
        readOnly
        value={value}
        rows={label === 'Tooltip' ? 3 : 1}
        aria-label={label}
        placeholder="Not specified"
      />
    </label>
  );
}
