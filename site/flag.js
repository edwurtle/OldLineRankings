// Shared by every page: draws the Maryland flag into [data-flag] elements and the --flag-url background.
// Maryland flag: Calvert (paly of six or and sable, a bend counterchanged) and
// Crossland (quarterly argent and gules, a cross bottony counterchanged).
let flagId = 0;
window.flagSVG = function flagSVG() {
  const id = "f" + (flagId++);
  const G = "#f2b705", K = "#111", R = "#c8102e", W = "#fff";
  const calvert = (x, y) => {
    const pales = swap => [0, 1, 2, 3, 4, 5].map(i => `<rect x="${x + i * 25}" y="${y}" width="25" height="100" fill="${(i % 2 === 0) !== swap ? G : K}"/>`).join("");
    return `<clipPath id="${id}b${x}${y}"><polygon points="${x},${y} ${x + 34},${y} ${x + 150},${y + 77} ${x + 150},${y + 100} ${x + 116},${y + 100} ${x},${y + 23}"/></clipPath>
      ${pales(false)}<g clip-path="url(#${id}b${x}${y})">${pales(true)}</g>`;
  };
  const crossland = (x, y) => {
    const quarters = swap => [[0, 0, W], [75, 0, R], [0, 50, R], [75, 50, W]]
      .map(([dx, dy, c]) => `<rect x="${x + dx}" y="${y + dy}" width="75" height="50" fill="${swap ? (c === W ? R : W) : c}"/>`).join("");
    const cx = x + 75, cy = y + 50;
    const cross = `<rect x="${cx - 8}" y="${y + 14}" width="16" height="72"/><rect x="${x + 22}" y="${cy - 8}" width="106" height="16"/>` +
      [[cx, y + 12], [cx, y + 88], [x + 20, cy], [x + 130, cy]].map(([px, py]) =>
        `<circle cx="${px}" cy="${py}" r="7"/><circle cx="${px + (px === cx ? -7 : 0)}" cy="${py + (px === cx ? 0 : -7)}" r="6"/><circle cx="${px + (px === cx ? 7 : 0)}" cy="${py + (px === cx ? 0 : 7)}" r="6"/>`).join("");
    return `<clipPath id="${id}c${x}${y}">${cross}</clipPath>${quarters(false)}<g clip-path="url(#${id}c${x}${y})">${quarters(true)}</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice">${calvert(0, 0)}${crossland(150, 0)}${crossland(0, 100)}${calvert(150, 100)}</svg>`;
};
document.querySelectorAll("[data-flag]").forEach(el => el.innerHTML = flagSVG());
document.documentElement.style.setProperty("--flag-url", `url("data:image/svg+xml,${encodeURIComponent(flagSVG())}")`);
