// Two or three choices, side by side, one of them on. The props panel's yes/no
// and the object field's use the same one — a boolean looks the same wherever
// it is asked about.
export default function SegSwitch<T extends string | number | boolean | null>({
  options,
  current,
  onPick,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly current?: T;
  readonly onPick: (value: T) => void;
}) {
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
