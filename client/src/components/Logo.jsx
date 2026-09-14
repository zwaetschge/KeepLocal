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
        <defs>
          <linearGradient id="logoBg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#D4887D"/>
            <stop offset="100%" stopColor="#B56B55"/>
          </linearGradient>
        </defs>
        {/* Rounded square background */}
        <rect width="48" height="48" rx="11" fill="url(#logoBg)" className="logo-bg"/>
        {/* Note paper */}
        <path
          d="M 15 6.5 H 30 L 38 14.5 V 39 Q 38 42 35 42 H 15 Q 12 42 12 39 V 9.5 Q 12 6.5 15 6.5 Z"
          fill="#FFFFFF"
          className="logo-paper"
        />
        {/* Corner fold */}
        <path d="M 30 6.5 V 11.5 Q 30 14.5 33 14.5 H 38 Z" fill="#E7D9C9" className="logo-fold"/>
        {/* Fold shadow */}
        <path d="M 30 14.5 H 33 Q 34.4 13.1 35.1 11.6 L 38 14.5 Z" fill="#000000" opacity="0.08"/>
        {/* Text lines */}
        <line x1="16" y1="18.5" x2="33.5" y2="18.5" stroke="#B56B55" strokeWidth="2.7" strokeLinecap="round" className="logo-line"/>
        <line x1="16" y1="24" x2="27" y2="24" stroke="#B56B55" strokeWidth="2.7" strokeLinecap="round" opacity="0.55" className="logo-line"/>
        {/* Check badge breaking out of the sheet corner */}
        <circle cx="31.5" cy="36.5" r="5.4" fill="#B56B55" className="logo-check"/>
        <circle cx="31.5" cy="36.5" r="5.4" fill="none" stroke="#FFFFFF" strokeWidth="1.1" opacity="0.35"/>
        <path
          d="M 29.1 36.6 L 30.8 38.3 L 34.1 34.8"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span className="logo-text">KeepLocal</span>
    </div>
  );
}

export default Logo;
