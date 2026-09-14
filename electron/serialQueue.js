// Enqueue before waiting: several callers waiting on the same current task
// would otherwise all start together when it settles. A failure only rejects
// its caller and never prevents the following task from running.
function createSerialQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}

module.exports = { createSerialQueue };

// One pending result per key, while different keys still share the same serial
// resource. Cancellation also invalidates active work at its next checkpoint.
function createKeyedQueue() {
  const queue = createSerialQueue();
  const pending = new Map();
  let era = 0;
  return {
    run(key, task) {
      if (pending.has(key)) {return pending.get(key);}
      const startedIn = era;
      const assertActive = () => {
        if (startedIn !== era) {throw new Error('The operation was cancelled.');}
      };
      const result = queue(() => {
        assertActive();
        return task(assertActive);
      });
      pending.set(key, result);
      const clear = () => { if (pending.get(key) === result) {pending.delete(key);} };
      result.then(clear, clear);
      return result;
    },
    cancel() {
      era++;
      pending.clear();
    },
  };
}

module.exports.createKeyedQueue = createKeyedQueue;
