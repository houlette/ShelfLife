import re

# Goodreads encodes series info in the title as a parenthetical suffix:
#
#   Name of the Wind (Kingkiller Chronicle, #1)
#   Mort (Discworld, #4; Death, #1)         ← subseries notation
#   Soul Music (Discworld, #16; Death, #2)
#
# We want the *primary* series ("Discworld") and its position (16), not
# the subseries. So the series-name character class explicitly excludes
# commas — if we let it match across commas the engine would greedily
# extend past the primary position and capture "Discworld, #16; Death"
# as the name with "2" as the position. The lack of a trailing `\)`
# also lets us anchor on the first `, #N` we find, leaving any
# subseries notation after it for the parser to ignore.
SERIES_RE = re.compile(r"\(([^,()]+?),\s*(?:#|book\s*)(\d+)", re.IGNORECASE)


def parse_series(title: str) -> tuple[str | None, int | None]:
    """Return (display_name, position) from a Goodreads-style title suffix.

    E.g. "Name of the Wind (Kingkiller Chronicle, #1)" → ("Kingkiller Chronicle", 1)
    Subseries notation collapses to the primary series:
         "Mort (Discworld, #4; Death, #1)"               → ("Discworld", 4)
    Returns (None, None) if no series suffix is found.
    """
    m = SERIES_RE.search(title)
    if not m:
        return None, None
    return m.group(1).strip(), int(m.group(2))
