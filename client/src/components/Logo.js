import React from 'react';
import './Logo.css';

function Logo({ size = 32 }) {
  return (
    <div className="logo-container">
      <img
        src="/icon-192.png"
        alt="KeepLocal Logo"
        width={size}
        height={size}
        className="logo-img"
      />
      <span className="logo-text">KeepLocal</span>
    </div>
  );
}

export default Logo;
