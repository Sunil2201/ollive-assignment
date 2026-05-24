import os
from contextlib import contextmanager

import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    """Initialise the connection pool on first use so the module can be
    imported without DATABASE_URL being set (e.g. during testing or when
    the env file hasn't been loaded yet at import time)."""
    global _pool
    if _pool is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError(
                "DATABASE_URL is not set. "
                "Create apps/backend/.env (copy .env.example) and fill in your Postgres URL."
            )
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=database_url,
        )
    return _pool


@contextmanager
def get_conn():
    conn = _get_pool().getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _get_pool().putconn(conn)
