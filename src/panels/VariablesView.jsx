import Sheet from './VariableTable';
import Cell from './VariableCell';
import {dropPlan,stemOf,sectionPrefix,rowRenames,buildSheetSlots} from './variableRows';
import {createScrollSync} from './variableScroll';
export {dropPlan,movesForDrop} from './variableRows';
export {createScrollSync} from './variableScroll';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, CheckIcon, CopyIcon, DragIcon, EaseIcon, MoreIcon, PencilIcon, PlusIcon, TrashIcon } from '../ui/Icons.jsx';
import useListReorder from '../ui/useListReorder.js';
import useDismiss from '../ui/useDismiss.js';
import MoreMenu from '../ui/MoreMenu.jsx';
import VariableTypeIcon from '../ui/VariableTypeIcon.jsx';
import FluidBadge from '../ui/FluidBadge.jsx';
import { fluidCheck, resolveValue } from '../fluid.js';
import ColorSwatch from '../style-panel/components/ColorSwatch';
import VariableConnect from '../style-panel/VariableConnect';
import EasingEditor, { MiniCurve } from '../style-panel/EasingEditor';
import { easingToBezier, isEasing } from '../style-panel/lib/transition';
import { setHost } from '../style-panel/lib/host';
import { popupBox, POPUP_GAP } from '../ui/Dropdown.jsx';
import CustomValue, { doesNotFit, isLong, withBinding } from '../ui/CustomValueEditor.jsx';
import '../style-panel/utilities.css';

// The variables sheet: one group of a stylesheet, as tables.
//
// Two kinds of table, because there are two ways a set of variables can be the
// same thing more than once (see electron/cssVars.js):
//
//   modes    one rule per column — a light theme, a dark one, a brand one —
//            with the variable names down the side. What you want to see is
//            one name across all of them at once, which is a row.
//   matrix   one rule, but names that share their endings: `--h1-line-height`
//            and `--text-small-line-height` are one property of two things. The
//            things are the columns and the properties are the rows.
//
// Anything that is neither is a plain list, which is the same table with one
// column. A value that is only a reference to another variable shows that
// variable's name rather than its own text, because that is what was written
// and what the author would go looking for.

const SAVE_ON = ['Enter', 'Tab'];

// Everything this sheet writes goes over the preload bridge, and the bridge is
// only rebuilt when the app restarts — so a method added since the running app
// started is simply not there. Left alone, that throws inside an async handler
// and looks exactly like a feature that does nothing: pressing the button, and
// nothing happening, with nothing said. It says so instead.
const RESTART = 'Stacki needs to be restarted before this can be used.';

/**
 * What went wrong, in words that say what to do about it.
 *
 * There are two ways a call can be missing, and they look nothing alike. The
 * bridge is built when the app starts, so a method added since is simply not
 * there — that one is caught before calling. The other is worse: reloading the
 * window rebuilds the bridge but NOT the main process behind it, so the method
 * exists, the call goes out, and the answer is "No handler registered for
 * 'css:moveHeading'" — which reads like a bug in the feature rather than an app
 * that is half a version behind itself. Same cause, same remedy.
 */
export function friendlyError(err) {
  const text = String(err?.message || err).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
  return /No handler registered/i.test(text) ? RESTART : text;
}

