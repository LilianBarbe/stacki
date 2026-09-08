import React from 'react';
import CanvasView from './CanvasView.jsx';
import { setCanvasFrame, receiveCanvasReply, noteCanvasReady } from '../canvasQuery.js';
import { forgetComputedColors } from '../style-panel/lib/computed-color';
import { forgetComputedStyles } from '../style-panel/lib/computed-style';
import { hoverIsSelection, onePerPlace, sameCopy } from '../outlineBoxes.js';
import { spacingBands, withLiveSpacing } from '../spacingBands.js';
import { setModifiers } from '../style-panel/lib/host.ts';
import {
  DesktopIcon,
  TabletIcon,
  PhoneIcon,
  CanvasIcon,
  ChevronRightIcon,
  ElementComponentIcon,
  astroAssetIcon,
  LayoutIcon,
  RepeatIcon,
  BranchIcon,
  CornerIcon,
  TextIcon,
  CommentIcon,
  CodeIcon,
  CustomElementIcon,
  elementIcon,
} from '../ui/Icons.jsx';

// The overlay label wears the same icon the Navigator row does, so a node
// looks the same wherever you meet it.
function outlineIcon(info) {
  const size = 11;
  if (info.isLayout) return <LayoutIcon size={size} />;
  if (info.nodeKind === 'component') {
    // Same order the Navigator uses: a dynamic tag (`const Tag = tag`) is an
    // element with no file behind it, then astro:assets, then real components.
    if (info.dynamicTag) return <CustomElementIcon size={size} />;
    return info.astroAsset
      ? astroAssetIcon(info.label, size)
      : <ElementComponentIcon size={size} />;
  }
  switch (info.nodeKind) {
    case 'map':
      return <RepeatIcon size={size} />;
    case 'cond':
      return <BranchIcon size={size} />;
    case 'branch':
      return <CornerIcon size={size} />;
    case 'text':
      return <TextIcon size={size} />;
    case 'comment':
      return <CommentIcon size={size} />;
    case 'expr':
    case 'raw':
      return <CodeIcon size={size} />;
    default:
      return info.tag ? elementIcon(info.tag, size) : <CustomElementIcon size={size} />;
  }
}

// Desktop fills the canvas (width: null = fill).
// `width` is what clicking one sets the canvas to; `from` is where its band
// starts, so the button can also be lit by the canvas simply being that wide.
// The bands are the usual CSS ones — under 768 is phone, 768–1023 tablet,
// 1024 and up desktop — which is where a project's own media queries sit.
const DEVICES = [
  { key: 'desktop', Icon: DesktopIcon, title: 'Desktop — 1', width: null, from: 1024 },
  { key: 'tablet', Icon: TabletIcon, title: 'Tablet (768px) — 2', width: 768, from: 768 },
  { key: 'phone', Icon: PhoneIcon, title: 'Phone (375px) — 3', width: 375, from: 0 },
  { key: 'canvas', Icon: CanvasIcon, title: 'Canvas — all breakpoints — 4', width: null },
];

// Which band a canvas of this width is in. Exported so the rule can be
// checked on its own — the measurement that feeds it comes from a
// ResizeObserver, which only fires while the window is actually rendering.
export function deviceForWidth(px) {
  if (!Number.isFinite(px) || px <= 0) return null;
  const bands = DEVICES.filter((d) => d.from !== undefined).sort((a, b) => b.from - a.from);
  return (bands.find((d) => px >= d.from) || bands[bands.length - 1]).key;
}

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// A pinned width is shown for real: a frame that doesn't fit the pane is
// scaled down rather than cut off, so the page inside still lays out at the
// width that was asked for — 3000px really is 3000px to its media queries.
// The bounds are what you can type or drag to.
const MIN_FRAME_W = 240;
const MAX_FRAME_W = 8000;
// The gutter a pinned frame keeps either side of itself, and top and bottom.
const FRAME_GUTTER = 12;
const FRAME_INSET = 16;
// A frame always fits the pane, so the zoom is never more than 1:1 — asking
// for a smaller one is asking for a wider page, which is the same thing said
// the other way round.
const MIN_ZOOM_PCT = 1;

