"""
Dialed In — landing page + waitlist.
Deep focus supplement brand. Standalone from Light Cycles.
"""

import os
import re
import time
import sqlite3
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = Path(__file__).parent / "dialedin.db"
STATIC_DIR = Path(__file__).parent / "static"

IS_PRODUCTION = os.getenv("RENDER", "") == "1" or os.getenv("PRODUCTION", "") == "1"


def get_db() -> sqlite3.Connection:
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    return db


def init_db():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS waitlist (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            source TEXT DEFAULT 'landing',
            created_at REAL NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS preorders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            status TEXT DEFAULT 'reserved',
            created_at REAL NOT NULL
        )
    """)
    db.commit()
    db.close()


# Simple in-memory rate limiter
_requests: dict[str, list[float]] = {}


def rate_limited(key: str, limit: int = 5, window: int = 60) -> bool:
    now = time.time()
    _requests.setdefault(key, [])
    _requests[key] = [t for t in _requests[key] if now - t < window]
    if len(_requests[key]) >= limit:
        return True
    _requests[key].append(now)
    return False


app = FastAPI(title="Dialed In", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class WaitlistRequest(BaseModel):
    email: str
    source: str = Field(default="landing")


@app.post("/api/waitlist")
async def join_waitlist(req: WaitlistRequest):
    email = str(req.email).lower().strip()

    if rate_limited("waitlist", limit=10, window=60):
        raise HTTPException(status_code=429, detail="Too many requests. Try again in a minute.")

    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")

    db = get_db()
    existing = db.execute("SELECT 1 FROM waitlist WHERE email = ?", (email,)).fetchone()
    if existing:
        db.close()
        return {"success": True, "message": "You're already on the list!", "duplicate": True}

    try:
        db.execute(
            "INSERT INTO waitlist (id, email, source, created_at) VALUES (?, ?, ?, ?)",
            (f"wl-{secrets.token_hex(6)}", email, req.source, time.time()),
        )
        db.commit()
    except sqlite3.IntegrityError:
        db.close()
        return {"success": True, "message": "You're already on the list!", "duplicate": True}
    finally:
        db.close()

    return {"success": True, "message": "You're on the list. Watch your inbox."}


@app.get("/api/waitlist/count")
async def waitlist_count():
    db = get_db()
    count = db.execute("SELECT COUNT(*) as c FROM waitlist").fetchone()["c"]
    db.close()
    return {"count": count}


class PreorderRequest(BaseModel):
    name: str
    email: str
    quantity: int = Field(default=1, ge=1, le=12)


@app.post("/api/preorder")
async def create_preorder(req: PreorderRequest):
    name = req.name.strip()
    email = req.email.lower().strip()

    if rate_limited("preorder", limit=5, window=60):
        raise HTTPException(status_code=429, detail="Too many requests. Try again in a minute.")

    if not name or len(name) < 2:
        raise HTTPException(status_code=400, detail="Enter your name.")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")

    db = get_db()
    db.execute(
        "INSERT INTO preorders (id, name, email, quantity, status, created_at) VALUES (?, ?, ?, ?, 'reserved', ?)",
        (f"po-{secrets.token_hex(6)}", name, email, req.quantity, time.time()),
    )
    db.commit()
    db.close()

    return {"success": True, "message": "Reserved! We'll email you when your order is ready.", "quantity": req.quantity}


@app.get("/api/preorder/count")
async def preorder_count():
    db = get_db()
    row = db.execute("SELECT COUNT(*) as c, COALESCE(SUM(quantity), 0) as q FROM preorders").fetchone()
    db.close()
    return {"count": row["c"], "units": row["q"]}


@app.get("/api/health")
async def health():
    return {"status": "healthy", "name": "Dialed In", "version": "1.0.0"}


# Static files (landing page)
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# Init on import
init_db()
