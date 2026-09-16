import PropField, { assetImportOf } from './PropField';
import { AttributesSection, ObjectAttrsField, parseObjectLiteral,
  serializeObjectLiteral } from './propAttributes';
import { referencedName, SourceEditButton, ExprValueField, ConditionField, BindHandle,
  FieldDataPicker, BindField, ValueCodeEditor } from './propBindings';
export { BindField } from './propBindings';
import { createPropRules } from './propRules';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HTML_TAGS, VOID_TAGS } from '../elementSchemas.js';
import { elementIcon } from '../ui/Icons.jsx';
import Dropdown from '../ui/Dropdown.jsx';
import AutoTextarea from '../ui/AutoTextarea.jsx';
import PropTip from '../ui/PropTip.jsx';
import ClassInput from '../ui/ClassInput.jsx';
import CodeEditor from '../ui/CodeEditor.jsx';
import ListField from './ListField.jsx';
import ObjectField from './ObjectField.jsx';
import SegSwitch from '../ui/SegSwitch.jsx';
import { arrayItems, objectFields } from '../arrayValue.js';
import { clickNote } from '../ui/sound.js';
import { SoundHere } from '../ui/soundScope.jsx';
import StyleEditor, { collapseDeclarations } from '../ui/StyleEditor.jsx';
import ExprInput from '../ui/ExprInput.jsx';
import RichContent, { isInlineOnly } from '../ui/RichContent.jsx';
import AssetField from '../ui/AssetField.jsx';
import { looksLikeAssetPath, mediaKindFor } from '../ui/AssetThumb.jsx';
import {
  dataTree,
  findImportOf,
  listsOnly,
  scopeChips,
  scopeCompletions,
} from '../dataSuggest.js';
import LinkField from '../ui/LinkField.jsx';
import {
  partsFromValue,
  valueFromParts,
} from '../bindings.js';
import {

  ResetIcon,
  FieldNumberIcon,
  ComponentPropertiesIcon,
  VariableTextSizeIcon,
  ElementComponentIcon,
  astroAssetIcon,
  FieldSwitchIcon,
  ElementSlotIcon,
  CommentIcon,
  CodeIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
  BracesIcon,
  ChevronRightIcon,
  TagIcon,
  ElementImageIcon,
  LayoutIcon,
  BranchIcon,
  CornerIcon,
} from '../ui/Icons.jsx';

// Edits the props of the selected node. Fields come from the component's
// prop schema (interface Props / Astro.props destructure), plus any props
// already set on the node that aren't in the schema.
// A click anywhere in a <label onClick={noLabelActivation}> is forwarded to the first control inside it.
// These labels hold no field — the input is their sibling — but they do hold
// the bind dot and the `{}` toggle, so a press on the empty space beside a
// prop's name, or on the name itself, was silently pressing a button. On a
// field showing an expression that button means "use the control instead",
// which drops a value no control can hold: clicking next to the label cleared
// the prop. The label has nothing to activate, so it activates nothing.
//
// The Attributes row below solves the same problem by not being a <label onClick={noLabelActivation}> at
// all; these keep the tag, since the panel's styling hangs off it.
const noLabelActivation = (event) => event.preventDefault();


// Whether the Settings group is open, remembered across selections. See where it
// is read, below.
let settingsGroupOpen = false;

