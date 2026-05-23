import re

SERIES_RE = re.compile(r"\(([^()]+?),\s*(?:#|book\s*)(\d+)\)", re.IGNORECASE)


def parse_series(title: str) -> tuple[str | None, int | None]:
    """Return (display_name, position) from a Goodreads-style title suffix.

    E.g. "Name of the Wind (Kingkiller Chronicle, #1)" → ("Kingkiller Chronicle", 1)
    Returns (None, None) if no series suffix is found.
    """
    m = SERIES_RE.search(title)
    if not m:
        return None, None
    return m.group(1).strip(), int(m.group(2))
