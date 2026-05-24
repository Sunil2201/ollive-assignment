"""
PII redaction utilities.

Patterns are pre-compiled at import time. Ordered most-specific to
least to avoid partial matches (e.g. SSN before generic digit runs).
"""

import re
from typing import Tuple

_PATTERNS = [
    # SSN: 123-45-6789
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    # Credit/debit card: 13-16 digits, optionally space/dash-separated
    (re.compile(r"\b(?:\d[ -]?){13,15}\d\b"), "[CARD]"),
    # Passport: 1-2 letters followed by 6-9 digits (US/international style)
    (re.compile(r"\b[A-Z]{1,2}\d{6,9}\b"), "[PASSPORT]"),
    # Phone: various formats (+1, dashes, parens, dots)
    (re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b"), "[PHONE]"),
    # Email
    (re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"), "[EMAIL]"),
]


def redact_pii(text: str) -> Tuple[str, bool]:
    """
    Replace PII tokens with labelled placeholders.

    Returns (redacted_text, was_anything_redacted).
    The function is pure — no side effects — making it safe to call on any string.
    """
    redacted = text
    changed = False
    for pattern, replacement in _PATTERNS:
        new = pattern.sub(replacement, redacted)
        if new != redacted:
            changed = True
        redacted = new
    return redacted, changed
