import React, { Suspense } from 'react';

// Keep a panel's first load inside its own boundary so the editor stays mounted.
export function lazyPanel(load) {
  const Panel = React.lazy(async () => {
    const { default: Component } = await load();
    return {
      default: function LoadedPanel({ panelProps }) {
        return <Component {...panelProps} />;
      },
    };
  });
  return function LazyPanel(props) {
    return (
      <Suspense fallback={null}>
        <Panel panelProps={props} />
      </Suspense>
    );
  };
}
