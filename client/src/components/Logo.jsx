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
        <rect width="48" height="48" rx="10" fill="url(#logoBg)" className="logo-bg"/>
        {/* Note paper */}
        <path
          d="M 13 7 H 32 L 38 13 V 41 C 38 42.1 37.1 43 36 43 H 13 C 11.9 43 11 42.1 11 41 V 9 C 11 7.9 11.9 7 13 7 Z"
          fill="#FFFFFF"
          className="logo-paper"
        />
        {/* Corner fold */}
        <path
          d="M 32 7 V 11 C 32 12.1 32.9 13 34 13 H 38 L 32 7 Z"
          fill="#E8DDD0"
          className="logo-fold"
        />
        {/* Text lines */}
        <line x1="15" y1="18" x2="34" y2="18" stroke="#D4887D" strokeWidth="2" strokeLinecap="round" className="logo-line"/>
        <line x1="15" y1="23" x2="30" y2="23" stroke="#D4887D" strokeWidth="2" strokeLinecap="round" opacity="0.6" className="logo-line"/>
        <line x1="15" y1="28" x2="25.5" y2="28" stroke="#D4887D" strokeWidth="2" strokeLinecap="round" opacity="0.35" className="logo-line"/>
        {/* Checkmark */}
        <circle cx="19" cy="35.5" r="2.8" fill="#D4887D" className="logo-check"/>
        <path
          d="M 17.3 35.5 L 18.5 36.7 L 21 34.2"
          stroke="#FFFFFF"
          strokeWidth="1.2"
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
