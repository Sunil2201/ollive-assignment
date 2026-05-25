from datetime import datetime


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def rows_as_dicts(cur) -> list[dict]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]