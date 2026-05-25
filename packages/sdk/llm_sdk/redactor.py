import re
from typing import Tuple

_PATTERNS = [
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(r"\b(?:\d[ -]?){13,15}\d\b"), "[CARD]"),
    (re.compile(r"\b[A-Z]{1,2}\d{6,9}\b"), "[PASSPORT]"),
    (re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b"), "[PHONE]"),
    (re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"), "[EMAIL]"),
]


def redact_pii(text: str) -> Tuple[str, bool]:
    redacted = text
    changed = False
    for pattern, replacement in _PATTERNS:
        new = pattern.sub(replacement, redacted)
        if new != redacted:
            changed = True
        redacted = new
    return redacted, changed
