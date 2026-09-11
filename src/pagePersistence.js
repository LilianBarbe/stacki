// Serialize writes and drain edits made while a write is pending. A successful
// write acknowledges its exact state object, never a newer edit or another file.
export function createPageSaver({ readCurrent, write, markSaved }) {
  let pending = Promise.resolve();
  const saved = new WeakSet();
  const flush = async () => {
    const path = readCurrent().currentPage?.path;
    if (!path) return;
    while (true) {
      const { currentPage, pageState } = readCurrent();
      if (currentPage?.path !== path || !pageState?.dirty) return;
      if (!saved.has(pageState)) {
        await write(path, pageState);
        saved.add(pageState);
      }
      markSaved(pageState);
      if (readCurrent().pageState === pageState) return;
    }
  };
  return () => {
    const result = pending.then(flush);
    // A failed save is reported to its caller and leaves future saves usable.
    pending = result.catch(() => {});
    return result;
  };
}

export function scanContainsFile(scan, path) {
  return ['pages', 'components', 'layouts'].some((kind) =>
    scan?.[kind]?.some((entry) => entry.path === path)
  );
}

// Each code window destination owns its debounce. Typing in a second file must
// never cancel the first file's pending write. Writes to one file stay ordered.
export function createFileSaver({ delay = 300, onError = () => {} } = {}) {
  const waiting = new Map();
  const running = new Map();
  const start = (key) => {
    const entry = waiting.get(key);
    if (!entry) return running.get(key) || Promise.resolve();
    waiting.delete(key);
    clearTimeout(entry.timer);
    const result = (running.get(key) || Promise.resolve()).catch(() => {}).then(entry.write);
    running.set(key, result);
    result.then(
      () => { if (running.get(key) === result) running.delete(key); },
      (error) => {
        if (running.get(key) === result) {
          running.delete(key);
          if (!waiting.has(key)) waiting.set(key, { write: entry.write, timer: null });
        }
        onError(error);
      }
    );
    return result;
  };
  return {
    schedule(key, write) {
      clearTimeout(waiting.get(key)?.timer);
      waiting.set(key, { write, timer: setTimeout(() => { void start(key).catch(() => {}); }, delay) });
    },
    async flush() {
      do {
        for (const key of waiting.keys()) start(key);
        await Promise.all(running.values());
      } while (waiting.size);
    },
  };
}
