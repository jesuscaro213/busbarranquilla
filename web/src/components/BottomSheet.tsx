import React from 'react';

export type SheetState = 'collapsed' | 'middle' | 'expanded';

interface Props {
  state: SheetState;
  onStateChange: (s: SheetState) => void;
  children: React.ReactNode;
  actions: React.ReactNode;
}

const HEIGHT: Record<SheetState, string> = {
  collapsed: '80px',
  middle: '50vh',
  expanded: '85vh',
};

export default function BottomSheet({ state, onStateChange, children, actions }: Props) {
  const toggle = () => onStateChange(state === 'collapsed' ? 'middle' : 'collapsed');

  return (
    <div
      style={{
        height: HEIGHT[state],
        transition: 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
      className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl flex flex-col z-[1050] overflow-hidden"
    >
      {/* Drag handle */}
      <button
        onClick={toggle}
        aria-label="Expandir o colapsar panel"
        className="shrink-0 flex justify-center items-center h-5 w-full pt-2"
      >
        <div className="w-9 h-1 bg-gray-300 rounded-full" />
      </button>

      {/* Scrollable content — invisible when collapsed */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {children}
      </div>

      {/* Fixed action bar — always visible */}
      <div className="shrink-0 px-4 py-2 border-t border-gray-100">
        {actions}
      </div>
    </div>
  );
}
