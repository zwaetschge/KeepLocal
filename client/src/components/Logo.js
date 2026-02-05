import React from 'react';
import './Logo.css';

function Logo({ size = 32 }) {
  return (
    <div className="logo-container">
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="logo-svg"
        aria-label="KeepLocal Logo"
        role="img"
      >
        {/* Back note (depth/stack effect) */}
        <rect
          x="10" y="4" width="28" height="34" rx="4"
          className="logo-note-back"
        />
        {/* Main note */}
        <rect
          x="6" y="8" width="28" height="34" rx="4"
          className="logo-note-main"
        />
        {/* Corner fold */}
        <path
          d="M26 8L34 8L34 16C34 16 30 16 28 16C26.9 16 26 15.1 26 14L26 8Z"
          className="logo-note-fold"
        />
        <path
          d="M26 8L34 16"
          className="logo-note-fold-line"
        />
        {/* Text lines on note */}
        <line x1="12" y1="20" x2="24" y2="20" strokeWidth="1.8" strokeLinecap="round" className="logo-line" />
        <line x1="12" y1="25" x2="21" y2="25" strokeWidth="1.8" strokeLinecap="round" className="logo-line" />
        <line x1="12" y1="30" x2="18" y2="30" strokeWidth="1.8" strokeLinecap="round" className="logo-line" />
        {/* Pushpin */}
        <ellipse cx="36" cy="6" rx="6" ry="5.5" className="logo-pin-head" />
        <circle cx="36" cy="6" r="2.2" className="logo-pin-center" />
        <line x1="36" y1="11.5" x2="36" y2="20" strokeWidth="2" strokeLinecap="round" className="logo-pin-needle" />
      </svg>
      <span className="logo-text">KeepLocal</span>
    </div>
  );
}

export default Logo;
