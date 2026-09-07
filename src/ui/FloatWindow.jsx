import React, { useState } from 'react';
import { CloseIcon } from './Icons.jsx';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// A floating, draggable, resizable window. Non-modal: the rest of the app stays
// interactive while it's open, which is the whole point — what you change in
// here (a value, a line of code) shows on the canvas behind it as you type.
//
// The shell only: the header's title strip and what goes in the body are the
// caller's. `head` sits between the title and the buttons — a search field, a
// saved chip — and `actions` are buttons that come before Close.
export default function FloatWindow({
  className = '',
  hidden = false,
  icon,
  title,
  tag,
  titleHint,
  head,
  actions,
  onClose,
  closeHint = 'Close',
  // How big it opens, as a share of the window. Proportional rather than fixed
  // because the things that open in here are usually wide, and a small default
  // meant resizing it every time. Capped so it stays a floating window on a
  // wide monitor, and floored at the minimums so a short window still gets
  // something usable.
  size,
  children,
}) {
  const { width = 0.52, height = 0.78, maxW = 1040, minW = 340, minH = 220 } = size || {};
  const [rect, setRect] = useState(() => {
    const w = clamp(Math.round(window.innerWidth * width), minW, maxW);
    const h = clamp(Math.round(window.innerHeight * height), minH, window.innerHeight - 140);
    return {
      // Right-anchored: the canvas stays visible to its left.
      x: Math.max(60, window.innerWidth - w - 80),
      y: 96,
      w,
      h,
    };
  });

  const startDrag = (e) => {
    // Anything you can press or type in keeps its own press — the header holds
    // buttons, and for some windows a search field too.
    if (e.target.closest('button, input, textarea, select, a')) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y } = rect;
    const onMove = (ev) => {
      setRect((r) => ({
        ...r,
        x: clamp(x + ev.clientX - sx, -r.w + 120, window.innerWidth - 60),
        y: clamp(y + ev.clientY - sy, 42, window.innerHeight - 48),
      }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResize = (edge) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { ...rect };
    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      setRect(() => {
        let { x, y, w, h } = start;
        if (edge.includes('e')) w = Math.max(minW, start.w + dx);
        if (edge.includes('s')) h = Math.max(minH, start.h + dy);
        if (edge.includes('w')) {
          w = Math.max(minW, start.w - dx);
          x = start.x + (start.w - w);
        }
        if (edge.includes('n')) {
          h = Math.max(minH, start.h - dy);
          y = start.y + (start.h - h);
        }
        return { x, y, w, h };
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`float-win ${className} ${hidden ? 'hidden' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div className="float-win-header" onPointerDown={startDrag}>
        {icon}
        <span className="float-win-title" title={titleHint}>
          {title}
        </span>
        {tag && <span className="type-tag">{tag}</span>}
        <span style={{ flex: 1 }} />
        {head}
        {actions}
        <button className="ghost" title={closeHint} onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="float-win-body">{children}</div>
      <div className="fw-rz fw-rz-n" onPointerDown={startResize('n')} />
      <div className="fw-rz fw-rz-s" onPointerDown={startResize('s')} />
      <div className="fw-rz fw-rz-e" onPointerDown={startResize('e')} />
      <div className="fw-rz fw-rz-w" onPointerDown={startResize('w')} />
      <div className="fw-rz fw-rz-se" onPointerDown={startResize('se')} />
      <div className="fw-rz fw-rz-sw" onPointerDown={startResize('sw')} />
      <div className="fw-rz fw-rz-ne" onPointerDown={startResize('ne')} />
      <div className="fw-rz fw-rz-nw" onPointerDown={startResize('nw')} />
    </div>
  );
}