async function bridge(name, payload) {
  const call = window.avb?.[name];
  if (typeof call !== 'function') {
    return { ok: false, error: RESTART };
  }
  try {
    return (await call(payload)) || { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}



// And one curve editor, for the same reason: each cell owns its own, so the
// sheet holds the pointer and opening another closes the one before it —
// keeping whatever that one had been dragged to.





// Every value is an editable field, and a value that references another
// variable draws that reference as a purple chip inside the field — the same
// control the style panel uses (VariableConnect), so a chip behaves the same in
// both places: click it to swap the variable, type in front of or behind it
// (`calc(`, `!important`), backspace to remove it.
//
// The colour box is beside the field rather than in it, because it is not part
// of the text: clicking it opens the picker, and what the picker returns is
// written as the value.


export default function VariablesView({ project, selected, hidden, onClose, showToast, onRecordUndo }) {
  const [files, setFiles] = useState([]);
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState('');
  // What is being typed, by variable name, before it has been saved. A clamp()
  // is only as accessible as the numbers it references, and those are usually
  // three rows further down the same table — so the badge has to be recomputed
  // from the draft, not from the file.
  const [drafts, setDrafts] = useState({});
  // `move` is defined above the point where the selected file is worked out, and
  // a drop needs to know which file it is writing to — so it reads it from here.
  const fileRef = useRef(null);
  const firstSelectorRef = useRef(':root');


  const refresh = useCallback(async () => {
    const result = await window.avb.cssVariables(project.path);
    setFiles(result?.files || []);
    setValues(result?.values || {});
    setDrafts({});
  }, [project.path]);

  useEffect(() => {
    refresh();
    return window.avb.onCssChanged(refresh);
  }, [refresh]);

  // The variable picker inside a field reads the project from the style panel's
  // shared host, which is set while that panel is mounted — and it is not,
  // unless an element is selected. Set it here too, so a chip can be swapped
  // from this sheet on its own.
  useEffect(() => {
    setHost({ projectPath: project.path });
  }, [project.path]);

  const file = files.find((f) => f.rel === selected?.file);
  const group = file?.groups?.[selected?.index];
  fileRef.current = file || null;
  firstSelectorRef.current = group?.columns?.[0]?.selector || ':root';

  // Undo, for the things this sheet writes.
  //
  // These edits do not go through the page model — they rewrite stylesheets on
  // disk — so ⌘Z would step straight past them to the last layout change unless
  // each one hands the app a way back. Deleting a group in particular is one
  // keystroke away from being gone, and it was.
  //
  // A single-file edit remembers the file as it was and as it became: writing
  // either one back IS the undo (and the redo), which is exact and needs no
  // second implementation of the edit to run backwards.
  const fileText = useCallback(
    async (rel) => {
      const result = await bridge('readStyleFile', `${project.path}/${rel}`);
      return typeof result?.css === 'string' ? result.css : null;
    },
    [project.path]
  );
  const putFiles = useCallback(
    async (texts) => {
      for (const [rel, css] of Object.entries(texts)) {
        if (css == null) {continue;}
        await bridge('writeStyleFile', { filePath: `${project.path}/${rel}`, css });
      }
      await refresh();
    },
    [project.path, refresh]
  );
  /**
   * Run an edit and put it on the undo stack, as the text of the files it
   * touched before and after. A rename reaches every file that mentions the
   * name and a group can straddle two stylesheets, so the unit is a set of
   * files rather than one — and reading them back is the only inverse that
   * doesn't need a second implementation of the edit to run backwards.
   *
   * `run` returns false to skip. `coalesceKey` collapses a burst into one step:
   * typing a value is one edit however many keystrokes it took.
   */
  const writeWithUndo = useCallback(
    async (rels, label, run, coalesceKey = null) => {
      const list = [...new Set((Array.isArray(rels) ? rels : [rels]).filter(Boolean))];
      const read = async () =>
        Object.fromEntries(await Promise.all(list.map(async (rel) => [rel, await fileText(rel)])));
      const before = list.length ? await read() : {};
      const ok = await run();
      if (ok === false || !list.length) {return;}
      const after = await read();
      const changed = list.filter(
        (rel) => before[rel] != null && after[rel] != null && before[rel] !== after[rel]
      );
      if (!changed.length) {return;}
      const only = (texts) => Object.fromEntries(changed.map((rel) => [rel, texts[rel]]));
      onRecordUndo?.({
        label,
        coalesceKey,
        undo: () => putFiles(only(before)),
        redo: () => putFiles(only(after)),
      });
    },
    [fileText, putFiles, onRecordUndo]
  );

  const save = useCallback(
    async (cell, value) => {
      // One step per value, not per keystroke: the field writes as it is typed
      // and the burst collapses on the key.
      await writeWithUndo(
        cell.file,
        'the value',
        async () => {
          const result = await bridge('setCssVariable', {
            projectPath: project.path,
            file: cell.file,
            valueStart: cell.valueStart,
            valueEnd: cell.valueEnd,
            expect: cell.value,
            value,
          });
          if (!result.ok) {
            showToast?.(result.error || 'Could not write that value.', 'error');
            await refresh();
            return false;
          }
          setSaved(true);
          setTimeout(() => setSaved(false), 1200);
          await refresh();
          return true;
        },
        `var:${cell.file}:${cell.name}`
      );
    },
    [project.path, refresh, showToast, writeWithUndo]
  );

  // Dragging a row moves the declaration inside its rule — a row in a table of
  // modes is one name in several rules, so it moves in each of them.
  // A drop is either variables moving between groups, or a heading moving
  // between variables — which is the same file in both cases, so the same undo.
  const move = useCallback(
    async (slots, from, to) => {
      const plan = dropPlan(slots, from, to);
      if (!plan) {return;}
      if (plan.kind === 'rows') {
        if (!plan.moves.length) {return;}
        // Every file the plan names, not just the first: one name can be
        // declared in two stylesheets, and putting back half of a move is
        // worse than not putting it back at all.
        await writeWithUndo(plan.moves.map((m) => m.file), 'the move', async () => {
          const result = await bridge('moveCssVariables', { projectPath: project.path, moves: plan.moves });
          if (!result.ok) {showToast?.(result.error || 'Could not move that.', 'error');}
          await refresh();
          return result.ok;
        });
        return;
      }
      const anchor = plan.block.rows.map((row) => row.cells.find(Boolean)).find(Boolean);
      await writeWithUndo(fileRef.current?.rel, 'the group', async () => {
        const result = await bridge('moveCssHeading', {
          projectPath: project.path,
          file: fileRef.current?.rel,
          selector: anchor?.selector || firstSelectorRef.current,
          start: plan.block.titleStart,
          end: plan.block.titleEnd,
          expect: plan.block.title,
          before: plan.before,
        });
        if (!result.ok) {showToast?.(result.error || 'Could not move that.', 'error');}
        await refresh();
        return result.ok;
      });
    },
    [project.path, refresh, showToast, writeWithUndo]
  );

  // Dragging a group moves everything under its heading — the comment included
  // — in each rule the group appears in.
  const moveGroup = useCallback(
    async (list, from, to) => {
      const source = list[from];
      const target = to > from ? list[to] : list[to] ?? null;
      if (!source || source === target) {return;}
      const columns = source.rows[0]?.cells?.length || 1;
      const moves = [];
      for (let column = 0; column < columns; column++) {
        const names = source.rows.map((row) => row.cells[column]).filter(Boolean).map((c) => c.name);
        if (!names.length) {continue;}
        const anchor = source.rows.find((row) => row.cells[column])?.cells[column];
        const landing = target?.rows.map((row) => row.cells[column]).find(Boolean);
        moves.push({ file: anchor.file, selector: anchor.selector, names, target: landing ? landing.name : null });
      }
      if (!moves.length) {return;}
      // A group can be declared in more than one stylesheet, so the edit is
      // whatever files its moves name.
      await writeWithUndo(moves.map((m) => m.file), 'the group', async () => {
        const result = await bridge('moveCssVariables', { projectPath: project.path, moves });
        if (!result.ok) {showToast?.(result.error || 'Could not move that.', 'error');}
        await refresh();
        return result.ok;
      });
    },
    [project.path, refresh, showToast, writeWithUndo]
  );

  // Adding a variable to a group. What the name is depends on the shape of the
  // group: in a family the typed word is the property (`--h1-<word>` for every
  // column), in a group named after a prefix it is what follows that prefix,
  // and in a plain list it is the whole name. In every case it lands under the
  // group's last variable rather than at the end of the rule.
  const add = useCallback(
    async (block, columns, word) => {
      const typed = word.trim().replace(/^--/, '');
      if (!typed) {return;}
      const last = block.rows[block.rows.length - 1];
      const adds = [];
      columns.forEach((column, index) => {
        const anchor = last?.cells[index] || block.rows.map((r) => r.cells[index]).filter(Boolean).pop();
        if (!anchor) {return;}
        const name =
          block.kind === 'matrix'
            ? `--${column.label}-${typed}`
            : `${stemOf(block)}${typed}`;
        adds.push({ file: anchor.file, selector: anchor.selector, name, value: 'unset', after: anchor.name });
      });
      if (!adds.length) {return;}
      await writeWithUndo(adds.map((a) => a.file), 'the variable', async () => {
        const result = await bridge('addCssVariables', { projectPath: project.path, adds });
        if (!result.ok) {showToast?.(result.error || 'Could not add that.', 'error');}
        await refresh();
        return result.ok;
      });
    },
    [project.path, refresh, showToast, writeWithUndo]
  );

  // Renaming a variable — or a group of them, which is the same thing done to
  // every member at once. A name is not held anywhere but in the text that
  // declares and reads it, so this is one call that rewrites all of it; the
  // panel reloads from the files afterwards either way.
  const rename = useCallback(
    async (renames) => {
      if (!renames?.length) {return true;}
      const result = await bridge('renameCssVariables', { projectPath: project.path, renames });
      if (!result.ok) {
        showToast?.(result.error || 'Could not rename that.', 'error');
        await refresh();
        return false;
      }
      // A rename reaches as many files as mention the name, so its inverse is
      // not a file to put back — it is the same rename read backwards.
      const back = renames.map(({ from, to }) => ({ from: to, to: from }));
      const apply = async (list) => {
        await bridge('renameCssVariables', { projectPath: project.path, renames: list });
        await refresh();
      };
      onRecordUndo?.({
        label: renames.length > 1 ? 'the group rename' : 'the rename',
        undo: () => apply(back),
        redo: () => apply(renames),
      });
      await refresh();
      return true;
    },
    [project.path, refresh, showToast, onRecordUndo]
  );

  // A heading that is a comment in the file rather than a name its rows share.
  // Renaming it writes those words; nothing else in the project refers to them,
  // so unlike a variable's name this reaches exactly one place.
  const retitleOnce = useCallback(
    async (block, title) => {
      const result = await bridge('setCssSectionTitle', {
        projectPath: project.path,
        file: file?.rel,
        start: block.titleStart,
        end: block.titleEnd,
        expect: block.title,
        title,
      });
      if (!result.ok) {
        showToast?.(result.error || 'Could not rename that.', 'error');
        await refresh();
        return false;
      }
      await refresh();
      return true;
    },
    [project.path, file?.rel, refresh, showToast]
  );

  const retitle = useCallback(
    async (block, title) => {
      let ok = true;
      await writeWithUndo(file?.rel, 'the heading', async () => {
        ok = await retitleOnce(block, title);
        return ok;
      });
      return ok;
    },
    [file?.rel, writeWithUndo, retitleOnce]
  );

  // Another heading, written directly above this one — so the new group starts
  // empty, with nothing of this one's in it. Its variables are the ones you put
  // there afterwards, which is what an empty group is for.
  const duplicateSection = useCallback(
    async (block) => {
      const anchor = block.rows.map((row) => row.cells.find(Boolean)).find(Boolean);
      await writeWithUndo(file?.rel, 'the group', async () => {
        const result = await bridge('addCssSection', {
          projectPath: project.path,
          file: file?.rel,
          selector: anchor?.selector,
          title: `${block.title} copy`,
          at: block.titleStart,
        });
        if (!result.ok) {showToast?.(result.error || 'Could not duplicate that.', 'error');}
        await refresh();
        return result.ok;
      });
    },
    [project.path, file?.rel, refresh, showToast, writeWithUndo]
  );

  // Deleting a heading deletes the comment and nothing else: its variables join
  // the group above, which is what removing a line between two runs does.
  const deleteSection = useCallback(
    async (block) => {
      await writeWithUndo(file?.rel, 'deleting the group', async () => {
        const result = await bridge('removeCssSection', {
          projectPath: project.path,
          file: file?.rel,
          start: block.titleStart,
          end: block.titleEnd,
          expect: block.title,
        });
        if (!result.ok) {showToast?.(result.error || 'Could not delete that.', 'error');}
        await refresh();
        return result.ok;
      });
    },
    [project.path, file?.rel, refresh, showToast, writeWithUndo]
  );

  // What the accessibility check makes of a value right now — the file's values
  // with whatever is in the fields on top.
  const fluidOf = useCallback(
    (cell) => {
      if (!cell) {return null;}
      const own = drafts[cell.name];
      const check = fluidCheck(resolveValue(own ?? cell.value, values, drafts));
      return check && check.status !== 'ok' ? check : null;
    },
    [values, drafts]
  );

  const noteDraft = useCallback((name, value) => {
    setDrafts((current) => {
      if (value === null) {
        if (!(name in current)) {return current;}
        const next = { ...current };
        delete next[name];
        return next;
      }
      return current[name] === value ? current : { ...current, [name]: value };
    });
  }, []);

  const blocks = useMemo(() => {
    if (!group) {return [];}
    const q = query.trim().toLowerCase();
    if (!q) {return group.blocks;}
    return group.blocks
      .map((block) => ({
        ...block,
        rows: block.rows.filter(
          (row) =>
            `${block.title || ''} ${row.label} ${row.name || ''}`.toLowerCase().includes(q) ||
            row.cells.some((c) => c && `${c.name} ${c.value}`.toLowerCase().includes(q))
        ),
      }))
      .filter((block) => block.rows.length);
  }, [group, query]);

  if (!group) {return <div className={`cms-view vars-view ${hidden ? 'hidden' : ''}`} />;}


  return (
    <div className={`cms-view vars-view ${hidden ? 'hidden' : ''}`}>
      <div className="cms-detail">
        <div className="cms-detail-head">
          <button className="ghost cms-back" title="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
          <span className="cms-detail-title">{group.label}</span>
          <span className={`cms-saved ${saved ? 'on' : ''}`}>
            <CheckIcon size={11} /> Saved
          </span>
          <input
            className="vars-search"
            value={query}
            placeholder="Search variables"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="cms-detail-path">{file.rel}</span>
        </div>

        <div className="cms-detail-body vars-body">
          <Sheet
            blocks={blocks}
            group={group}
            onSave={save}
            onMove={move}
            onMoveGroup={moveGroup}
            onAdd={add}
            onRename={rename}
            onRetitle={retitle}
            onDuplicateSection={duplicateSection}
            onDeleteSection={deleteSection}
            fluidOf={fluidOf}
            onDraft={noteDraft}
          />
        </div>
      </div>
    </div>
  );
}

// Groups with the same number of columns are the same width and start their
// columns at the same x, so one of them scrolled and the others not breaks the
// line the eye follows down the sheet — `button`'s dark column would sit over
// `selection`'s light one. They move together. A group with a different number
// of columns is a different width, has nothing to line up with, and is left
// where it is.




// The two stacks' tracks. Fixed, not fractions, so every table starts its
// columns at the same x however many it has — and so the sheet's headings sit
// over the columns they name. See the note in Table.
const LABEL_TRACKS = 'calc(var(--vars-inset) + 18px) var(--vars-name-col)';
const valueTracks = (count) => `repeat(${count}, var(--vars-col))`;

// The tables of one group, and the drag that reorders them. The headings sit in
// different tables but are one list as far as dragging goes, so the gesture is
// owned here rather than by any one table.
// What a new name in this group starts with: everything its rows' names have in
// front of the label they show. `--selection-background` shown as `background`
// leaves `--selection-`; a plain list leaves `--`.


// The heading's own menu.
//
// A heading is a comment in the stylesheet, and the three things you can do to
// a comment are all here: change the words, put another one below (which splits
// the run of variables under it into two groups), and take it away — which
// leaves its variables where they are and folds them into the group above.
//
// Portaled and positioned against the button, because the sheet scrolls in both
// directions and a menu inside it would be cropped by whichever edge it met.
// The group's own `⋯`, from the app's one menu (src/ui/MoreMenu.jsx). This
// panel had the first one; the assets panel wanted the same thing, and two of
// them is one too many.


// What a drop means, as file edits.
//
// `slots` is every row in the sheet with a slot at the end of each group (see
// Sheet); `from` is the row being dragged and `to` is where the pointer let go.
// A row lands IN FRONT OF the next real row at or after that point — which is
// what carries it into another group, since a group is only the run of lines
// between two comments. Past the last row of all, it lands at the end of the
// rule, which is inside the last group.
//
// One move per column: a row in a table of modes is one name declared in
// several rules, and it has to move in each of them or the modes fall out of
// step with each other.




// A name you can rename by clicking it.
//
// A variable's name and a group's heading are both text on a row that also
// drags, so a press has two meanings and the field has to pick one: a click
// opens it, and once open the drag handlers are out of the way. It selects what
// is there because a rename usually replaces the name rather than tweaking it,
// and Escape puts back what it started with.




// The last line of every group: what adds a variable to it. It names the group
// it is in — a new row under `line-height` is `--line-height-<what you type>`,
// under `h1…h6` it is that property on every one of them — so what gets typed
// here is the part that is not already decided.


// The prefix a group's heading stands for, or null when the heading is not a
// prefix at all. A file with one rule takes its headings from the comments in
// it — `/* Radius */` is a note above some lines, not part of their names — and
// renaming that is editing a comment, which is a different thing from renaming
// a variable. Only a heading every row is actually named after can be renamed
// here.


// Renaming one row: in a table of modes the row is one name declared in several
// rules, so it is a single rename; in a matrix the row is one property of every
// column (`--h1-size`, `--h2-size`), so it is one rename per column.



