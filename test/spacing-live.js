// The band on the canvas is the number in the panel, on the same frame.
//
//   node test/spacing-live.js
//
// Dragging a side of the spacing box runs the panel's number through every
// value on the way — 1, 2, 3 … 16 — but the band drawn over the page was
// sized from the page as last MEASURED: the value had to be written, laid
// out and reported back, a few frames behind and skipping whatever the page
// had no time to lay out. The drag now hands the canvas its value directly
// (SpacingHover.live), and the canvas turns it into pixels itself, with the
// units the page reported alongside its measurements.

const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

(async () => {
  const { lengthToPx, withLiveSpacing, spacingBands } = await import(
    path.join(__dirname, '..', 'src', 'spacingBands.js')
  );

  const units = { em: 20, rem: 16, vw: 12, vh: 8 };

  // --- a length in pixels --------------------------------------------------------
  check('px is itself', lengthToPx('12px', units) === 12);
  check('rem is the root font', lengthToPx('2rem', units) === 32);
  check('em is the element’s font', lengthToPx('1.5em', units) === 30);
  check('vw and vh are the frame', lengthToPx('10vw', units) === 120 && lengthToPx('5vh', units) === 40);
  check('a decimal without a leading zero', lengthToPx('.5rem', units) === 8);
  check('a negative margin', lengthToPx('-1rem', units) === -16);
  check('!important is not part of the number', lengthToPx('3rem !important', units) === 48);
  check('a bare zero is a length', lengthToPx('0', units) === 0);
  check('a bare number otherwise is not', lengthToPx('4', units) === null);
  check('a percentage is the page’s to work out', lengthToPx('10%', units) === null);
  check('and so is a variable', lengthToPx('var(--space-4)', units) === null);
  check('and a calc', lengthToPx('calc(1rem + 2px)', units) === null);
  check('a unit the page did not price is not guessed', lengthToPx('2rem', {}) === null);

  // --- the measurement with the drag laid over it ----------------------------------
  const measured = {
    padding: { top: 16, right: 0, bottom: 16, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    gaps: [],
    units,
  };
  {
    const live = withLiveSpacing(measured, 'padding', { top: '3rem' });
    check('a dragged side takes the dragged value', live.padding.top === 48, JSON.stringify(live.padding));
    check('the other sides keep their measurement', live.padding.bottom === 16 && live.padding.left === 0);
    check('the measurement itself is left alone', measured.padding.top === 16);
    check('the other box is untouched', live.margin === measured.margin);
  }
  {
    const live = withLiveSpacing(measured, 'padding', { top: 'var(--space-8)' });
    check('a value only the page can size keeps the measurement', live === measured);
  }
  check('nothing dragged, nothing changed', withLiveSpacing(measured, 'margin', undefined) === measured);
  check('gap is not sized this way', withLiveSpacing(measured, 'gap', { row: '1rem' }) === measured);
  check('no measurement yet, no band to size', withLiveSpacing(undefined, 'padding', { top: '1rem' }) === undefined);

  // --- what ends up on the page ------------------------------------------------------
  // Through spacingBands, the way PreviewPane draws it: the band for the
  // dragged side is as tall as the number says, while the pointer is still
  // moving and before the page has been measured again.
  {
    const box = { x: 100, y: 200, w: 400, h: 300 };
    const values = ['1rem', '2rem', '3rem', '16rem'];
    const heights = values.map(
      (v) => spacingBands(box, withLiveSpacing(measured, 'padding', { top: v }), 'padding', ['top'])[0]?.h
    );
    check('the band passes through every value the panel shows', heights.join() === '16,32,48,256', heights.join());
    const margin = spacingBands(box, withLiveSpacing(measured, 'margin', { top: '2rem' }), 'margin', ['top'])[0];
    check('a margin band grows outward from the box', margin?.y === 200 - 32 && margin?.h === 32, JSON.stringify(margin));
  }

  if (failures.length) {
    console.error(`spacing-live: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`spacing-live: ${checked} passed  [a dragged side is sized from its value, not the last measurement]`);
})();
