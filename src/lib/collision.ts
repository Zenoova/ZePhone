/**
 * The margin a floating panel (menu, popover, select) keeps from the edges of the screen. On an iPhone the system's tab bar
 * floats over the bottom of the page (the shell tells its height in `--native-tabbar-height`): a panel must stay clear of it.
 */
export function collisionPadding(edge: number): { top: number; right: number; bottom: number; left: number } {
  const bar =
    typeof document === "undefined"
      ? 0
      : parseFloat(document.documentElement.style.getPropertyValue("--native-tabbar-height"));
  return { top: edge, right: edge, left: edge, bottom: edge + (Number.isFinite(bar) ? bar : 0) };
}