export default function PropsPanel({
  node,
  /** Bumped by ⌘Enter — open Settings and focus the class field. */
  focusClass,
  /** Bumped by a canvas double-click on text — focus the Content field. */
  focusContent,
  isLayout,
  layouts,
  currentLayoutName,
  onChangeLayout,
  schema,
  slotOptions,
  takesSlotText,
  tagOptions,
  projectClasses,
  allowAttrs,
  comment,
  onSetComment,
  loopContext,
  /** loopContext plus what the app can see of the data itself — the entry on
      the canvas, this file's declared props. Feeds the binding picker. */
  bindContext,
  linkContext,
  onSetProp,
  onSetProps,
  onSetAssetProp,
  onRenameProp,
  onChangeTag,
  onSetText,
  onSetContent,
  onSetInline,
  onOpenCode,
  onSetFrontmatter,
  frontmatterSource,
  onOpenSymbol,
  onToggleElse,
  projectPath,
  filePath,
}) {
  // Held values belong to the panel, including while a non-element is selected.
  const stashRef = useRef(new Map());
  // What an expression field here can name — this file's props, its frontmatter
  // values, the item of any loop around the selection. Offered as you type, so a
  // name doesn't have to be remembered (or spelled right) to be used.
  const scope = scopeCompletions(bindContext || loopContext || {});
  // The same names, as a set: what an expression field draws as purple chips.
  const scopeNames = new Set(scope.map((c) => c.label.split('.')[0]));
  const chipsInScope = (text) => scopeChips(text, scopeNames);

  // Where the data a field points at can be edited: declarations in this
  // file's frontmatter, imports (which live in another file), and the two ways
  // of getting at them.
  const buildDataCtx = () => ({
    frontmatter: loopContext?.frontmatter || '',
    imports: frontmatterSource || '',
    onSetFrontmatter,
    onOpenSymbol,
  });

  if (!node) {
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%' }}>
        <div className="panel-header">
          <h2>Settings</h2>
        </div>
        <div className="props-empty">Select a component to edit its props.</div>
      </div>
    );
  }

  // The page frontmatter (imports, consts, data) opens in a floating editor.
  if (node.kind === 'frontmatter') {
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="props-title">
          <CodeIcon size={14} className="props-title-icon" />
          Frontmatter
        </div>
        <div className="props-field" style={{ marginTop: 4 }}>
          <button className="primary" style={{ width: '100%' }} onClick={onOpenCode}>
            <CodeIcon size={13} /> Edit code
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5 }}>
            Imports, constants, and data for this page. Opens in a floating
            editor you can move and resize while working with the canvas.
          </div>
        </div>
      </div>
    );
  }

  // Expression nodes ({items.map(...)}) get a raw code editor.
  if (node.kind === 'expr') {
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="panel-header">
          <h2>Expression</h2>
        </div>
        <div className="props-field" style={{ marginTop: 8 }}>
          <label onClick={noLabelActivation}>
            <span className="prop-label">Code</span>
          </label>
          <ExprInput
            key={node.id}
            value={node.value}
            syncValue={node.value}
            completions={scope}
            onCommit={(v) => v !== node.value && onSetText(v)}
          />
        </div>
      </div>
    );
  }

  // A literal line of source — in practice the doctype. It isn't an element,
  // so it has no tag and no props; without this it fell through to the
  // component render and claimed to "declare no props".
  if (node.kind === 'raw-line') {
    const isDoctype = /^<!doctype/i.test(node.value || '');
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="panel-header">
          <h2>{isDoctype ? 'Doctype' : 'Source line'}</h2>
        </div>
        <div className="props-field" style={{ marginTop: 8 }}>
          <label onClick={noLabelActivation}>
            <span className="prop-label">
              <CodeIcon size={12} className="prop-label-icon" />
              Line
            </span>
          </label>
          <AutoTextarea
            key={node.id}
            minRows={1}
            value={node.value}
            spellCheck={false}
            style={{ fontFamily: 'var(--mono)' }}
            onChange={(e) => onSetText(e.target.value)}
          />
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.5 }}>
            {isDoctype
              ? 'Written out verbatim at the top of the page. Not an element — it has no tag or attributes.'
              : 'Written out verbatim, exactly as typed.'}
          </div>
        </div>
      </div>
    );
  }

  // Map/loop nodes: friendly Data/Item/Index fields when the head fits the
  // simple `data.map((item[, index]) => (` shape; raw code otherwise.
  if (node.kind === 'map') {
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="panel-header">
          <h2>Loop</h2>
        </div>
        <MapEditor
          key={node.id}
          node={node}
          loopContext={loopContext}
          bindCtx={bindContext || loopContext}
          dataCtx={buildDataCtx()}
          onSetText={onSetText}
        />
      </div>
    );
  }

  // Conditions: the test is the whole node, and it's JavaScript.
  if (node.kind === 'cond') {
    const hasElse = (node.children || []).length > 1;
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="panel-header">
          <h2>Condition</h2>
        </div>
        <div className="props-field" style={{ marginTop: 8 }}>
          <label onClick={noLabelActivation}>
            <span className="prop-label">
              <BranchIcon size={12} className="prop-label-icon" />
              Show when
            </span>
          </label>
          <ConditionField
            key={node.id}
            test={node.test}
            scope={scope}
            chipsOf={chipsInScope}
            bindCtx={bindContext || loopContext}
            onSetText={onSetText}
          />
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5 }}>
            True renders <strong>then</strong>
            {hasElse ? (
              <>
                , false renders <strong>else</strong>.
              </>
            ) : (
              '; nothing renders otherwise.'
            )}{' '}
            Drop elements into either branch in the navigator.
          </div>
        </div>
        {onToggleElse && (
          <div className="props-field">
            <button style={{ width: '100%' }} onClick={() => onToggleElse(!hasElse)}>
              {hasElse ? 'Remove else branch' : 'Add else branch'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // One side of a condition — nothing to configure, but saying which side it
  // is beats an empty panel.
  if (node.kind === 'branch') {
    const isElse = node.name === 'else';
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="props-title">
          <CornerIcon size={14} className="props-title-icon" />
          {isElse ? 'else' : 'then'}
        </div>
        <div className="props-empty">
          {isElse
            ? 'Rendered when the condition is false.'
            : 'Rendered when the condition is true.'}
        </div>
      </div>
    );
  }

  // Comment nodes get a single text editor.
  if (node.kind === 'comment') {
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="panel-header">
          <h2>Comment</h2>
        </div>
        <div className="props-field" style={{ marginTop: 8 }}>
          <label onClick={noLabelActivation}>
            <span className="prop-label">
              <CommentIcon size={12} className="prop-label-icon" />
              Comment
            </span>
          </label>
          <AutoTextarea
            minRows={3}
            value={node.value}
            onChange={(e) => onSetText(e.target.value)}
          />
        </div>
      </div>
    );
  }

  // <style>/<script> nodes get their content in a CodeMirror editor, with
  // their attributes editable above it — the same section an element gets.
  //
  // These tags carry the attributes that decide what they DO: `is:global` and
  // `define:vars` on a style, `is:inline`, `type` and `src` on a script. The
  // panel could show the ones already written but had no way to add one, so
  // the only route to a global stylesheet was to go and type the attribute
  // into the file by hand — in an app whose whole point is not having to.
  if (node.kind === 'raw') {
    const language = node.name === 'style' ? 'css' : 'javascript';
    const attrs = Object.keys(node.props || {});
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="props-title">
          <CodeIcon size={14} className="props-title-icon" />
          {`<${node.name}>`}
        </div>
        <div style={{ flexShrink: 0 }}>
          {/* `class` is not filtered out the way it is for an element: an
              element keeps a dedicated class field (the selector well drives
              its styling), and these have no such field — so here it is an
              attribute like any other, and adding one is how you get it. */}
          <AttributesSection
            node={node}
            names={attrs}
            projectPath={projectPath}
            bindCtx={bindContext || loopContext}
            onSetProp={onSetProp}
            onSetProps={onSetProps}
            onRenameProp={onRenameProp}
          />
        </div>
        <div className="props-field" style={{ marginTop: 4 }}>
          <button className="primary" style={{ width: '100%' }} onClick={onOpenCode}>
            <CodeIcon size={13} /> Edit code
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5 }}>
            Opens the {language} in a floating editor you can move and resize
            while working with the canvas.
          </div>
        </div>
      </div>
    );
  }

  // Text nodes get a single content editor.
  if (node.kind === 'text') {
    return (
      <div className="panel-section grow" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
        <div className="panel-header">
          <h2>Text</h2>
        </div>
        <div className="props-field" style={{ marginTop: 8 }}>
          <label onClick={noLabelActivation}>
            <span className="prop-label">
              <VariableTextSizeIcon size={12} className="prop-label-icon" />
              Content
            </span>
          </label>
          <AutoTextarea
            minRows={3}
            value={node.value}
            onChange={(e) => onSetText(e.target.value)}
          />
        </div>
      </div>
    );
  }

  return <ElementPropsPanel {...{
    node,
    focusClass,
    focusContent,
    isLayout,
    layouts,
    currentLayoutName,
    onChangeLayout,
    schema,
    slotOptions,
    takesSlotText,
    tagOptions,
    projectClasses,
    allowAttrs,
    comment,
    onSetComment,
    loopContext,
    bindContext,
    linkContext,
    onSetProp,
    onSetProps,
    onSetAssetProp,
    onRenameProp,
    onChangeTag,
    onSetText,
    onSetContent,
    onSetInline,
    onOpenCode,
    onSetFrontmatter,
    frontmatterSource,
    onOpenSymbol,
    onToggleElse,
    projectPath,
    filePath,
    dataCtx: buildDataCtx(),
    stashRef
  }} />;
}

