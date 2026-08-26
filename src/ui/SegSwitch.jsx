import React from 'react';

// Two or three choices, side by side, one of them on. The props panel's yes/no
// and the object field's use the same one — a boolean looks the same wherever
// it is asked about.
export default function SegSwitch({ options, current, onPick }) {
  const at = options.findIndex((o) => o.value === current);
  return (
    <div className={`bool-seg ${at === 1 ? 'is-second' : 'is-first'}`} role="group">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={o.value === current ? 'on' : ''}
          aria-pressed={o.value === current}
          title={o.label}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
