import { useState } from 'react';
import { useComponentProperties } from './useComponentProperties';
import type { ComponentPropertiesPanelProps } from './useComponentProperties';
import type {
  ComponentProperties,
  ComponentProperty,
  PropertyChange,
} from '../../shared/component-properties';
import useListReorder from '../ui/useListReorder';
import { TrashIcon } from '../ui/Icons';
import { PropertyGrip, movePropertyItem } from './PropertyReorder';
import { PropertiesIcon } from '../ui/PropertiesIcon';
import { PropertyEditor } from './PropertyEditor';
import './componentProperties.css';

type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'property'; readonly originalName: string; readonly value: ComponentProperty };
const EMPTY_PROPERTY: ComponentProperty = {
  name: '',
  type: 'string',
  required: false,
  readonly: false,
  defaultValue: '',
  description: '',
};

export default function ComponentPropertiesPanel(props: ComponentPropertiesPanelProps) {
  const controller = useComponentProperties(props);
  const data = controller.state.kind === 'ready' ? controller.state.data : undefined;
  return (
    <section className="component-properties" aria-label="Component properties">
      <header className="panel-heading">
        <strong>Properties</strong>
      </header>
      <div className="property-component">
        <PropertiesIcon size={16} />
        {props.name}
      </div>
      {controller.state.kind === 'loading' && <p className="property-help">Loading properties…</p>}
      {controller.state.kind === 'error' && <p role="alert">{controller.state.message}</p>}
      {data && (
        <PropertyPanelContent
          key={controller.revision}
          data={data}
          busy={controller.busy}
          save={controller.save}
        />
      )}
      {controller.error && (
        <p className="property-error" role="alert">
          {controller.error}
        </p>
      )}
    </section>
  );
}

interface PropertyContentProps {
  readonly data: ComponentProperties;
  readonly busy: boolean;
  readonly save: (change: PropertyChange) => Promise<boolean>;
}
function PropertyPanelContent({ data, busy, save }: PropertyContentProps) {
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  return (
    <>
      {selection.kind === 'none' && (
        <button
          className="property-add"
          aria-label="Add property"
          title="Add property"
          disabled={data.advanced || busy}
          onClick={() =>
            setSelection({
              kind: 'property',
              originalName: '',
              value: EMPTY_PROPERTY,
            })
          }
        >
          +
        </button>
      )}
      <>
        {selection.kind === 'none' && (
          <>
            <PropertyList
              data={data}
              busy={busy}
              onSelect={(value) =>
                setSelection({ kind: 'property', originalName: value.name, value })
              }
              onChange={save}
            />
          </>
        )}
        {data.advanced && (
          <p className="property-help">
            This component imports or combines its prop contract. Declare fields in Props to edit
            them.
          </p>
        )}
        <PropertySelectionEditor
          selection={selection}
          data={data}
          busy={busy}
          save={save}
          onClose={() => setSelection({ kind: 'none' })}
        />
      </>
    </>
  );
}

function PropertySelectionEditor({
  selection,
  data,
  busy,
  save,
  onClose,
}: PropertyContentProps & {
  readonly selection: Selection;
  readonly onClose: () => void;
}) {
  return (
    <>
      {selection.kind === 'property' && (
        <PropertyEditor
          key={selection.originalName}
          property={selection.value}
          originalName={selection.originalName}
          disabled={busy || data.advanced}
          onClose={onClose}
          onSave={async (change) => {
            if (await save(change)) {
              onClose();
            }
          }}
        />
      )}
    </>
  );
}

interface PropertyListProps {
  readonly data: ComponentProperties;
  readonly busy: boolean;
  readonly onSelect: (property: ComponentProperty) => void;
  readonly onChange: (change: PropertyChange) => Promise<boolean>;
}
function PropertyList({ data, busy, onSelect, onChange }: PropertyListProps) {
  const disabled = busy || data.advanced;
  const move = (source: number, gap: number): void => {
    const next = movePropertyItem(data.properties, source, gap);
    if (next !== data.properties) {
      void onChange({ kind: 'order', names: next.map((property) => property.name) });
    }
  };
  const reorder = useListReorder({ count: data.properties.length, onMove: move, disabled });
  return (
    <div className="property-list">
      {data.properties.length === 0 && (
        <p className="property-help">
          No properties yet. Add a property to define what each instance can customize.
        </p>
      )}
      {data.properties.map((property, index) => (
        <div
          className={`property-row ${reorder.rowClass(index)}`}
          key={property.name}
          {...reorder.rowProps(index)}
        >
          <PropertyGrip
            label={property.name}
            index={index}
            count={data.properties.length}
            disabled={disabled}
            onMove={move}
          />
          <button className="property-row-main" disabled={busy} onClick={() => onSelect(property)}>
            <span className="property-type-icon" aria-hidden="true">
              {property.type.includes('|')
                ? '◇'
                : property.type === 'boolean'
                ? '◉'
                : property.type === 'number'
                ? '#'
                : property.type === 'string'
                ? 'T'
                : '{}'}
            </span>
            <span className="property-row-label">
              <span>
                {property.name}
                {property.required && (
                  <span title="Required" className="property-required">
                    {' '}
                    *
                  </span>
                )}
              </span>
              <small>{property.type}</small>
            </span>
          </button>
          <button
            className="property-remove"
            aria-label={`Delete ${property.name}`}
            title="Delete property"
            disabled={disabled}
            onClick={() => void onChange({ kind: 'remove', name: property.name })}
          >
            <TrashIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