// Element hooks have a stable lifetime across ordinary selections. Other node
// kinds mount their own editors, so selecting text cannot change this hook order.
function ElementPropsPanel({
  node,
  focusClass,
  focusContent,
  isLayout,
  layouts,
  currentLayoutName,
  onChangeLayout,
  schema,
  slotOptions,
  takesSlotText,
  tagOptions,
  projectClasses,
  allowAttrs,
  comment,
  onSetComment,
  loopContext,
  bindContext,
  linkContext,
  onSetProp,
  onSetProps,
  onSetAssetProp,
  onRenameProp,
  onChangeTag,
  onSetText,
  onSetContent,
  onSetInline,
  onOpenCode,
  onSetFrontmatter,
  frontmatterSource,
  onOpenSymbol,
  onToggleElse,
  projectPath,
  filePath,
  dataCtx,
  stashRef
}) {
  const schemaNames = new Set(schema.map((s) => s.name));

  // The slot field renders in one stable spot whether or not the attribute
  // is currently set — hover-previewing a value must not remount the field
  // (that would close the dropdown mid-hover).
  const showSlotField =
    Array.isArray(slotOptions) &&
    slotOptions.some((s) => s !== 'default') &&
    !schemaNames.has('slot');
  let extraProps = Object.keys(node.props || {}).filter(
    (k) => !schemaNames.has(k) && !(showSlotField && k === 'slot')
  );
  // With a free-form Attributes section, unknown attrs live there instead of
  // as individual fields — except class and style, which keep dedicated ones.
  let attrNames = [];
  if (allowAttrs) {
    attrNames = extraProps.filter((k) => k !== 'class' && k !== 'style' && k !== 'slot');
    // `slot` is sorted last so a hand-written one lands where the picker's
    // does — directly above the comment — instead of in among the props.
    extraProps = extraProps
      .filter((k) => k === 'class' || k === 'slot')
      .sort((a, b) => (a === 'slot' ? 1 : b === 'slot' ? -1 : 0));
  }

  // Content field: shown when the children are inline-only (text plus simple
  // tags like <strong>/<em>), edited with the rich inline editor. An element
  // that's still empty — a just-inserted <h1> or <p> — has no inline children
  // to detect, so offer the editor there too; otherwise there'd be no way to
  // type its first words. Void tags can't hold content at all.
  // A component with a default <slot/> holds content exactly the way an
  // element does. Without this an empty one — everything the insert palette
  // adds, since a fresh instance is self-closing — has no Content field, and
  // so no way to be given its first words.
  const isEmpty = !Array.isArray(node.children) || node.children.length === 0;
  const canHoldText =
    (node.kind === 'element' && !VOID_TAGS.has(String(node.name).toLowerCase())) ||
    !!takesSlotText;
  const showContentField = isInlineOnly(node.children) || (isEmpty && canHoldText);
  // HTML lets a node hold text *and* elements — `<div>Intro<Button/></div>` is
  // ordinary markup — but the rich editor above only covers all-inline
  // children. Rather than leave the text unreachable from the node that owns
  // it, mixed children get a plain field over the loose text alone; the
  // element children it sits among are left exactly where they are.
  const looseText = !isEmpty && (node.children || []).find((c) => c.kind === 'text');
  const showLooseTextField = !showContentField && canHoldText && !isEmpty;
  // <slot> does take children, but they're the fallback Astro renders only
  // when the caller passes nothing — labelling it "Content" reads as if it
  // were what shows on the page.
  const isSlot = node.kind === 'element' && node.name === 'slot';

  // Where a prop's {expression} can be pointing, and how to write that source
  // back — lets an expression field edit the declaration behind it.

  // Astro's <Image> (and any component that forwards to it) rejects a public/
  // path with no width and height — "MissingImageDimension" takes the page
  // down. The picker already knows the size it just showed, so an image pick
  // fills those in when the component has them. One edit, one undo.
  // The size of the image currently in `src`. width/height fall back to it
  // when unset, so it is what those fields should show as their placeholder.
  const [srcDims, setSrcDims] = useState(null);
  useEffect(() => setSrcDims(null), [node?.id]);

  // …and read them from the file as well. The card above reports what its
  // thumbnail decoded, which only happens if a thumbnail rendered — so a
  // source the picker couldn't preview (or a field the eye never reached)
  // left width/height claiming the size was "inferred". Astro infers nothing
  // for a local asset: it reads the real size out of the file, and so do we.
  const srcProp = node?.props?.src;
  const srcKey = srcProp ? `${srcProp.type}:${srcProp.value}` : '';
  useEffect(() => {
    if (!srcProp || !projectPath) {return undefined;}
    let live = true;
    const fromRel = (rel) =>
      rel &&
      window.avb
        .assetDimensions({ projectPath, rel })
        .then((r) => live && r?.dims && setSrcDims(r.dims))
        .catch(() => {});

    if (srcProp.type === 'string') {
      const value = String(srcProp.value || '');
      // A remote source is the one case Astro really does infer — leave it.
      if (!value || /^(https?:)?\/\//.test(value) || value.startsWith('data:')) {return undefined;}
      fromRel(`public/${value.replace(/^\//, '')}`);
      return () => { live = false; };
    }
    const binding = assetImportOf(srcProp.value, dataCtx?.imports);
    if (!binding || !filePath) {return undefined;}
    window.avb
      .resolveSourcePath({ projectPath, fromFile: filePath, spec: binding.spec })
      .then((r) => live && r?.ok && fromRel(r.rel))
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, projectPath, filePath]);

  // What Astro will do with whatever is in `src`, which decides whether the
  // optimisation props mean anything:
  //   'svg'    — passed through untouched, however it's asked to be encoded
  //   'public' — served as-is; Astro never reads files under public/
  //   'asset' / 'remote' — processed normally
  // The type system can't say this (the prop is valid, the value is what makes
  // it moot) and the component can only warn about it at runtime, so the panel
  // is the only place it can be said before the fact.
  const srcKind = React.useMemo(() => {
    if (!srcProp) {return null;}
    const isSvg = (s) => /\.svg(\?|#|$)/i.test(String(s || ''));
    if (srcProp.type === 'string') {
      const v = String(srcProp.value || '');
      if (!v) {return null;}
      if (isSvg(v)) {return 'svg';}
      return /^(https?:)?\/\//.test(v) || v.startsWith('data:') ? 'remote' : 'public';
    }
    const binding = assetImportOf(srcProp.value, dataCtx?.imports);
    if (!binding) {return null;}
    return isSvg(binding.spec) ? 'svg' : 'asset';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, dataCtx?.imports]);

  // Changing the discriminant changes which props exist. The ones that no
  // longer apply are removed, not just hidden — leaving them in the markup
  // means the file carries props the component will ignore, and they would
  // reappear the moment the discriminant went back. Same edit, so it is one
  // undo, and the value is recoverable that way.
  // Values a discriminant switch took away, per node, kept only while the
  // panel is up: flicking variant → full-width → constrained should hand
  // `sizes` back, but reopening the project shouldn't resurrect it.
  const { appliesNow, branchDefault, narrowOptions, cascade } = createPropRules(
    schema, node.props || {},
  );
  const setPropCascading = (fieldName, value, immediate) => {
    const held = stashRef.current.get(node.id);
    if (!held) {
      assert(stashRef.current.size < LIMITS.treeNodesMax, 'PropsPanel: stash node limit exceeded');
    }
    const { patch, stash } = cascade({ fieldName, value, stash: held || {} });
    stashRef.current.set(node.id, stash);
    if (Object.keys(patch).length === 1 || !onSetProps) {
      onSetProp(fieldName, value, immediate);
      return;
    }
    onSetProps(node.id, patch);
  };

  // The class field, wherever it came from: the element's schema, a
  // component's declared prop, or the markup itself. Rendered on its own,
  // below the props and above Attributes. Defined here rather than up with
  // the other field lists because it asks `appliesNow` — reading a `const`
  // above its declaration is a ReferenceError, not a warning.
  // The data picker over the Content field, and the way into the editor's
  // caret once something is chosen.
  const [contentPicker, setContentPicker] = useState(null);
  const contentInsertRef = useRef(null);

  // The folded "Settings" group at the foot of the panel. Kept on the panel
  // (not per node) so opening it once keeps it open as you move around — and
  // kept at MODULE scope, because "as you move around" includes elements that
  // have no settings at all. The panel returns early for those (a condition, a
  // text node), and a render that calls no hooks throws away the hook state of
  // the ones that did: the group came back closed after every such visit.
  const [settingsOpen, setSettingsOpenState] = useState(settingsGroupOpen);
  const setSettingsOpen = (next) => {
    settingsGroupOpen = typeof next === 'function' ? next(settingsGroupOpen) : next;
    setSettingsOpenState(settingsGroupOpen);
  };

  // ⌘Enter, forwarded from App as a counter: open Settings and put the caret
  // in the class field. Two steps, because the field doesn't exist to focus
  // until the render that opens the group has happened.
  const [wantClassFocus, setWantClassFocus] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!focusClass) {return;}
    setSettingsOpen(true);
    setWantClassFocus(true);
  }, [focusClass]);
  useEffect(() => {
    if (!wantClassFocus || !settingsOpen) {return;}
    setWantClassFocus(false);
    const input = rootRef.current?.querySelector('.class-input-field');
    if (!input) {return;}
    input.focus();
    input.closest('.props-field')?.scrollIntoView({ block: 'nearest' });
  }, [wantClassFocus, settingsOpen]);

  // Double-clicking text on the canvas, forwarded the same way: caret in the
  // Content field, at the end of what's already written. No group to open
  // first — Content sits at the top of the panel — but still an effect, so
  // the field belongs to the node that was double-clicked and not the one
  // that was selected a render ago.
  useEffect(() => {
    if (!focusContent) {return;}
    const field = rootRef.current?.querySelector('.rich-content');
    if (!field) {return;}
    field.focus();
    // Land after the last character rather than at the top: the gesture means
    // "let me write here", and a caret parked before the first word makes
    // typing insert in front of the sentence.
    const range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    field.closest('.props-field')?.scrollIntoView({ block: 'nearest' });
  }, [focusContent]);

  const classField =
    schema.find((f) => f.name === 'class' && appliesNow(f)) ||
    (node.props?.class !== undefined ? { name: 'class', type: 'string' } : null);

  // Inline styles, directly under the class field. Anything that renders a
  // real element has one, whatever it declares; a component only when it
  // takes the attribute (…rest) or already carries it, so the panel never
  // offers a prop the component would ignore. Always the CSS editor, even
  // when a component types it `style?: string`.
  const styleField =
    allowAttrs || node.props?.style !== undefined
      ? { ...(schema.find((f) => f.name === 'style') || {}), name: 'style', type: 'style' }
      : null;

  // The page's wrapper switches through the same Tag field as everything else
  // — it just answers with a layout rather than a tag, so its list is the
  // project's layouts and the change goes through the import rewrite.
  const layoutTag = isLayout && !!onChangeLayout && Array.isArray(layouts) && layouts.length > 0;
  const changeToLayout = (name) => {
    // The wrapper is an import, not markup: a name no layout file provides
    // can't be written, so the field puts the old one back.
    if (!layouts.some((l) => l.name === name)) {return false;}
    onChangeLayout(name);
    return true;
  };

  // Anything with a real tag or component name — not a loop, a condition, a
  // comment or a slot (switching a slot away would be a one-way door).
  const showTagField =
    !isSlot &&
    (layoutTag ||
      (!!onChangeTag && !isLayout && (node.kind === 'element' || node.kind === 'component')));

  const hasSettings =
    showTagField ||
    !!classField ||
    !!styleField ||
    allowAttrs ||
    showSlotField ||
    !!(onSetComment && (node.kind === 'element' || node.kind === 'component'));
  // How many of them actually carry something, shown on the closed header.
  const settingsCount =
    (node.props?.class !== undefined ? 1 : 0) +
    (node.props?.style !== undefined ? 1 : 0) +
    attrNames.length +
    (comment ? 1 : 0) +
    (node.props?.slot !== undefined ? 1 : 0);

  const onPickDimensions = (fieldName, dims) => {
    if (!onSetProps || !node || !dims?.w || !dims?.h) {return;}
    if (!/^(src|poster)$/i.test(fieldName)) {return;}
    const takes = (n) => (schema || []).some((f) => f.name === n);
    const patch = {};
    if (takes('width')) {patch.width = { type: 'expr', value: String(dims.w) };}
    if (takes('height')) {patch.height = { type: 'expr', value: String(dims.h) };}
    if (Object.keys(patch).length) {onSetProps(node.id, patch);}
  };

  return (
    // Every button in the panel taps, and every dropdown under it sounds its
    // highlight — the same two the style panel makes, wired the same way. The
    // click handler sits here rather than on each button because a popover
    // portals to <body> and React still sends its events up the tree that
    // rendered it; SoundHere is what carries the same fact to the menus, which
    // cannot be reached by a DOM ancestor at all. Silent unless the setting is
    // on.
    <SoundHere>
    <div
      className="panel-section grow"
      ref={rootRef}
      style={{ flex: '1 1 50%', overflow: 'hidden' }}
      onClick={(event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (button && !button.disabled) {clickNote();}
      }}
    >
      <div className="props-title">
        {node.kind === 'element' ? (
          elementIcon(node.name, 16, 'props-title-icon')
        ) : (
          node.astroAsset ? (
            astroAssetIcon(node.name, 16, 'props-title-icon')
          ) : (
            <ElementComponentIcon size={16} className="props-title-icon" />
          )
        )}
        {isLayout ? currentLayoutName || node.name : node.name}
        {isLayout && <span className="badge">layout</span>}
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {/* A slot isn't a tag choice — it's where the caller's content plugs
            in. Renaming it would silently turn it into an empty element. */}

        {showContentField && (
          <div className="props-field" key="content">
            <label onClick={noLabelActivation}>
              <span className="prop-label">
                <VariableTextSizeIcon size={12} className="prop-label-icon" />
                {isSlot ? 'Fallback' : 'Content'}
              </span>
              {/* Text can hold data too — the same handle, the same picker,
                  dropping the same chip in at the caret. Without it, putting a
                  field into a sentence means knowing to type
                  `{post.data.title}`. */}
              <BindHandle
                active={!!contentPicker}
                onOpen={(host) => {
                  if (contentPicker) {
                    setContentPicker(null);
                    return;
                  }
                  const r = host?.getBoundingClientRect();
                  if (!r) {return;}
                  setContentPicker({
                    left: r.left,
                    top: Math.min(r.bottom + 4, Math.max(60, window.innerHeight - 340)),
                    width: Math.max(r.width, 240),
                  });
                }}
              />
            </label>
            <RichContent
            key={node.id}
            nodes={node.children}
            bindCtx={bindContext || loopContext}
            insertRef={contentInsertRef}
            onChange={onSetInline}
          />
            {contentPicker && (
              <FieldDataPicker
                pos={contentPicker}
                bindCtx={bindContext || loopContext}
                current={null}
                onPick={(path) => {
                  setContentPicker(null);
                  contentInsertRef.current?.insert(path);
                }}
                onClose={() => setContentPicker(null)}
              />
            )}
            {isSlot && (
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.5 }}>
                Shown only when whatever uses this component passes nothing for
                the slot.
              </div>
            )}
          </div>
        )}
        {showLooseTextField && (
          <div className="props-field" key="loose-text">
            <label onClick={noLabelActivation}>
              <span className={`prop-label${looseText ? ' set' : ''}`}>
                <VariableTextSizeIcon size={12} className="prop-label-icon" />
                Content
              </span>
            </label>
            <AutoTextarea
              key={node.id}
              minRows={2}
              value={looseText ? looseText.value : ''}
              placeholder="Text alongside the children below"
              onChange={(e) => onSetContent(e.target.value)}
            />
          </div>
        )}
        {schema
          .filter(appliesNow)
          .filter((f) => f.name !== 'class' && !(styleField && f.name === 'style'))
          .map((field) => (
          <PropField
            key={field.name}
            nodeKey={node.id}
            bindCtx={bindContext || loopContext}
            field={narrowOptions(field)}
            branchDefault={branchDefault(field.name)}
            value={node.props[field.name]}
            slotOptions={slotOptions}
            projectClasses={projectClasses}
            assetCtx={{ projectPath, filePath, nodeName: node.name, onPickDimensions, srcDims, onSrcDimensions: setSrcDims, siblingProps: node.props, srcKind, onPickAsset: onSetAssetProp && ((f, picked) => onSetAssetProp(node.id, f, picked)) }}
            linkContext={linkContext}
            dataCtx={dataCtx}
            onChange={(v, immediate) => setPropCascading(field.name, v, immediate)}
          />
        ))}
        {extraProps
          .filter((name) => name !== 'class' && !(styleField && name === 'style'))
          .map((name) => (
          <PropField
            key={name}
            nodeKey={node.id}
            bindCtx={bindContext || loopContext}
            field={{ name, type: 'other' }}
            value={node.props[name]}
            slotOptions={slotOptions}
            projectClasses={projectClasses}
            assetCtx={{ projectPath, filePath, nodeName: node.name, onPickDimensions, srcDims, onSrcDimensions: setSrcDims, siblingProps: node.props, srcKind, onPickAsset: onSetAssetProp && ((f, picked) => onSetAssetProp(node.id, f, picked)) }}
            linkContext={linkContext}
            dataCtx={dataCtx}
            onChange={(v, immediate) => onSetProp(name, v, immediate)}
          />
        ))}
        {/* Class, attributes, the comment and slot are the same four fields on
            every node, and they're the ones you reach for least — folded away
            behind one heading so a component's own props are what the panel
            opens on. Shut by default; the choice sticks while the app is up. */}
        {hasSettings && (
          <div className={`props-group ${settingsOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="props-group-head"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <span className="props-group-name">Settings</span>
              {/* Something set in there is worth knowing about without opening
                  it — otherwise a class you gave the element looks lost. */}
              {!settingsOpen && settingsCount > 0 && (
                <span className="props-group-count">{settingsCount}</span>
              )}
              <ChevronRightIcon size={11} className="props-group-chevron" />
            </button>
          </div>
        )}
        {hasSettings && settingsOpen && (
        <>
        {/* First in Settings, and on every node: the tag is what the node IS,
            and it's how a <div> becomes a component (or a component becomes a
            <div>) without going to the code. */}
        {showTagField && (
          <TagField
            key="tag"
            // A layout shows (and offers) the layout it resolves to, not the
            // local name the page imported it under — that name is a detail of
            // this page, while the file is what you're choosing between.
            tag={layoutTag ? currentLayoutName || node.name : node.name}
            options={layoutTag ? layouts.map((l) => ({ name: l.name, kind: 'layout' })) : tagOptions}
            onChangeTag={layoutTag ? changeToLayout : onChangeTag}
          />
        )}
        {classField && (
          <PropField
            key="class"
            nodeKey={node.id}
            bindCtx={bindContext || loopContext}
            field={classField}
            value={node.props?.class}
            slotOptions={slotOptions}
            projectClasses={projectClasses}
            assetCtx={{ projectPath, filePath, nodeName: node.name, onPickDimensions, srcDims, onSrcDimensions: setSrcDims, siblingProps: node.props, srcKind, onPickAsset: onSetAssetProp && ((f, picked) => onSetAssetProp(node.id, f, picked)) }}
            linkContext={linkContext}
            dataCtx={dataCtx}
            onChange={(v, immediate) => setPropCascading('class', v, immediate)}
          />
        )}
        {styleField && (
          <PropField
            // The editor is mounted with its text and doesn't re-sync, so it
            // has to be a new one per node — otherwise selecting a sibling
            // would leave the previous element's CSS sitting in the field.
            key={`style:${node.id}`}
            nodeKey={node.id}
            bindCtx={bindContext || loopContext}
            field={styleField}
            value={node.props?.style}
            slotOptions={slotOptions}
            projectClasses={projectClasses}
            linkContext={linkContext}
            dataCtx={dataCtx}
            onChange={(v, immediate) => setPropCascading('style', v, immediate)}
          />
        )}
        {allowAttrs && (
          <AttributesSection
            key="attrs"
            node={node}
            names={attrNames}
            projectPath={projectPath}
            bindCtx={bindContext || loopContext}
            onSetProp={onSetProp}
            onSetProps={onSetProps}
            onRenameProp={onRenameProp}
          />
        )}
        {onSetComment && (node.kind === 'element' || node.kind === 'component') && (
          <CommentField key="comment" value={comment} onCommit={onSetComment} />
        )}
        {/* `slot` is not a prop of this component — it tells the PARENT where to
            put it — so it sits apart from the component's own props, last of
            all, below even the comment. */}
        {showSlotField && (
          <PropField
            key="slot"
            field={{ name: 'slot', type: 'slot' }}
            value={node.props?.slot}
            slotOptions={slotOptions}
            onChange={(v, immediate) => onSetProp('slot', v, immediate)}
          />
        )}
        </>
        )}
        {!isLayout &&
          !allowAttrs &&
          schema.length === 0 &&
          extraProps.length === 0 &&
          !showContentField && (
            <div className="props-empty">
              {node.kind === 'element'
                ? 'This HTML element has no attributes set.'
                : 'This component declares no props (add an interface Props or an Astro.props destructure to expose some).'}
            </div>
          )}
      </div>
    </div>
    </SoundHere>
  );
}

// The HTML comment directly above this node — the note the navigator shows
// beside its name. Written as you type, so that label keeps up with the field:
// the write is coalesced and the save debounced (see setComment), so a burst of
// typing is still one save and one undo step. Clearing the field removes the
// comment node.
function CommentField({ value, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  // Re-sync when the model changes underneath (undo, external edit) — but not
  // while typing, or the caret would jump.
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {setDraft(value ?? '');}
  }, [value]);
  const commit = (text = draft) => {
    const next = text.trim();
    if (next !== (value ?? '').trim()) {onCommit(next);}
  };
  return (
    <div className="props-field props-comment">
      <label onClick={noLabelActivation}>
        <span className="prop-label">
          <CommentIcon size={12} className="prop-label-icon" />
          Comment
        </span>
      </label>
      <AutoTextarea
        minRows={1}
        placeholder="Note above this element…"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; commit(); }}
      />
    </div>
  );
}

// Displayable text for an attribute value; '' means a bare attribute.

// Inverse: '' → bare, "{...}" → expression, anything else → string.


// Free-form attribute list for elements and ...rest components: + adds,
// hover-trash deletes, clicking a row opens a name/value editor.


// Attribute markup pasted into the name box — `id="hero"`, `id=hero`, or a
// whole run of them — split into the pairs it describes. Copying attributes
// off an existing element is the normal way to move them, and typing them
// back one box at a time is the tedious part.
//
// Deliberately looser than the .astro parser: HTML allows an unquoted value
// (`id=hero`), and that is exactly what someone types from memory. A brace
// value keeps its braces so encodeAttr reads it as an expression.




// Floating name/value editor for one attribute.


// Shallow object literal ({ id: "x", tabindex: 3 }) ↔ ordered entries.
// Returns null for nesting/spreads the row editor can't represent (the
// caller falls back to the generic expression field).
// Does this prop name end in the word "href"? Splits camelCase, kebab and
// snake alike, so `buttonHref`, `cta-href` and plain `href` all say yes while
// `hrefLabel` says no.






// Row display/edit encoding: quoted strings edit as plain text, anything
// else as {expression}; an empty value means `true`.



// Attributes-object props (containerAttrs = {} etc.): entries edit like
// element attributes and serialize back to a shallow { key: value } literal.
// Removing the last row resets the prop to its default.


// Parses a loop head like `service.tags.map((tag) => (` or
// `items.filter(i => i.on).map((item, index) => (` into friendly fields.
// The data part is any expression, so filtered/sorted collections still fit;
// the single parameter may be bare — `items.map(item => (` — the way a
// one-argument arrow is often written. Only destructured params or non-arrow
// callbacks fall back to code.
function parseMapHead(head) {
  const m = String(head)
    .trim()
    .match(
      /^([\s\S]+?)\.map\(\s*(?:\(\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\)|([\w$]+))\s*=>\s*\($/
    );
  return m ? { data: m[1].trim(), item: m[2] || m[4], index: m[3] || '' } : null;
}

// The leading name in an expression — what the value is a list OF, before
// anything is done to it. `posts.filter(p => p.draft)[0]` is `posts`; a lone
// `Astro.props.items` is all of it.
const SOURCE_RE = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/;

function sourceChip(value) {
  const text = String(value || '').trim();
  if (!text || text === NO_SOURCE) {return '';}
  const match = SOURCE_RE.exec(text);
  if (!match) {return '';}
  let name = match[1];
  // A segment that is called is not part of the path: `posts.filter(…)` is
  // `posts`, done to — and a call on the whole thing (`getPosts()`) names a
  // function, which is not a source anything can be swapped for.
  while (text[name.length] === '(') {
    const at = name.lastIndexOf('.');
    if (at < 0) {return '';}
    name = name.slice(0, at);
  }
  return name;
}

// The same expression with a different source: what follows the old one is
// kept, so choosing another list does not throw away the code around it.
function withSource(value, path) {
  const current = sourceChip(value);
  if (!current) {return path;}
  const text = String(value);
  const at = text.indexOf(current);
  return text.slice(0, at) + path + text.slice(at + current.length);
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

// "No source yet" has to be written as real code, since the head is what
// lands in the page. An empty literal is valid, renders nothing, and — unlike
// a placeholder name like `items` — can't throw "items is not defined" and
// take the whole preview down before the user has picked anything.
const NO_SOURCE = '[]';
const CUSTOM_SOURCE = '__custom__'; // not a valid expression, so it can't collide
const DEFAULT_ITEM = 'item'; // a value no expression can collide with

function MapEditor({ node, loopContext, bindCtx, dataCtx, onSetText }) {
  const parsed = parseMapHead(node.head);
  const [fields, setFields] = useState(parsed || { data: '', item: '', index: '' });
  const lastBuiltRef = useRef(node.head);

  // Whether the source is something the picker offers, or an expression
  // someone wrote themselves — which is what decides between showing the
  // picker's name and showing the code field.
  const isCustomData = (data) => {
    const d = (data || '').trim();
    if (!d || d === NO_SOURCE) {return false;}
    const known = new Set();
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n.pickable !== false) {known.add(n.path);}
        walk(n.children);
      }
    };
    walk(listsOnly(dataTree(bindCtx || loopContext || {})));
    return !known.has(d);
  };
  // Kept only so the picker's "write an expression" entry can put the caret in
  // the field; there is no longer a mode to be in — the field is always the
  // expression, with its source drawn as a chip inside it.
  const [, setCustom] = useState(false);

  // External changes (undo, file reload, code edits below) re-sync fields.
  useEffect(() => {
    if (node.head !== lastBuiltRef.current) {
      const p = parseMapHead(node.head);
      if (p) {
        setFields(p);
        setCustom(isCustomData(p.data));
      }
      lastBuiltRef.current = node.head;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.head]);

  // Typing only updates local state; the head is written on blur/Enter/pick
  // so half-typed values never run in the preview.
  const update = (patch) => setFields((f) => ({ ...f, ...patch }));
  const commit = (next) => {
    setFields(next);
    const itemOk = IDENT_RE.test(next.item);
    const indexOk = !next.index || IDENT_RE.test(next.index);
    if (!next.data.trim() || !itemOk || !indexOk) {return;} // incomplete — don't write broken code
    const head = `${next.data.trim()}.map((${next.item}${next.index ? `, ${next.index}` : ''}) => (`;
    if (head === node.head) {return;}
    // Renaming the item or index has to carry into the children that
    // reference it. Only a rename counts — adding or removing an index
    // leaves nothing to point the old name at.
    const prev = parseMapHead(node.head);
    const renames = [];
    if (prev) {
      if (prev.item && next.item && prev.item !== next.item) {
        renames.push({ from: prev.item, to: next.item });
      }
      if (prev.index && next.index && prev.index !== next.index) {
        renames.push({ from: prev.index, to: next.index });
      }
    }
    lastBuiltRef.current = head;
    onSetText(head, renames);
  };
  const commitOnEnter = (e) => {
    if (e.key === 'Enter') {commit(fields);}
  };

  // Changing the source changes what the item *is*, so a name describing the
  // old data ("service" for a list of projects) is worse than none. Back to
  // the default; the rename above carries the children with it.
  const commitSource = (data) => {
    // The source, not the whole expression: `.slice(0, 3)` typed after a list
    // — or a value dropped into it — leaves the item exactly what it was, and
    // only picking a different list makes the old name wrong.
    const changed = sourceChip(parseMapHead(node.head)?.data || '') !== sourceChip(data);
    commit({ ...fields, data, item: changed ? DEFAULT_ITEM : fields.item });
  };

  // Anchors the source popup under the Data row.
  const dataRef = useRef(null);
  const codeRef = useRef(null);
  const [sourceMenu, setSourceMenu] = useState(null);
  // The bind handle's picker, and the way into whichever field it belongs to.
  // The source picker chooses what is being looped over; this drops a value
  // into the expression around it — `posts.slice(0, count)` needs `count` from
  // somewhere, and there was no way to reach it from here.
  const [insertAt, setInsertAt] = useState(null); // {pos, field}
  const dataApiRef = useRef(null);
  const codeApiRef = useRef(null);
  const openInsert = (field, ref) => {
    if (insertAt) {
      setInsertAt(null);
      return;
    }
    const r = ref.current?.getBoundingClientRect();
    if (!r) {return;}
    setInsertAt({
      field,
      pos: {
        left: r.left,
        top: Math.min(r.bottom + 4, Math.max(60, window.innerHeight - 340)),
        width: Math.max(r.width, 240),
      },
    });
  };
  const openSourceMenu = () => {
    const r = dataRef.current?.getBoundingClientRect();
    if (!r) {return;}
    setSourceMenu({
      left: r.left,
      top: Math.min(r.bottom + 4, Math.max(60, window.innerHeight - 340)),
      width: Math.max(r.width, 240),
    });
  };

  const parseableNow = !!parseMapHead(node.head);
  const isNoSource = !fields.data.trim() || fields.data.trim() === NO_SOURCE;
  const itemBad = fields.item !== '' && !IDENT_RE.test(fields.item);
  const indexBad = fields.index !== '' && !IDENT_RE.test(fields.index);

  return (
    <>
      {parseableNow ? (
        <>
          <div className="props-field" style={{ marginTop: 8 }} ref={dataRef}>
            <label onClick={noLabelActivation}>
              <span className="prop-label">Data</span>
              <BindHandle
                active={insertAt?.field === 'data'}
                onOpen={() => openInsert('data', dataRef)}
              />
            </label>
            {/* One field, holding one expression. What names the source is
                drawn as a chip inside it — the same purple a binding wears
                everywhere else — and everything after it is ordinary code, so
                `.filter(…)` or `[1]` is typed where it reads. The chip IS the
                way to another list: it is the thing on screen that names the
                one in use, so pressing it opens the picker, and the chevron
                that used to sit beside it was a second button for the job the
                chip was already doing. The pencil goes to where the list is
                declared, which is usually another file. */}
            <div className="prop-expr-row">
              <ExprInput
                value={isNoSource ? '' : fields.data}
                syncValue={isNoSource ? '' : fields.data}
                placeholder="Choose or write a list…"
                chip={sourceChip(fields.data)}
                apiRef={dataApiRef}
                onChipClick={() => (sourceMenu ? setSourceMenu(null) : openSourceMenu())}
                onChange={(v) => update({ data: v })}
                onCommit={(v) => commitSource(v.trim() || NO_SOURCE)}
              />
              <SourceEditButton
                name={referencedName(fields.data)}
                dataCtx={dataCtx}
                anchorRef={dataRef}
              />
            </div>
            {sourceMenu && (
              <FieldDataPicker
                pos={sourceMenu}
                bindCtx={bindCtx || loopContext}
                tree={listsOnly(dataTree(bindCtx || loopContext || {}))}
                current={isNoSource ? null : sourceChip(fields.data) || fields.data.trim()}
                onPick={(path) => {
                  setSourceMenu(null);
                  setCustom(false);
                  // Picking swaps the source and keeps the code after it: a
                  // list chosen again is still `.filter(…)`-ed the same way.
                  commitSource(withSource(fields.data, path));
                }}
                onWrite={() => {
                  setSourceMenu(null);
                  setCustom(true);
                  if (isNoSource) {update({ data: '' });}
                }}
                onClose={() => setSourceMenu(null)}
              />
            )}
          </div>
          <div className="props-field">
            <label onClick={noLabelActivation}>
              <span className="prop-label">Item name</span>
            </label>
            <input
              value={fields.item}
              placeholder="e.g. service"
              spellCheck={false}
              style={itemBad ? { borderColor: 'var(--red)' } : undefined}
              onChange={(e) => update({ item: e.target.value })}
              onBlur={() => commit(fields)}
              onKeyDown={commitOnEnter}
            />
          </div>
          <div className="props-field">
            <label onClick={noLabelActivation}>
              <span className="prop-label">Index name</span>
              <span className="type-tag">optional</span>
            </label>
            <input
              value={fields.index}
              placeholder="e.g. index"
              spellCheck={false}
              style={indexBad ? { borderColor: 'var(--red)' } : undefined}
              onChange={(e) => update({ index: e.target.value })}
              onBlur={() => commit(fields)}
              onKeyDown={commitOnEnter}
            />
          </div>
        </>
      ) : (
        <div
          className="props-field"
          style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}
        >
          Custom loop code — edit it below.
        </div>
      )}
      <div className="props-field" style={{ marginTop: parseableNow ? 2 : 0 }} ref={codeRef}>
        <label onClick={noLabelActivation}>
          <span className="prop-label">
            <CodeIcon size={12} className="prop-label-icon" />
            Code
          </span>
          <BindHandle
            active={insertAt?.field === 'code'}
            onOpen={() => openInsert('code', codeRef)}
          />
        </label>
        <ExprInput
          value={node.head}
          syncValue={node.head}
          apiRef={codeApiRef}
          onCommit={(v) => v !== node.head && onSetText(v)}
        />
      </div>
      {insertAt && (
        <FieldDataPicker
          pos={insertAt.pos}
          bindCtx={bindCtx || loopContext}
          current={null}
          onPick={(path) => {
            const field = insertAt.field;
            setInsertAt(null);
            const next =
              field === 'data' ? dataApiRef.current?.insert(path) : codeApiRef.current?.insert(path);
            if (next == null) {return;}
            if (field === 'data') {commitSource(next.trim() || NO_SOURCE);}
            else if (next !== node.head) {onSetText(next);}
          }}
          onClose={() => setInsertAt(null)}
        />
      )}
    </>
  );
}

// Tag switcher for plain elements: free text with a suggestion list of
// standard HTML tags. Committing renames the element — the navigator icon
// follows the tag, and attributes invalid for the new tag are dropped.
// The glyph an option wears in the tag list — the same ones the insert
// palette uses, so a component reads as a component in both places.
function tagOptionIcon(opt) {
  if (opt.kind === 'astroAsset') {return astroAssetIcon(opt.name, 13);}
  if (opt.kind === 'layout') {return <LayoutIcon size={13} style={{ color: '#79e09c' }} />;}
  if (opt.kind === 'component')
    {return <ElementComponentIcon size={13} style={{ color: '#79e09c' }} />;}
  return elementIcon(opt.name, 13);
}

function TagField({ tag, options, onChangeTag }) {
  const [draft, setDraft] = useState(tag);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popupPos, setPopupPos] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  // Two refs, because picking from the list commits and then blurs in the same
  // tick — before React has re-rendered with either new value:
  //   committedRef — what the field has already asked for. `tag` doesn't catch
  //     up until the app re-renders, so it can't answer "did I just do this?".
  //   draftRef — the live text. The blur handler closes over the `draft` of the
  //     render it was created in, which is still the half-typed "bu" when a
  //     pick blurs the input; committing that put "bu" on the element and left
  //     the picked name sitting in the box.
  const committedRef = useRef(tag);
  const draftRef = useRef(tag);
  const updateDraft = (v) => {
    draftRef.current = v;
    setDraft(v);
  };
  useEffect(() => {
    committedRef.current = tag;
    updateDraft(tag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  // Components as well as tags: Astro tells them apart by case, and so does
  // this list — typing a capital narrows to what the page can actually
  // provide (a project component, an astro:assets one, or something the
  // frontmatter already imports).
  const pool =
    options && options.length ? options : HTML_TAGS.map((name) => ({ name, kind: 'element' }));
  const q = draft.trim();
  const ql = q.toLowerCase();
  const matches =
    focused && q && q !== tag
      ? pool
          .filter((o) => o.name.toLowerCase().includes(ql))
          .sort((a, b) => {
            const ap = a.name.toLowerCase().startsWith(ql) ? 0 : 1;
            const bp = b.name.toLowerCase().startsWith(ql) ? 0 : 1;
            return ap - bp || a.name.length - b.name.length;
          })
          .slice(0, 12)
      : [];

  useLayoutEffect(() => {
    if (!matches.length || !wrapRef.current) {
      setPopupPos(null);
      return;
    }
    const r = wrapRef.current.getBoundingClientRect();
    setPopupPos({ left: r.left, top: r.bottom + 4, width: r.width });
  }, [matches.length, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask for a name, and put the old one back if the caller says nothing
  // provides it — a component that isn't imported anywhere, a layout name
  // that isn't a layout file.
  const apply = (name) => {
    committedRef.current = name;
    updateDraft(name);
    Promise.resolve(onChangeTag(name)).then((ok) => {
      if (ok === false) {
        committedRef.current = tag;
        updateDraft(tag);
      }
    });
  };

  const commit = (t) => {
    const raw = String(t).trim();
    if (raw === committedRef.current) {return updateDraft(committedRef.current);}
    // A capital means a component — passed through with its case intact, and
    // it's the caller that decides whether anything provides that name.
    if (/^[A-Z][\w$]*$/.test(raw)) {return apply(raw);}
    const clean = raw.toLowerCase();
    // Not `slot` either: switching into one here would be a one-way door —
    // insert a slot from the palette instead.
    if (/^[a-z][a-z0-9-]*$/.test(clean) && clean !== committedRef.current && clean !== 'slot') {
      apply(clean);
    } else {updateDraft(committedRef.current);}
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' || (e.key === 'Tab' && matches.length)) {
      e.preventDefault();
      const picked = matches[Math.min(highlight, matches.length - 1)];
      commit(picked ? picked.name : draftRef.current);
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      // Put the text back before blurring, or the blur below would commit
      // whatever was being typed — the opposite of what Escape means.
      updateDraft(committedRef.current);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="props-field" ref={wrapRef}>
      <label onClick={noLabelActivation}>
        <span className="prop-label">
          <TagIcon size={12} className="prop-label-icon" />
          Tag
        </span>
      </label>
      <input
        ref={inputRef}
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          updateDraft(e.target.value);
          setHighlight(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          // The ref, not `draft`: a pick blurs the input in the same tick it
          // sets the text, so the state this handler closed over is stale.
          commit(draftRef.current);
        }}
        onKeyDown={onKeyDown}
      />
      {popupPos && (
        <div
          className="dd-popup class-suggest"
          style={{ left: popupPos.left, top: popupPos.top, width: popupPos.width }}
        >
          {matches.map((o, i) => (
            <div
              key={o.name}
              className={`dd-option ${i === highlight ? 'highlight' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                commit(o.name);
                inputRef.current?.blur();
              }}
            >
              <span className="dd-option-icon">{tagOptionIcon(o)}</span>
              <span className="dd-option-label">{o.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The identifier an expression is *about*: `rotatingWords` for both
// `rotatingWords` and `site.nav.items`. Anything with a call, an operator or
// a literal in it isn't a plain reference to one declaration, so it has no
// source to open.


// Where the data behind an expression can be edited from here: 'local' when
// this file's frontmatter declares it (edited in place), 'file' when it's
// imported (opens the file that defines it), null when neither.


// The pencil beside a field bound to data: it opens whatever defines that
// data. A `const` in this file opens inline, right under the field; anything
// imported opens its own file, on the line that declares it. Renders nothing
// when the value doesn't name something we can find.


// Files an import can name that are pictures rather than code.


// The image an expression is bound to, if it is one: `hero` and `hero.src`
// both point at whatever `hero` was imported from. Returns null for any other
// expression, which then edits as code.


// The asset card for an imported image. The import specifier is resolved to a
// real file so the card can show it; picking a new one goes through the host,
// which rewrites the import rather than the value.


// A prop value that holds JavaScript. It's code, so it's highlighted; and
// when it names something with a definition — here or in another file — the
// pencil goes straight to it. Changing the three words in `const
// rotatingWords = […]` is part of the same thought as pointing the prop at
// it, and shouldn't mean hunting for the file.


// The condition an `if` renders on, as the values it names rather than as a line
// of text: each one in scope is a purple chip, pressing one opens the list to swap
// it, and the dot inserts another at the caret.
//
// Its own component because it holds state, and PropsPanel returns early for every
// node kind above this one — a hook in that body runs for some selections and not
// others, which is what "Rendered fewer hooks than expected" means. A child's hooks
// are its own, so nothing above it has to change.


// The way data gets into a field: nothing until the field is hovered, then a
// small purple dot on its top-left corner — the same purple a binding is shown
// in, so what it does is legible before it is read. Hovering the dot itself
// grows it into a +, which is the click. A button that sat there permanently
// would be chrome on every field in the panel, for something most fields never
// need.


// The picker, over a field. Positioned against whatever the handle belongs to
// rather than against the handle itself, so it lines up with the field's edge.


// A prop's value, edited as what it IS: text with the data in it shown as
// chips. `Posted ` · [post.data.pubDate] reads as one field rather than as a
// binding that took the field over — so a value can be part typed and part
// bound, and either half changed without touching the other.
//
// The expression a chip stands for. Two kinds reach here: the ones in the
// chips-and-text field are DOM nodes carrying it in an attribute, and the holes
// in the code editor are `{from, to, path}` objects. Both name a value, and
// that name is what the picker's Edit row goes and opens.


// What the chip STANDS FOR, which is not always what it writes: a chip reached
// through a `?` (`featured` · "?" · `.data.title`) writes the tail and means the
// whole path. The picker marks the current value by this, so opening that chip
// shows `title` ticked rather than nothing at all.


// Clicking a chip repoints it — or, through the same menu, opens whatever
// defines it. The pencil that used to sit beside the field could only ever mean
// ONE value, so a field holding two bindings had a button that silently spoke
// for the first; per chip, the question has an answer every time.
// The braces button drops a new chip in at the caret. All of it opens the same
// picker, which is where the data itself is.


// Edits one declaration's source in place: the statement is spliced back into
// the frontmatter on every keystroke, so the canvas updates as you type, the
// rest of the file is untouched, and ⌘Z behaves like any other edit.
// The value, in a box big enough to write in. A one-line field is the wrong place
// to write an array across six lines, which is what an attribute like `class:list`
// usually is — so `=` opens this, the same key the style panel's fields use for the
// same thing. It edits the value as TEXT, braces and all, because that is what the
// attribute editor round-trips.




// Whether a prop name says "this holds a file". Read as words, so the LAST one
// decides: `image` and `ogImage` are pictures, `imageAlt` and `imageClass` are
// not. A name alone is the only signal available — the type is just `string`.




// "1–12, whole numbers" — what a bounded number field will take, on hover.
// The doc comment says it too, but that's behind the ? and reads as prose.


// Every field with a control of its own — a toggle, an options list, a link or
// asset picker — can also hold a binding instead: `overlap={overlap}` passes a
// parent prop straight through, `title={post.data.title}` reads a CMS entry.
// No control can show one of those, so the field switches to a plain
// expression input for them. These three decide when that happens and how a
// value crosses between the two.

// Whether this value is a binding rather than something the control can show.
// "Is it an expression" is the wrong question: booleans, numbers and numeric
// unions are ALL written as expressions (`cols={3}`), and each of those is
// exactly what its own control puts there.


// The way back. An expression the control could have written itself survives
// as a value; anything else WAS the binding, so dropping it drops the prop and
// the component's default applies again — better than leaving markup the field
// on screen no longer shows.


// What the toggle offers to go back to, named as what's on screen rather than
// as a type — "Use the toggle" beats "switch to boolean".


// Two choices, side by side, with the chip sliding between them. Used for
// booleans and for any two-option enum: a dropdown to pick between exactly two
// things costs a click to see what the other one even is, and this shows both
// at once.


// Small fixed-position menu opened by clicking a set prop's label.




