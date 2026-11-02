import React from 'react';

const paths: Record<string, string> = {
  desk: 'M3 10h18v10H3z M6 10V5h12v5 M7 15h10',
  repair: 'm14 6 4 4 M20 4a6 6 0 0 1-7 8L6 19a2 2 0 0 1-3-3l7-7a6 6 0 0 1 8-7l-4 4 4 4z',
  records: 'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4',
  chart: 'M4 3v17h17 M8 15v-4 M13 15V7 M18 15V4',
  calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 17h2',
  check: 'M9 3H4v18h16V3h-5 M9 2h6v4H9z m-1 12 3 3 5-6',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',
  people:
    'M15 21v-3a5 5 0 0 0-10 0v3 M18 14a4 4 0 0 1 3 4v3 M10 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 3a4 4 0 0 1 0 8',
  shield: 'm12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5z m-4 10 3 3 5-6',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  person: 'M4 21v-3a8 8 0 0 1 16 0v3 M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 m5 12 6 6',
  more: 'M4 4h5v5H4z M15 4h5v5h-5z M4 15h5v5H4z M15 15h5v5h-5z'
};

export function WorkspaceIcon({ name = 'records' }: { name?: string }) {
  return (
    <svg
      className="workspace-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name] || paths.records} />
    </svg>
  );
}
