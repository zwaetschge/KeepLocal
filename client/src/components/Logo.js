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
      >
        {/* Background gradient circle */}
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#667eea" />
            <stop offset="100%" stopColor="#764ba2" />
          </linearGradient>
        </defs>

        {/* Main circle */}
        <circle cx="24" cy="24" r="20" fill="url(#logoGradient)" />

        {/* Note icon */}
        <path
          d="M16 14h16v2H16v-2zm0 4h16v2H16v-2zm0 4h16v2H16v-2zm0 4h10v2H16v-2z"
          fill="white"
          opacity="0.9"
        />

        {/* Lock/local indicator */}
        <g transform="translate(28, 28)">
          <circle cx="6" cy="6" r="7" fill="#fbbc04" />
          <path
            d="M6 3a2 2 0 0 1 2 2v1h-4V5a2 2 0 0 1 2-2z"
            fill="white"
            opacity="0.9"
          />
          <rect
            x="3"
            y="6"
            width="6"
            height="4"
            rx="1"
            fill="white"
            opacity="0.9"
          />
        </g>
      </svg>
      <span className="logo-text">KeepLocal</span>
    </div>
  );
}

export default Logo;