export default function PreviewPane({
  spacingHover,
  devUrl,
  devStatus,
  devLog,
  devDiag,
  pathScope,
  route,
  refreshKey,
  crumbs,
  onCrumb,
  onRefresh,
  onRestart,
  selPath,
  navHoverPath,
  overlayInfo,
  onSelectPath,
  onOpenPath,
  onSelectedClasses,
  onRenderedPaths,
  onNodeStates,
  onNodeClasses,
  focusPath,
  focusOcc,
  focusWhole,
  device,
  onDevice,
}) {
  // The breakpoint lives in App so a re-mount of this pane can't silently
  // kick the user out of a view (which would reload every preview iframe).
  const setDevice = onDevice;
  const [customW, setCustomW] = React.useState(null); // drag override
  const [customH, setCustomH] = React.useState(null); // null = fill height
  const [resizing, setResizing] = React.useState(false);
  const url = devUrl && route ? devUrl + route : null;
  const width = customW ?? DEVICES.find((d) => d.key === device)?.width;

  // Deep trees produce long ancestor chains; showing every crumb shrinks them
  // all to unreadable stubs. Keep the page plus the last few levels and fold
  // the middle into a "…" that expands (and re-folds on the next selection).
  const CRUMB_HEAD = 1;
  const CRUMB_TAIL = 3;
  const [crumbsExpanded, setCrumbsExpanded] = React.useState(false);
  const crumbKey = (crumbs || []).map((c) => c.id).join('/');
  React.useEffect(() => setCrumbsExpanded(false), [crumbKey]);
  const shownCrumbs = React.useMemo(() => {
    const all = crumbs || [];
    if (crumbsExpanded || all.length <= CRUMB_HEAD + CRUMB_TAIL + 1) return all;
    return [
      ...all.slice(0, CRUMB_HEAD),
      { ellipsis: true, hidden: all.slice(CRUMB_HEAD, all.length - CRUMB_TAIL) },
      ...all.slice(all.length - CRUMB_TAIL),
    ];
  }, [crumbs, crumbsExpanded]);

  // Node outlines: the preview iframe reports rects for tracked node paths
  // (and the node hovered on the page); outlines render as an absolute
  // overlay in the frame, never inside the page itself.
  const iframeRef = React.useRef(null);
  const [rects, setRects] = React.useState({});
  // The selected element's own padding/margin in px, as the page measures it —
  // what the spacing box's hover is drawn from.
  const [spacing, setSpacing] = React.useState({});
  const [canvasHover, setCanvasHover] = React.useState(null);

  // Set by a click on the page, so the scroll-into-view below can skip it.
  // `undefined` means no click is pending; a click stores its path, which is
  // NULL when it landed on markup the open file doesn't address (layout chrome)
  // — that still selects something, just not the path that was clicked, so the
  // skip can't be a path comparison.
  const clickedPathRef = React.useRef(undefined);
  // Which instance of a repeated node is outlined. A canvas click picks the one
  // under the pointer; every other route to a selection — the navigator, the
  // arrow keys, an edit — means the NODE, and null says so: the node is
  // wherever it is on the page, so all of it is outlined. It used to fall back
  // to the first copy, which read as the page ignoring the rest of them: a
  // marquee renders its strip twice, and selecting an icon in the navigator
  // outlined the copy in the first panel whichever one you were looking at.
  const lastClickRef = React.useRef(null);
  const [selOcc, setSelOcc] = React.useState(null);
  const [hoverOcc, setHoverOcc] = React.useState(0);
  // Read by the message handler, which is bound once — refs keep it looking at
  // the current selection instead of the one it closed over.
  const selPathRef = React.useRef(selPath);
  selPathRef.current = selPath;
  const selOccRef = React.useRef(selOcc);
  selOccRef.current = selOcc;
  const onSelectedClassesRef = React.useRef(onSelectedClasses);
  onSelectedClassesRef.current = onSelectedClasses;
  const onRenderedPathsRef = React.useRef(onRenderedPaths);
  onRenderedPathsRef.current = onRenderedPaths;
  const onNodeStatesRef = React.useRef(onNodeStates);
  onNodeStatesRef.current = onNodeStates;
  const onNodeClassesRef = React.useRef(onNodeClasses);
  onNodeClassesRef.current = onNodeClasses;
  // Last reported class string, so repeated rect sends stay quiet.
  //
  // `null` rather than '' for "nothing reported yet". An element with no
  // classes at all reports the empty string, and against an empty-string
  // starting value that report would look like a repeat and be swallowed — so
  // selecting an unclassed element would say nothing, and the panel would go
  // on showing the last element's classes with no idea they were stale.
  const selClassesRef = React.useRef(null);
  // Selection changed, so the next report must go through even when the new
  // element happens to carry exactly the same classes: the app uses it to
  // learn WHICH element the classes it is holding describe, not only what
  // they are.
  React.useEffect(() => {
    selClassesRef.current = null;
  }, [selPath, selOcc]);
  // Canvas clicks set the instance directly (below) — including when they
  // land on another instance of the node that's already selected, where
  // selPath never changes. Any other route to a new selection means "the
  // node", so it goes back to meaning every copy of it. The click marker is
  // consumed here so coming back to the same node later means the node again.
  //
  // Except a step WITHIN what is already selected: ↑ from the second link in a
  // list means its parent, and the parent of the second one — the copy being
  // looked at (see sameCopy). Falling back to the first instance there jumped
  // the outline to the top of the list on every press.
  const cameFromRef = React.useRef(null);
  React.useEffect(() => {
    const previous = cameFromRef.current;
    cameFromRef.current = selPath;
    if (lastClickRef.current?.path === selPath) {
      lastClickRef.current = null;
      return;
    }
    lastClickRef.current = null;
    if (sameCopy(previous, selPath)) return;
    setSelOcc(null);
  }, [selPath]);

  React.useEffect(() => {
    const onMsg = (e) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data;
      if (d?.type === 'avb:rects') {
        setRects(d.rects || {});
        setSpacing(d.spacing || {});
        // The rendered classes of the selected instance, for the style panel:
        // an expression-valued class attribute has no text in the model, so
        // this is the only place the applied classes are knowable. Rects
        // re-send on scroll/resize, so only report an actual change.
        if (d.classes) {
          const runs = d.classes[selPathRef.current] || [];
          const list = runs[selOccRef.current ?? 0] || runs[0] || [];
          const key = list.join(' ');
          if (key !== selClassesRef.current) {
            selClassesRef.current = key;
            onSelectedClassesRef.current?.(list);
          }
        }
      } else if (d?.type === 'avb:node-classes') {
        // What each node's classes resolved to — the navigator labels rows
        // with them when the source only has an expression.
        onNodeClassesRef.current?.(d.classes || {});
      } else if (d?.type === 'avb:rendered-nodes') {
        // Which nodes actually reached the page — the navigator marks the rest.
        onRenderedPathsRef.current?.(d.paths || []);
      } else if (d?.type === 'avb:node-states') {
        // On the page but not taking part in it: display:none, pointer-events:
        // none. The navigator marks those rows — see StructurePanel.
        onNodeStatesRef.current?.({ hidden: d.hidden || [], inert: d.inert || [] });
      } else if (d?.type === 'avb:modifiers') {
        // Keys pressed while the canvas has focus never reach the app's own
        // listeners — the frame forwards them so the panels can still read
        // what is being held.
        setModifiers(!!d.shiftKey, !!d.altKey);
      } else if (d?.type === 'avb:hover-node') {
        setCanvasHover(d.path || null);
        setHoverOcc(d.occurrence || 0);
      } else if (d?.type === 'avb:click-node' && onSelectPath) {
        clickedPathRef.current = d.path || null;
        // Which instance was clicked: a node inside a loop renders once per
        // item and only that one should light up. Set now, not from the
        // effect above, so clicking a different instance of the already
        // selected node still moves the outline.
        lastClickRef.current = { path: d.path || null, occ: d.occurrence || 0 };
        setSelOcc(d.occurrence || 0);
        // `outside` distinguishes a click the canvas could place somewhere this
        // file doesn't own from one it couldn't place at all — see canvasClick.
        onSelectPath(d.path || null, { outside: !!d.outside });
      } else if (d?.type === 'avb:canvas-ready') {
        // The page has walked its markers — anything asked too early can be
        // asked again now (see canvasQuery.js). It has also just re-rendered,
        // so what a variable resolves to may have moved with it.
        noteCanvasReady();
        forgetComputedColors();
        forgetComputedStyles();
      } else if (d?.type === 'avb:query-result') {
        // An answer from the page about what it really renders — see
        // canvasQuery.js. Routed here because this is the component that
        // knows which frame the message came from.
        receiveCanvasReply(d);
      } else if (d?.type === 'avb:open-node' && onOpenPath) {
        // A null path means the double-click landed on markup the open file
        // doesn't address — the layout's own chrome. App decides what that opens.
        // The occurrence says which instance was opened: a component rendered
        // inside a loop is many boxes on the page, and only the one that was
        // double-clicked should be the one being edited.
        onOpenPath(d.path || null, d.occurrence || 0);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onSelectPath, onOpenPath]);

  const hoverPath = navHoverPath || canvasHover;
  // A navigator hover means "the node", so every instance lights up; a canvas
  // hover means the one under the pointer.
  const hoverOccUsed = navHoverPath ? null : hoverOcc;
  // Newline-joined: a namespaced path (src/…/Card.astro|0.1) contains a pipe,
  // so that can no longer separate the tracked paths.
  const trackKey = [...new Set([selPath, hoverPath, focusPath].filter(Boolean))].join(String.fromCharCode(10));
  // The frame the style panel asks about the rendered DOM. Re-registered on
  // every load: a reloaded document is a different window to talk to.
  const registerFrame = React.useCallback(() => {
    setCanvasFrame(iframeRef.current?.contentWindow || null);
  }, []);
  React.useEffect(() => {
    registerFrame();
    return () => setCanvasFrame(null);
  }, [registerFrame, url, refreshKey]);

  const sendTrack = React.useCallback(() => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.postMessage(
      {
        type: 'avb:track',
        paths: trackKey ? trackKey.split(String.fromCharCode(10)) : [],
        scope: pathScope || '',
        // The instance being edited. Everything the page reports back — boxes,
        // hits, classes — is confined to it, so a component in a loop lights
        // up once instead of once per item.
        focus: focusPath || '',
        focusOcc: focusOcc || 0,
      },
      '*'
    );
  }, [trackKey, pathScope, focusPath, focusOcc]);
  React.useEffect(sendTrack, [sendTrack, url, refreshKey]);

  // Selecting in the navigator (or via a breadcrumb) smooth-scrolls the page
  // to the node. A selection that came from clicking the page is skipped —
  // it's already on screen, and moving it would yank it out from under the
  // pointer. Not sent on reload: the frame has no regions mapped yet.
  const prevFocusRef = React.useRef(focusPath);
  React.useEffect(() => {
    const w = iframeRef.current?.contentWindow;
    const focusChanged = prevFocusRef.current !== focusPath;
    prevFocusRef.current = focusPath;
    if (!w || !selPath) return;
    // Any selection that came from a click on the page: whatever it resolved to
    // is already on screen under the pointer. Notably the layout, whose box is
    // the whole page — scrolling to it always jumps to the top.
    if (clickedPathRef.current !== undefined) {
      clickedPathRef.current = undefined;
      return;
    }
    // Drilling into a component (or backing out) opens a different file and
    // selects within it, which looks like a fresh selection — but the canvas
    // still shows the same page and the instance is already under the pointer.
    // Scrolling here would jump to whichever instance the new path resolves to.
    if (focusChanged) return;
    // Repeated nodes: aim at the instance in play, not the first on the page.
    w.postMessage({ type: 'avb:scroll-to', path: selPath, occ: selOccRef.current }, '*');
  }, [selPath, focusPath]);

  // A reload wipes iframe state — clear stale boxes until fresh rects arrive.
  React.useEffect(() => {
    setRects({});
    setCanvasHover(null);
  }, [url, refreshKey]);

  // Track the canvas width so "Fill" can be expressed in px too — CSS can
  // only animate the frame width between two lengths, not px ↔ 100%.
  const wrapRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const [wrapWidth, setWrapWidth] = React.useState(null);
  const [wrapHeight, setWrapHeight] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      setWrapWidth(el.clientWidth);
      setWrapHeight(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectDevice = (key) => setDevice(key);

  // Which breakpoint the canvas is actually sitting in. A pinned width —
  // Tablet, Phone, a typed size, a drag — is honoured whatever the pane can
  // spare, by scaling the frame down, so it agrees with itself. Desktop
  // fills the pane, and there the window is what decides: squeeze it narrow
  // enough and the page really is laying out as a phone whatever button was
  // last clicked. Highlight what's true, not what was asked for. Canvas is
  // every breakpoint at once, so it stays put.
  const shownWidth = width ?? wrapWidth;
  const activeDevice = React.useMemo(() => {
    if (device === 'canvas') return 'canvas';
    return deviceForWidth(shownWidth) || device;
  }, [device, shownWidth]);

  // The frame always fits the pane: a width past what the pane can show at
  // 1:1 is drawn smaller, never cropped and never scrolled to. So the width
  // and the zoom are one value seen twice — the pane can show availW pixels
  // at 1:1, and asking for more of them makes them smaller in proportion.
  // Both fields below write the same thing, which is why changing either
  // one still fits.
  const availW = wrapWidth == null ? null : Math.max(120, wrapWidth - FRAME_GUTTER * 2);
  const scale = width && availW ? Math.min(1, availW / width) : 1;
  const scaleRef = React.useRef(1);
  scaleRef.current = scale;
  // Overlays live inside the scaled frame, so their chrome — outlines,
  // labels, drag handles — would shrink with it. Counter-scaling keeps them
  // the size they always are on screen (up to a point: at 20% a label
  // blown up 5× would cover the page it names).
  const frameZoom = Math.min(1 / scale, 3);
  // Scaled from the top-left corner, then placed by hand at the offset that
  // centres it. The height moves against the scale so the same slab of pane
  // is filled at any zoom — which is also the truth of it, since a page
  // shrunk to fit is showing you more of itself.
  const framePlaced = wrapWidth != null && wrapHeight != null;
  // Filling the pane means exactly that — no gutter, no inset, no zoom — but
  // it is placed by the same rule as a pinned width, so that switching
  // between the two is one animation and not a jump.
  const inset = width ? FRAME_INSET : 0;
  const scaledW = (width ?? wrapWidth ?? 0) * scale;
  const offsetX =
    width && framePlaced ? Math.max(FRAME_GUTTER, Math.round((wrapWidth - scaledW) / 2)) : 0;
  const frameHeight =
    customH ?? (framePlaced ? Math.round((wrapHeight - inset * 2) / scale) : null);

  // The width readout doubles as the way in: type a size, or nudge it with
  // the arrow keys. It follows the frame — a breakpoint click, a drag, or
  // just a resized window while Desktop fills the pane — except while it is
  // being typed into, which must not fight the person typing.
  const readWidth = Math.round(shownWidth || 0);
  const [sizeText, setSizeText] = React.useState('');
  const [sizeTyping, setSizeTyping] = React.useState(false);
  React.useEffect(() => {
    if (!sizeTyping) setSizeText(readWidth ? String(readWidth) : '');
  }, [readWidth, sizeTyping]);

  const applyWidth = (px) => {
    setCustomW(clamp(Math.round(px), MIN_FRAME_W, MAX_FRAME_W));
    setDevice('custom');
  };

  const commitSize = () => {
    const n = parseInt(sizeText, 10);
    if (Number.isFinite(n) && n > 0) applyWidth(n);
    else setSizeText(readWidth ? String(readWidth) : '');
  };
  const onSizeKey = (e) => {
    if (e.key === 'Enter') {
      commitSize();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setSizeText(readWidth ? String(readWidth) : '');
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      const base = parseInt(sizeText, 10);
      const next = clamp((Number.isFinite(base) ? base : readWidth) + step, MIN_FRAME_W, MAX_FRAME_W);
      setSizeText(String(next));
      applyWidth(next);
    }
  };

  // Same deal for the zoom, except that it writes through the width: at 50%
  // the pane shows twice the pixels it does at 1:1, so that is the width it
  // sets. Past 100% would mean a frame smaller than the pane, which is a
  // narrower page — say that with the px field instead.
  const readZoom = Math.round(scale * 100);
  const [zoomText, setZoomText] = React.useState('');
  const [zoomTyping, setZoomTyping] = React.useState(false);
  React.useEffect(() => {
    if (!zoomTyping) setZoomText(String(readZoom));
  }, [readZoom, zoomTyping]);

  const applyZoom = (pct) => {
    if (!availW) return;
    applyWidth(availW / (clamp(pct, MIN_ZOOM_PCT, 100) / 100));
  };
  const commitZoom = () => {
    const n = parseInt(zoomText, 10);
    if (Number.isFinite(n) && n > 0) applyZoom(n);
    else setZoomText(String(readZoom));
  };
  const onZoomKey = (e) => {
    if (e.key === 'Enter') {
      commitZoom();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setZoomText(String(readZoom));
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      const base = parseInt(zoomText, 10);
      const next = clamp((Number.isFinite(base) ? base : readZoom) + step, MIN_ZOOM_PCT, 100);
      setZoomText(String(next));
      applyZoom(next);
    }
  };

  // The way back, one click, and only there when there is a way back: at 1:1
  // the pane is already showing every pixel it has.
  const atOneToOne = scale > 0.995;

  // Any breakpoint change drops the drag-resize override — a click, a 1–4
  // keypress, or App resetting the pane to desktop when a project opens.
  // 'custom' is the drag itself, so it must not clear what the drag just set.
  React.useEffect(() => {
    if (device === 'custom') return;
    setCustomW(null);
    if (device === 'desktop' || device === 'canvas') setCustomH(null); // fills, so reset the height too
  }, [device]);

  // Sliding highlight behind the active device button.
  const btnRefs = React.useRef({});
  const [indicator, setIndicator] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = btnRefs.current[activeDevice];
    if (!el) {
      setIndicator(null); // drag-resized "custom" state — no active tab
      return;
    }
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    // Follows the width too, not just the click — resizing the window moves
    // the highlight to whichever breakpoint the canvas now falls in.
  }, [activeDevice]);

  // 1 / 2 / 3 switch to the desktop / tablet / phone breakpoints (ignored
  // while typing in a field so prop values can still contain digits).
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      ) {
        return;
      }
      const key = { 1: 'desktop', 2: 'tablet', 3: 'phone', 4: 'canvas' }[e.key];
      if (key) selectDevice(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag-resize from the edge handles. The frame is horizontally centered,
  // so a side handle changes the width by twice the pointer movement — and
  // once the frame is zoomed to fit, a screen pixel is worth more than a
  // page pixel, so each step is measured against the scale it happened at
  // (which the drag itself keeps changing).
  const startResize = (edge) => (e) => {
    e.preventDefault();
    const frame = frameRef.current;
    if (!frame) return;
    let lastX = e.clientX;
    let lastY = e.clientY;
    let w = frame.offsetWidth;
    let h = frame.offsetHeight;
    setResizing(true);
    document.body.style.cursor = edge === 's' ? 'row-resize' : 'col-resize';
    const onMove = (ev) => {
      const k = scaleRef.current || 1;
      if (edge === 's') {
        h = clamp(h + (ev.clientY - lastY) / k, 160, 20000);
        lastY = ev.clientY;
        setCustomH(Math.round(h));
      } else {
        w = clamp(w + ((edge === 'e' ? 2 : -2) * (ev.clientX - lastX)) / k, MIN_FRAME_W, MAX_FRAME_W);
        lastX = ev.clientX;
        setCustomW(Math.round(w));
        setDevice('custom');
      }
    };
    const onUp = () => {
      setResizing(false);
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <div className="preview-toolbar">
        <div className="crumbs">
          {shownCrumbs.map((c, i) => {
            const last = i === shownCrumbs.length - 1;
            if (c.ellipsis) {
              return (
                <React.Fragment key="ellipsis">
                  <span className="crumb-sep">
                    <ChevronRightIcon size={9} />
                  </span>
                  <span
                    className="crumb crumb-more"
                    title={`Show ${c.hidden.length} more: ${c.hidden
                      .map((h) => h.label)
                      .join(' › ')}`}
                    onClick={() => setCrumbsExpanded(true)}
                  >
                    …
                  </span>
                </React.Fragment>
              );
            }
            return (
              <React.Fragment key={`${c.id}-${i}`}>
                {i > 0 && (
                  <span className="crumb-sep">
                    <ChevronRightIcon size={9} />
                  </span>
                )}
                <span
                  className={`crumb ${last ? 'last' : ''}`}
                  title={c.label}
                  onClick={() => onCrumb && onCrumb(c.id)}
                >
                  {c.label}
                </span>
              </React.Fragment>
            );
          })}
        </div>
        <div className="device-btns">
          {indicator && <span className="device-indicator" style={indicator} />}
          {DEVICES.map(({ key, Icon, title }) => (
            <button
              key={key}
              ref={(el) => (btnRefs.current[key] = el)}
              className={activeDevice === key ? 'on' : ''}
              title={title}
              onClick={() => selectDevice(key)}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
        {/* The size the page is actually being laid out at and how big it is
            being drawn — both readouts, both editable. Hidden on the canvas,
            which is every size at once and has its own zoom, and when there
            is no preview to measure. */}
        {url && device !== 'canvas' && (
          <div className="size-field">
            <input
              className="size-w"
              value={sizeText}
              onChange={(e) => setSizeText(e.target.value.replace(/[^0-9]/g, ''))}
              onFocus={(e) => {
                setSizeTyping(true);
                e.target.select();
              }}
              onBlur={() => {
                setSizeTyping(false);
                commitSize();
              }}
              onKeyDown={onSizeKey}
              inputMode="numeric"
              title="Width the page is laid out at — type a size, ↑↓ to nudge"
              aria-label="Preview width in pixels"
            />
            <span className="size-unit">px</span>
            <span className="size-sep" />
            <input
              className="size-z"
              value={zoomText}
              onChange={(e) => setZoomText(e.target.value.replace(/[^0-9]/g, ''))}
              onFocus={(e) => {
                setZoomTyping(true);
                e.target.select();
              }}
              onBlur={() => {
                setZoomTyping(false);
                commitZoom();
              }}
              onKeyDown={onZoomKey}
              inputMode="numeric"
              title="How big that is drawn — type a zoom, ↑↓ to nudge"
              aria-label="Preview zoom percentage"
            />
            <span className="size-unit">%</span>
            {!atOneToOne && (
              <button
                className="size-reset"
                title="Back to 1:1 — the widest the pane can show at full size"
                onClick={() => selectDevice('desktop')}
              >
                100%
              </button>
            )}
          </div>
        )}
      </div>

      <div className="preview-frame-wrap" ref={wrapRef}>
        {url && device === 'canvas' ? (
          <CanvasView url={url} refreshKey={refreshKey} />
        ) : url ? (
          <div
            ref={frameRef}
            className={`frame-sized ${width ? '' : 'full'} ${resizing ? 'resizing' : ''}`}
            style={{
              width: width ?? wrapWidth ?? '100%',
              '--frame-zoom': frameZoom,
              // Placed by hand rather than by the stylesheet's centering, so
              // that a frame too big for the pane spills to the right, where
              // scrolling can reach it, instead of off both edges at once.
              ...(framePlaced
                ? {
                    left: 0,
                    transform: `translateX(${offsetX}px) scale(${scale})`,
                    transformOrigin: 'top left',
                  }
                : null),
              ...(frameHeight != null ? { height: frameHeight, bottom: 'auto' } : {}),
            }}
          >
            <div className="frame-clip">
              <iframe
                key={`${url}-${refreshKey}`}
                ref={iframeRef}
                src={`${url}#avb-design`}
                title="Site preview"
                onLoad={() => {
                  registerFrame();
                  sendTrack();
                }}
              />
              {/* Editing a component: the page stays in context and everything
                  around the instance dims, so the piece being worked on is
                  the only lit part of the canvas. A layout has no "around" —
                  it wraps the whole page — so it lights all of it by drawing
                  nothing. */}
              {focusPath &&
                !focusWhole &&
                onePerPlace(rects[focusPath]).map((r, i) => (
                  <div
                    key={`focus-${i}`}
                    className="node-focus"
                    style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                  />
                ))}
              {/* What the style panel's spacing box is pointing at: the strip of
                  the page that side is holding open, in the colour of the box it
                  belongs to. Under the outlines, over the page. */}
              {/* A side being dragged is sized from the value under the
                  pointer, not from the last measurement — the page will lay
                  it out and be measured a few frames later, and the band
                  would otherwise skip the numbers in between. */}
              {spacingHover &&
                selPath &&
                spacingBands(
                  (rects[selPath] || [])[selOcc ?? 0] || (rects[selPath] || [])[0],
                  withLiveSpacing(
                    (spacing[selPath] || [])[selOcc ?? 0] || (spacing[selPath] || [])[0],
                    spacingHover.kind,
                    spacingHover.live
                  ),
                  spacingHover.kind,
                  spacingHover.sides
                ).map((b, i) => (
                  <div
                    // Padding and margin have one band per side; gap has one
                    // per space between children, so several share a side and
                    // the side alone is not a key.
                    key={`sp-${b.side}-${i}`}
                    className={`spacing-band is-${spacingHover.kind}`}
                    style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                  >
                    <span className="spacing-band-label">
                      {spacingHover.labels?.[b.side] || `${Math.round(b.side === 'left' || b.side === 'right' ? b.w : b.h)}px`}
                    </span>
                  </div>
                ))}
              {[
                // No second outline on the thing already outlined as selected —
                // the same node AND the same copy of it (see hoverIsSelection).
                hoverPath &&
                !hoverIsSelection({ path: hoverPath, occ: hoverOccUsed }, { path: selPath, occ: selOcc })
                  ? { path: hoverPath, type: 'hover', occ: hoverOccUsed }
                  : null,
                selPath ? { path: selPath, type: 'sel', occ: selOcc } : null,
              ]
                .filter(Boolean)
                .flatMap((o) => {
                  // A loop child renders once per item — one box per
                  // instance, each labelled, so an instance further down the
                  // page still says what it is.
                  const all = rects[o.path];
                  const info = overlayInfo ? overlayInfo(o.path) : null;
                  if (!all || !info) return [];
                  // One box, not one per loop item, unless the hover came from
                  // the navigator (which points at the node, not an instance) —
                  // and then one per place, since the same place reported twice
                  // would paint the fill twice (see onePerPlace).
                  const list =
                    o.occ == null ? onePerPlace(all) : all[o.occ] ? [all[o.occ]] : all.slice(0, 1);
                  return list.map((r, i) => (
                    <div
                      key={`${o.type}-${i}`}
                      className={`node-outline ${o.type} ${info.kind}${info.bound ? ' bound' : ''}`}
                      style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                    >
                      <span className={`node-outline-tag ${r.y < 20 ? 'inside' : ''}`}>
                        {outlineIcon(info)}
                        {info.label}
                      </span>
                    </div>
                  ));
                })}
            </div>
            <div className="rz-handle rz-w" onPointerDown={startResize('w')} />
            <div className="rz-handle rz-e" onPointerDown={startResize('e')} />
            <div className="rz-handle rz-s" onPointerDown={startResize('s')} />
            {resizing && (
              <div className="rz-readout">
                {Math.round(width ?? wrapWidth ?? 0)} × {customH ?? frameRef.current?.offsetHeight ?? ''}
              </div>
            )}
          </div>
        ) : (
          <div className="preview-placeholder">
            {devStatus === 'starting' ? (
              <>
                <div className="spinner" />
                <div>Starting Astro dev server…</div>
              </>
            ) : devStatus === 'on' ? (
              // The server is up; there is simply no page to show. Saying
              // "offline" here — with a button that restarts a healthy server —
              // sent at least one person debugging Astro for an hour (issue #7).
              <div className="offline-title">Nothing selected to preview. Pick a page on the left.</div>
            ) : (
              <DevOffline devLog={devLog} devDiag={devDiag} onRestart={onRestart} />
            )}
          </div>
        )}
      </div>
    </>
  );
}

// The offline state. A raw Astro log is only useful to someone who already
// knows what went wrong, so lead with the diagnosis (see dev:diagnose) and
// keep the log a click away for the cases it doesn't cover.
const NODE_URL = 'https://nodejs.org/en/download';

function DevOffline({ devLog, devDiag, onRestart }) {
  const [showLog, setShowLog] = React.useState(false);
  const kind = devDiag?.kind;
  const known = kind === 'no-node' || kind === 'node-too-old' || kind === 'no-deps';

  let title = 'Preview is offline.';
  let detail = null;
  let action = null;

  if (kind === 'no-node') {
    title = "Node.js isn't installed — or isn't where this app can see it.";
    detail =
      'Astro needs Node.js to run. Stacki looks on the system path, your login ' +
      "shell's path, and the usual Homebrew, nvm, fnm, volta, asdf and mise " +
      'locations, and found nothing. Install Node, then start the server again.';
    action = { label: 'Get Node.js', url: NODE_URL };
  } else if (kind === 'node-too-old') {
    title = `Node ${devDiag.nodeVersion} is too old for this project.`;
    detail = `astro ${devDiag.astroVersion} needs Node ${devDiag.requires}. Install a newer Node — if you use a version manager, the one it picks in this project's folder is the one Stacki will use.`;
    action = { label: 'Get Node.js', url: NODE_URL };
  } else if (kind === 'no-deps') {
    title = "This project's dependencies aren't installed.";
    detail =
      'Astro was not found in node_modules. Starting the server installs them ' +
      'automatically — if that keeps failing, the log below has the reason.';
  }

  return (
    <>
      <div className={known ? 'offline-title' : undefined}>{title}</div>
      {detail && <p className="offline-detail">{detail}</p>}
      <div className="offline-actions">
        <button onClick={onRestart}>Start dev server</button>
        {action && (
          <button className="ghost" onClick={() => window.avb.openExternal(action.url)}>
            {action.label}
          </button>
        )}
      </div>
      {/* Always available: the diagnosis names the common failures, not the
          project's own build errors, which is what the log is for. */}
      {devDiag?.nodePath && (
        <div className="offline-meta">
          Using Node {devDiag.nodeVersion || '?'} — {devDiag.nodePath}
        </div>
      )}
      {devLog && (
        <>
          <button className="ghost offline-log-toggle" onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'Hide log' : 'Show log'}
          </button>
          {showLog && <pre className="offline-log">{devLog}</pre>}
        </>
      )}
    </>
  );
}
