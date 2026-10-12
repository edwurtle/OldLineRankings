// Shared by every page: puts the Maryland flag (flag.svg, next to this script) into [data-flag] elements
// and sets the --flag-url background used by page headers.
(() => {
  const base = document.currentScript.src.replace(/flag\.js(\?.*)?$/, "");
  window.flagSVG = () => `<img src="${base}flag.svg" alt="" draggable="false">`;
  document.querySelectorAll("[data-flag]").forEach(el => el.innerHTML = flagSVG());
  document.documentElement.style.setProperty("--flag-url", `url("${base}flag.svg")`);
})();
