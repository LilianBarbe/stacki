import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { THEME } from './TerminalPane.jsx';
import { ArrowDownIcon, RefreshIcon } from '../ui/Icons.jsx';
import './devLog.css';

// Astro's own console, as a pinned tab in the dock.
//
// The dev server is a child of main, and its stdout/stderr already reach the
// renderer as `dev:log` — but that stream only ever surfaced in the preview's
// offline screen, so a warning, a content-collection error or a slow route
// scrolled past unseen for as long as the canvas still looked fine. This is
// that same stream, in the same xterm the shell tabs use.
//
// Read-only on purpose: the server is a piped child process, not a pty, so
// there is nothing to type into. Restart is the one control it wants, and it
// goes back through the app's own start path rather than a signal from here.

const DevLogPane = forwardRef(function DevLogPane({ logRef, status, onRestart }, ref) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const initialized = useRef(false);
  const ready = useRef(false);
  const disposeListeners = useRef(null);

  const [scrolledUp, setScrolledUp] = useState(false);

  // Fitting a zero-sized or half-built terminal throws from deep inside
  // xterm's viewport, so every fit goes through here. Unlike a shell pane
  // there's no pty to tell about the new size — nothing here is echoing a
  // prompt back at a column count.
  const safeFit = () => {
    if (!ready.current || !fitRef.current || !termRef.current || !hostRef.current) return;
    const { offsetWidth, offsetHeight } = hostRef.current;
    if (offsetWidth === 0 || offsetHeight === 0) return;
    try {
      fitRef.current.fit();
    } catch {
      /* not fully rendered yet */
    }
  };

  useImperativeHandle(ref, () => ({
    fit: safeFit,
    // Deliberately inert. The dock focuses whichever pane a tab switch
    // reveals, which is right for a shell — but xterm's textarea swallows
    // keystrokes it handles, and there is nothing to type here. Leaving focus
    // where it was keeps ⌘J and the app's other shortcuts live while the log
    // is on screen; the wheel scrolls it either way.
    focus: () => {},
  }));

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    initialized.current = false;
    ready.current = false;
    let runDisposed = false;

    const init = () => {
      if (initialized.current) return;
      // Wait for the host to have dimensions — the dock starts collapsed.
      if (host.offsetWidth === 0 || host.offsetHeight === 0) return;
      initialized.current = true;

      const term = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        // A pty ends its lines with \r\n; this is a plain pipe, whose \n alone
        // would render as a stair-step down the pane.
        convertEol: true,
        fontSize: 12,
        fontFamily: "'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace",
        theme: THEME,
        scrollback: 10_000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      termRef.current = term;
      fitRef.current = fit;

      try {
        term.open(host);
        // xterm's render service finishes initializing after a paint frame;
        // fitting before that throws from Viewport._innerRefresh.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (runDisposed) return;
            ready.current = true;
            safeFit();
          })
        );
      } catch {
        /* open failed — the stream below still arrives */
      }

      // What the server has already said. Read here rather than from a render
      // prop: the pane can initialize a good while after it mounts (the dock
      // is hidden until toggled), and this way the backlog and the listener
      // are taken in the same tick, so no chunk falls between them.
      const backlog = logRef?.current || '';
      if (backlog) term.write(backlog.endsWith('\n') ? backlog : `${backlog}\n`);

      const offLog = window.avb.onDevLog((chunk) => {
        if (runDisposed) return;
        try {
          termRef.current?.write(chunk);
        } catch {
          /* disposed mid-write */
        }
      });
      // `dev:exit` carries the tail of the log with it, for the offline
      // screen's benefit — writing it here would repeat lines this pane has
      // already shown live, so only the marker goes in.
      const offExit = window.avb.onDevExit(({ code }) => {
        if (runDisposed) return;
        termRef.current?.write(
          `\r\n\x1b[90m[astro dev exited${code === null || code === undefined ? '' : ` with code ${code}`}]\x1b[0m\r\n`
        );
      });
      disposeListeners.current = () => {
        offLog();
        offExit();
      };

      // Show the scroll-to-bottom button when the user has scrolled up. Reads
      // the buffer API rather than the viewport's DOM — same reasoning as
      // TerminalPane.
      term.onScroll(() => {
        const buf = term.buffer.active;
        setScrolledUp(buf.baseY - buf.viewportY > 2);
      });
    };

    // The dock is hidden until toggled, so the host has no size on mount —
    // the observer is what actually builds the terminal, first time round.
    const ro = new ResizeObserver(() => (initialized.current ? safeFit() : init()));
    ro.observe(host);
    init(); // …unless it's already visible

    const onWindowResize = () => safeFit();
    window.addEventListener('resize', onWindowResize);

    return () => {
      runDisposed = true;
      ready.current = false;
      ro.disconnect();
      disposeListeners.current?.();
      disposeListeners.current = null;
      window.removeEventListener('resize', onWindowResize);
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, []);

  // A start clears main's buffer, so clear the pane with it — otherwise the
  // new server's first lines run on under the dead one's and the pane reads
  // as one long session that never restarted. reset() rather than clear():
  // clear() keeps the last line on screen.
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (status === 'starting' && was !== 'starting') termRef.current?.reset();
  }, [status]);

  return (
    <div className="term-pane">
      <div className="term-host" ref={hostRef} />

      <div className="devlog-actions">
        <span className={`status-dot ${status}`} title={`Dev server: ${status}`} />
        <button
          className="ghost devlog-restart"
          title="Restart the dev server"
          disabled={status === 'starting'}
          onClick={onRestart}
        >
          <RefreshIcon size={12} />
        </button>
      </div>

      {scrolledUp && (
        <button
          className="term-scroll-btn"
          title="Scroll to bottom"
          onClick={() => termRef.current?.scrollToBottom()}
        >
          <ArrowDownIcon size={14} />
        </button>
      )}
    </div>
  );
});

export default DevLogPane;
