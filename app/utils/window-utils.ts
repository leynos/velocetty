import electron from 'electron';

/** Returns true when the given window position falls within any connected display's work area. */
export function positionIsValid(position: [number, number]) {
  const displays = electron.screen.getAllDisplays();
  const [x, y] = position;

  return displays.some(({workArea}) => {
    return x >= workArea.x && x <= workArea.x + workArea.width && y >= workArea.y && y <= workArea.y + workArea.height;
  });
}
