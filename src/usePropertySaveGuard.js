import { useEffect, useRef, useState } from 'react';
// A prop edit spans multiple files. Hold interaction until the old editor model
// has been replaced, otherwise an ordinary autosave could resurrect the old API.
export function usePropertySaveGuard() {
  const saving = useRef(false);
  const [phase, setPhase] = useState('idle');
  const changePhase = (next) => {
    saving.current = next === 'saving';
    setPhase(next);
  };
  useEffect(() => {
    const block = (event) => {
      if (saving.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const events = [
      'keydown',
      'pointerdown',
      'mousedown',
      'click',
      'dblclick',
      'drop',
    ];
    for (const event of events) {
      window.addEventListener(event, block, true);
    }
    return () => {
      for (const event of events) {
        window.removeEventListener(event, block, true);
      }
    };
  }, []);
  return { phase, saving, changePhase };
}
