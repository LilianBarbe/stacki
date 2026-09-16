import React from 'react';
import { arrayItems, arrayText, objectFields, objectText } from '../arrayValue.js';
import ListField from './ListField.jsx';
import SegSwitch from '../ui/SegSwitch.jsx';

// A prop whose value is an object, edited as the fields it holds.
//
// `tags={{ legend: "Ministry Role", options: ["Pastors", "Staff"] }}` is not a
// program, it is a form someone filled in: a line of text and a list. Shown as
// code it is a box of JSON to retype by hand, with the quoting and the commas
// left to the person — which is the one part of it a computer should be doing.
//
// So each key gets the control its value asks for: a box for a word, a number
// field for a number, True/False for a yes-or-no, and for a list, the same rows
// the list control draws anywhere else — drag to reorder, click to edit, the
// bin to drop one.
//
// What it will not show, it does not touch: an object inside an object, a call,
// a name standing for something elsewhere. Those keep the code editor, which is
// one press of `{}` away in either direction (see arrayValue.js).
export default function ObjectField({ value, onChange }) {
  const fields = objectFields(value) || [];

  // `immediate` is the app's word for "this is the edit, save it". Typing is
  // live so the canvas keeps up, and the edit lands as one when the field is
  // left — otherwise a word typed letter by letter is a dozen things to undo.
  const write = (next, immediate = true) => onChange(objectText(next), immediate);
  const set = (index, patch, immediate = true) =>
    write(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)), immediate);

  return (
    <div className="object-field">
      {fields.map((field, i) => (
        <div className="object-field-row" key={field.key}>
          <span className="object-field-key" title={field.key}>
            {field.key}
          </span>
          {field.kind === 'list' ? (
            <ListField
              value={arrayText(field.items)}
              onChange={(text, immediate) =>
                set(i, { items: arrayItems(text) || [] }, immediate !== false)
              }
            />
          ) : field.kind === 'boolean' ? (
            <SegSwitch
              options={[
                { value: true, label: 'True' },
                { value: false, label: 'False' },
              ]}
              current={field.text === 'true'}
              onPick={(next) => set(i, { text: next ? 'true' : 'false' })}
            />
          ) : (
            <input
              className="object-field-input"
              value={field.text}
              spellCheck={false}
              inputMode={field.kind === 'number' ? 'decimal' : undefined}
              onChange={(e) => set(i, { text: e.target.value }, false)}
              // A number that has stopped being one would be written into the
              // file unquoted, where it is not a value at all — so what is not
              // a number is written as the text it now is.
              onBlur={() =>
                set(i, field.kind === 'number' && !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(field.text.trim())
                  ? { kind: 'text', quote: '"' }
                  : {})
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {e.currentTarget.blur();}
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
