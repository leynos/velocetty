// Packages
import Color from 'color';

/**
 * Converts any CSS colour value (rgb, hsl, string...) to Electron's hex-with-alpha
 * background colour format (e.g. `#00000050`).
 */
const toElectronBackgroundColor = (bgColor: string) => {
  const color = Color(bgColor);

  if (color.alpha() === 1) {
    return color.hex().toString();
  }

  // http://stackoverflow.com/a/11019879/1202488
  const alphaHex = Math.round(color.alpha() * 255).toString(16);
  return `#${alphaHex}${color.hex().toString().slice(1)}`;
};

export default toElectronBackgroundColor;
