"""
Persistent history and configuration manager for DownloadHub.
Uses SQLite for zero-dependency, ultra-fast persistence.
"""

import json
import os
import platform
import sqlite3
import subprocess
import time
from typing import Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "history.db")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")

os.makedirs(DATA_DIR, exist_ok=True)


def get_db_connection() -> sqlite3.Connection:
    """Return a configured SQLite connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database tables."""
    with get_db_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                type TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER DEFAULT 0,
                source_url TEXT DEFAULT '',
                completed_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_completed ON downloads(completed_at DESC)"
        )
        conn.commit()


# Initialize on import
init_db()


def add_history(title: str, item_type: str, file_path: str, file_size: int = 0, source_url: str = "") -> int:
    """Add a completed download record to the database."""
    now = int(time.time())
    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO downloads (title, type, file_path, file_size, source_url, completed_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (title, item_type, file_path, file_size, source_url, now),
        )
        conn.commit()
        return cursor.lastrowid


def get_history(limit: int = 50, offset: int = 0, search: str = "") -> list[dict]:
    """Retrieve history records with optional search and pagination."""
    query = "SELECT * FROM downloads"
    params = []
    if search:
        query += " WHERE title LIKE ? OR file_path LIKE ?"
        term = f"%{search}%"
        params.extend([term, term])
    query += " ORDER BY completed_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with get_db_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        result = []
        for r in rows:
            path_exists = os.path.exists(r["file_path"])
            result.append({
                "id": r["id"],
                "title": r["title"],
                "type": r["type"],
                "file_path": r["file_path"],
                "file_size": r["file_size"],
                "source_url": r["source_url"],
                "completed_at": r["completed_at"],
                "exists": path_exists,
            })
        return result


def delete_history_item(item_id: int, delete_file: bool = False) -> bool:
    """Remove a download record and optionally delete the file from disk."""
    with get_db_connection() as conn:
        row = conn.execute("SELECT file_path FROM downloads WHERE id = ?", (item_id,)).fetchone()
        if not row:
            return False

        file_path = row["file_path"]
        conn.execute("DELETE FROM downloads WHERE id = ?", (item_id,))
        conn.commit()

        if delete_file and os.path.exists(file_path):
            try:
                if os.path.isdir(file_path):
                    import shutil
                    shutil.rmtree(file_path)
                else:
                    os.remove(file_path)
            except Exception:
                pass
        return True


def clear_all_history() -> int:
    """Clear all records from the downloads history."""
    with get_db_connection() as conn:
        cursor = conn.execute("DELETE FROM downloads")
        conn.commit()
        return cursor.rowcount


# ─── Configuration Store ─────────────────────────────────────────────────────

DEFAULT_VIDEO_DIR = os.path.join(os.path.expanduser("~"), "Downloads")
DEFAULT_TORRENT_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "Torrents")


def get_config() -> dict:
    """Get active configuration with system defaults."""
    config = {
        "video_dir": DEFAULT_VIDEO_DIR,
        "torrent_dir": DEFAULT_TORRENT_DIR,
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                config.update(saved)
        except Exception:
            pass

    # Ensure directories exist
    os.makedirs(config["video_dir"], exist_ok=True)
    os.makedirs(config["torrent_dir"], exist_ok=True)
    return config


def save_config(video_dir: Optional[str] = None, torrent_dir: Optional[str] = None) -> dict:
    """Update and persist configuration."""
    current = get_config()
    if video_dir:
        v_path = os.path.expanduser(video_dir.strip())
        os.makedirs(v_path, exist_ok=True)
        current["video_dir"] = v_path

    if torrent_dir:
        t_path = os.path.expanduser(torrent_dir.strip())
        os.makedirs(t_path, exist_ok=True)
        current["torrent_dir"] = t_path

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)

    return current


# ─── Native OS File System Integration ───────────────────────────────────────

def open_file_path(target_path: str) -> bool:
    """Open a file or directory using the OS default application."""
    if not os.path.exists(target_path):
        return False

    system = platform.system()
    try:
        if system == "Linux":
            subprocess.Popen(["xdg-open", target_path])
        elif system == "Darwin":
            subprocess.Popen(["open", target_path])
        elif system == "Windows":
            os.startfile(target_path)
        return True
    except Exception:
        return False


def show_in_folder(target_path: str) -> bool:
    """Open the file manager highlighting or showing the specified file/directory."""
    if not os.path.exists(target_path):
        return False

    system = platform.system()
    try:
        if system == "Linux":
            # If path is a file, open its parent directory
            folder = os.path.dirname(target_path) if os.path.isfile(target_path) else target_path
            subprocess.Popen(["xdg-open", folder])
        elif system == "Darwin":
            subprocess.Popen(["open", "-R", target_path])
        elif system == "Windows":
            subprocess.Popen(["explorer.exe", f"/select,{os.path.normpath(target_path)}"])
        return True
    except Exception:
        return False
