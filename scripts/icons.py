"""Sport icons: one consistent line-icon set (24x24, round 1.8 stroke, currentColor), used for the splash
cards, the footer sport switcher, and each site's favicon."""
import urllib.parse

PATHS = {
    # Ball: filled centre pentagon, seams forking out to the rim
    "soccer": '<circle cx="12" cy="12" r="9.25"/><path fill="currentColor" d="M12.00 8.40L15.42 10.89L14.12 14.91L9.88 14.91L8.58 10.89z"/>'
              '<path d="M12.00 8.40L12.00 5.40M12.00 5.40L7.95 3.69M12.00 5.40L16.05 3.69M15.42 10.89L18.28 9.96M18.28 9.96L18.65 5.57M18.28 9.96L21.16 13.29M14.12 14.91L15.88 17.34M15.88 17.34L20.17 16.34M15.88 17.34L13.61 21.11M9.88 14.91L8.12 17.34M8.12 17.34L10.39 21.11M8.12 17.34L3.83 16.34M8.58 10.89L5.72 9.96M5.72 9.96L2.84 13.29M5.72 9.96L5.35 5.57"/>',
    # Ball on the diagonal with laces
    "football": '<path d="M4.6 19.4C4 12 12 4 19.4 4.6 20 12 12 20 4.6 19.4z"/>'
                '<path d="M9.2 14.8l5.6-5.6M9.7 12.5l1.8 1.8M11.1 11.1l1.8 1.8M12.5 9.7l1.8 1.8M4.9 15.6l3.5 3.5M15.6 4.9l3.5 3.5"/>',
    # Ball with its seams
    "basketball": '<circle cx="12" cy="12" r="9.25"/><path d="M12 2.75v18.5M2.75 12h18.5M5.6 5.3c3.1 3.5 3.1 9.9 0 13.4M18.4 5.3c-3.1 3.5-3.1 9.9 0 13.4"/>',
    # Stick with a strung head, and a ball
    "lacrosse": '<path d="M3.5 20.5l9.6-9.6"/><path d="M13.1 10.9c-1.5-2.7.2-6.9 3.6-7.5 2.6-.4 4.4 1.6 3.9 4.1-.6 3.2-4.6 5-7.5 3.4z"/>'
                '<path d="M15 5.6l3.6 3.6M14.1 8l2.4 2.4M17.4 4.4l2.3 2.3"/><circle cx="6.5" cy="7.5" r="2"/>',
}


def svg(name, size=None):
    """Inline icon that inherits the text colour."""
    dims = f' width="{size}" height="{size}"' if size else ""
    return (f'<svg class="icon" viewBox="0 0 24 24"{dims} fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{PATHS[name]}</svg>')


def favicon(name=None):
    """data: URI for a favicon: gold icon on a black rounded tile (or "OL" for the splash page)."""
    inner = (f'<g transform="translate(4 4)" fill="none" stroke="#f2b705" stroke-width="2.1" stroke-linecap="round" '
             f'stroke-linejoin="round">{PATHS[name]}</g>' if name else
             '<text x="16" y="21.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" '
             'font-size="14" fill="#f2b705">OL</text>')
    doc = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#111"/>{inner}</svg>'
    return "data:image/svg+xml," + urllib.parse.quote(doc)
