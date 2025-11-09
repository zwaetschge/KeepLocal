// Maps note colors between light and dark mode
const colorMap = {
  '#ffffff': { light: '#ffffff', dark: '#202124', cssVar: 'note-white' },
  '#f28b82': { light: '#f28b82', dark: '#5c2b29', cssVar: 'note-red' },
  '#fbbc04': { light: '#fbbc04', dark: '#614a19', cssVar: 'note-orange' },
  '#fff475': { light: '#fff475', dark: '#635d19', cssVar: 'note-yellow' },
  '#ccff90': { light: '#ccff90', dark: '#345920', cssVar: 'note-green' },
  '#a7ffeb': { light: '#a7ffeb', dark: '#16504b', cssVar: 'note-teal' },
  '#cbf0f8': { light: '#cbf0f8', dark: '#2d555e', cssVar: 'note-cyan' },
  '#aecbfa': { light: '#aecbfa', dark: '#1e3a5f', cssVar: 'note-blue' },
  '#d7aefb': { light: '#d7aefb', dark: '#42275e', cssVar: 'note-purple' },
  '#fdcfe8': { light: '#fdcfe8', dark: '#5b2245', cssVar: 'note-pink' },
  '#e6c9a8': { light: '#e6c9a8', dark: '#442f19', cssVar: 'note-brown' },
  '#e8eaed': { light: '#e8eaed', dark: '#3c3f43', cssVar: 'note-gray' },
};

// Get CSS variable name for a color
export function getColorVar(lightColor) {
  const mapping = colorMap[lightColor];
  return mapping ? `var(--${mapping.cssVar})` : lightColor;
}

// Get the appropriate color based on mode
export function getColorForMode(lightColor, isDarkMode) {
  const mapping = colorMap[lightColor];
  if (!mapping) return lightColor;
  return isDarkMode ? mapping.dark : mapping.light;
}

// Get all available colors
export function getAllColors() {
  return Object.keys(colorMap);
}
