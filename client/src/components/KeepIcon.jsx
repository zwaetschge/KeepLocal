import React from 'react';
export default function KeepIcon({name,size=24}) {
  const paths={
    menu:<path d="M3 6h18M3 12h18M3 18h18"/>,
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
    grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    list:<><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/></>,
    settings:<><path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 2 3-2 4-1 2-4-2-3-1-4-4-2z"/><circle cx="12" cy="12" r="3"/></>,
    note:<><path d="M9 18h6M9 21h6M8 15a7 7 0 1 1 8 0l-1 3H9z"/></>,
    reminder:<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/></>,
    label:<><path d="m3 5 12 0 6 7-6 7H3z"/></>,
    edit:<><path d="m4 16 12-12 4 4L8 20H4zM13 7l4 4"/></>,
    checklist:<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 12 3 3 7-7"/></>,
    image:<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 16-6-6L4 21"/></>,
    archive:<><path d="M3 8h18v13H3zM2 3h20v5H2zM9 12h6"/></>,
    trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
    more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
