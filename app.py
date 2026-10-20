#!/usr/bin/env python3
"""
DownloadHub — Unified FastAPI Web Application
Combines Video Downloader and Torrent Downloader into a single backend.
"""

import asyncio
import hashlib
import json
import os
import threading
import time
import uuid
from typing import Optional

import libtorrent as lt
import uvicorn
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

# Video downloader imports
from downloader import Downloader
import history
from utils import (
    format_bytes,
    format_duration,
    format_speed,
    format_eta,
    get_default_download_dir,
    get_platform_name,
)

# ─── Configuration & Directories ─────────────────────────────────────────────

def get_torrent_dir() -> str:
    return history.get_config()["torrent_dir"]

def get_video_dir() -> str:
    return history.get_config()["video_dir"]

DOWNLOAD_DIR = get_torrent_dir()

# ─── Libtorrent Session (Global, High-Performance) ──────────────────────────

_initial_cfg = history.get_config()
_init_dl_lim = _initial_cfg.get("download_limit_kb", 0) * 1024
_init_ul_lim = _initial_cfg.get("upload_limit_kb", 0) * 1024

settings = {
    "user_agent": "DownloadHub/1.0",
    "listen_interfaces": "0.0.0.0:6881,[::]:6881",
    "download_rate_limit": _init_dl_lim,
    "upload_rate_limit": _init_ul_lim,
    "connections_limit": 500,
    "active_downloads": 8,
    "active_seeds": 4,
    "active_limit": 16,
    "enable_dht": True,
    "enable_lsd": True,
    "enable_natpmp": True,
    "enable_upnp": True,
    "auto_manage_prefer_seeds": False,
    "announce_to_all_trackers": True,
    "announce_to_all_tiers": True,
    "dht_bootstrap_nodes": "router.utorrent.com:6881,router.bittorrent.com:6881,dht.transmissionbt.com:6881,router.bitcomet.com:6881",
}

ses = lt.session(settings)


# ─── Active Downloads & Metadata Cache Store (Torrent) ───────────────────────

active_downloads: dict[str, dict] = {}
# Format: {torrent_id: {"handle": lt.torrent_handle, "added_at": float, "magnet_link": str, "paused": bool}}

metadata_cache: dict[str, dict] = {}
# Format: {torrent_id: {"info": dict, "handle": lt.torrent_handle, "fetched_at": float}}

# ─── Active Downloads Store (Video) ─────────────────────────────────────────

# In-memory task store: task_id -> progress dict
_tasks: dict[str, dict] = {}
_tasks_lock = threading.Lock()
_cancelled: set[str] = set()   # task IDs that have been cancelled

# ─── FastAPI app ─────────────────────────────────────────────────────────────

app = FastAPI(title="DownloadHub", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

downloader = Downloader()

# Maximum completed tasks to keep in memory
_MAX_COMPLETED_TASKS = 100


def _cleanup_old_tasks():
    """Remove oldest completed tasks if we exceed the limit."""
    with _tasks_lock:
        completed = [
            tid for tid, t in _tasks.items()
            if t["status"] in ("complete", "error", "cancelled")
        ]
        if len(completed) > _MAX_COMPLETED_TASKS:
            for tid in completed[:len(completed) - _MAX_COMPLETED_TASKS]:
                _tasks.pop(tid, None)
                _cancelled.discard(tid)

# ─── Request Models ──────────────────────────────────────────────────────────

class VideoFetchRequest(BaseModel):
    url: str

class VideoDownloadRequest(BaseModel):
    url: str
    format_id: str = "best"

class MagnetRequest(BaseModel):
    magnet_link: str

class TorrentDownloadRequest(BaseModel):
    magnet_link: str
    selected_files: Optional[list[int]] = None  # indices of files to download


# ─── Utility Functions (Torrent) ─────────────────────────────────────────────

def generate_torrent_id(magnet_link: str) -> str:
    """
    Generate a short unique ID based on the magnet link's info_hash.
    Supports v1, v2, and hybrid torrents via info_hashes.get_best().
    """
    try:
        params = lt.parse_magnet_uri(magnet_link.strip())
        if hasattr(params, 'info_hashes'):
            best = params.info_hashes.get_best()
            if best:
                return str(best)
        elif hasattr(params, 'info_hash'):
            return str(params.info_hash)
    except Exception:
        pass
    return hashlib.sha256(magnet_link.strip().encode()).hexdigest()[:16]


def format_size(size_bytes: int) -> str:
    """Format bytes into a human-readable size string."""
    if size_bytes <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    size = float(size_bytes)
    while size >= 1024 and i < len(units) - 1:
        size /= 1024
        i += 1
    return f"{size:.2f} {units[i]}"


def format_time(seconds: int) -> str:
    """Format seconds into HH:MM:SS."""
    if seconds < 0 or seconds > 360000:
        return "∞"
    if seconds == 0:
        return "0s"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}h {m}m {s}s"
    elif m > 0:
        return f"{m}m {s}s"
    return f"{s}s"


def get_state_string(state: int) -> str:
    """Convert libtorrent state enum to human-readable string."""
    states = {
        0: "queued",
        1: "checking_files",
        2: "downloading_metadata",
        3: "downloading",
        4: "finished",
        5: "seeding",
        6: "allocating",
    }
    return states.get(state, "unknown")


def get_delete_files_flag():
    """Safe resolution of delete_files flag across libtorrent versions."""
    if hasattr(lt.session, 'delete_files'):
        return lt.session.delete_files
    if hasattr(lt, 'options_t') and hasattr(lt.options_t, 'delete_files'):
        return lt.options_t.delete_files
    return 1


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/")
async def index():
    """Serve the main HTML page."""
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

# =============================================================================
# Video Routes (/api/video/...)
# =============================================================================

@app.post("/api/video/fetch")
async def video_fetch(req: VideoFetchRequest):
    """Fetch video metadata without downloading."""
    url = req.url.strip()
    if not url:
        return JSONResponse({"error": "URL is required"}, status_code=400)

    try:
        info = await asyncio.to_thread(downloader.fetch_info, url)
    except Exception as exc:
        return JSONResponse({"error": str(exc).split("\n")[0][:200]}, status_code=400)

    return {
        "title": info.title,
        "thumbnail": info.thumbnail,
        "duration": info.duration,
        "duration_formatted": format_duration(info.duration),
        "uploader": info.uploader,
        "url": info.url,
        "platform": get_platform_name(url),
        "formats": info.formats,
    }


@app.post("/api/video/download")
async def video_download(req: VideoDownloadRequest):
    """Start a download in the background and return a task_id."""
    url = req.url.strip()
    format_id = req.format_id
    if not url:
        return JSONResponse({"error": "URL is required"}, status_code=400)

    task_id = str(uuid.uuid4())

    with _tasks_lock:
        _tasks[task_id] = {
            "status": "starting",
            "percent": 0,
            "speed": None,
            "eta": None,
            "downloaded": 0,
            "total": 0,
            "filename": None,
            "error": None,
        }

    thread = threading.Thread(
        target=_download_worker, args=(task_id, url, format_id), daemon=True
    )
    thread.start()

    return {"task_id": task_id}


@app.post("/api/video/cancel/{task_id}")
async def video_cancel(task_id: str):
    """Cancel a running download."""
    with _tasks_lock:
        _cancelled.add(task_id)
        task = _tasks.get(task_id)
        if task and task["status"] not in ("complete", "error", "cancelled"):
            task["status"] = "cancelled"
    return {"cancelled": True}


@app.get("/api/video/progress/{task_id}")
async def video_progress(task_id: str, request: Request):
    """SSE endpoint streaming download progress."""
    async def event_generator():
        last_sent = None
        while True:
            if await request.is_disconnected():
                break

            with _tasks_lock:
                task = _tasks.get(task_id)

            if task is None:
                yield {"event": "error", "data": json.dumps({"error": "Unknown task"})}
                break

            # Build payload
            payload = {
                "status": task["status"],
                "percent": round(task["percent"], 1),
                "speed": format_speed(task["speed"]) if task["speed"] else None,
                "eta": format_eta(task["eta"]) if task["eta"] else None,
                "downloaded": format_bytes(task["downloaded"]),
                "total": format_bytes(task["total"]) if task["total"] else None,
                "filename": task["filename"],
                "filepath": task.get("filepath"),
                "error": task["error"],
            }

            payload_str = json.dumps(payload)
            if payload_str != last_sent:
                yield {"event": "progress", "data": payload_str}
                last_sent = payload_str

            if task["status"] in ("complete", "error", "cancelled"):
                break

            await asyncio.sleep(0.3)

    return EventSourceResponse(event_generator())


# ── Download worker (runs in background thread) ──────────────────────────
def _download_worker(task_id: str, url: str, format_id: str):
    """Execute the download and update the task store."""
    def progress_hook(d: dict):
        with _tasks_lock:
            if task_id in _cancelled:
                raise Exception("Download cancelled by user")

        status = d.get("status")
        with _tasks_lock:
            task = _tasks.get(task_id)
            if not task:
                return
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes", 0)
                if total > 0:
                    pct = downloaded / total * 100
                else:
                    frag_idx = d.get("fragment_index")
                    frag_count = d.get("fragment_count")
                    if frag_idx and frag_count:
                        pct = frag_idx / frag_count * 100
                    else:
                        pct = 0
                task["status"] = "downloading"
                task["percent"] = min(pct, 99.9)
                task["speed"] = d.get("speed")
                task["eta"] = d.get("eta")
                task["downloaded"] = downloaded
                task["total"] = total
            elif status == "finished":
                task["status"] = "merging"
                task["percent"] = 100
                task["speed"] = None
                task["eta"] = None

    try:
        output_dir = get_video_dir()

        with _tasks_lock:
            if task_id in _tasks:
                _tasks[task_id]["status"] = "downloading"

        def status_callback(phase: str):
            with _tasks_lock:
                if task_id in _tasks:
                    _tasks[task_id]["status"] = phase
                    _tasks[task_id]["speed"] = None
                    _tasks[task_id]["eta"] = None

        path = downloader.download(
            url=url,
            output_dir=output_dir,
            format_id=format_id,
            progress_hook=progress_hook,
            status_callback=status_callback,
        )

        with _tasks_lock:
            if task_id in _tasks:
                _tasks[task_id]["status"] = "complete"
                _tasks[task_id]["percent"] = 100
                _tasks[task_id]["filename"] = os.path.basename(path) if path else None
                _tasks[task_id]["filepath"] = path

        if path and os.path.exists(path):
            file_size = os.path.getsize(path)
            history.add_history(
                title=os.path.basename(path),
                item_type="video",
                file_path=path,
                file_size=file_size,
                source_url=url,
            )

    except Exception as exc:
        with _tasks_lock:
            if task_id in _tasks:
                _tasks[task_id]["status"] = "error"
                _tasks[task_id]["error"] = str(exc).split("\n")[0][:200]

    _cleanup_old_tasks()


# =============================================================================
# Torrent Routes (/api/torrent/...)
# =============================================================================

def _build_torrent_info_dict(torrent_info, magnet_link: str, status) -> dict:
    """Helper to build consistent torrent info structure."""
    info = {
        "name": torrent_info.name(),
        "total_size": torrent_info.total_size(),
        "total_size_formatted": format_size(torrent_info.total_size()),
        "num_pieces": torrent_info.num_pieces(),
        "piece_length": torrent_info.piece_length(),
        "piece_length_formatted": format_size(torrent_info.piece_length()),
        "comment": torrent_info.comment(),
        "creator": torrent_info.creator(),
        "num_files": torrent_info.num_files(),
        "files": [],
        "info_hash": str(torrent_info.info_hash()),
        "magnet_link": magnet_link,
        "num_peers": status.num_peers,
        "num_seeds": status.num_seeds,
    }

    file_storage = torrent_info.files()
    for i in range(file_storage.num_files()):
        info["files"].append({
            "index": i,
            "path": file_storage.file_path(i),
            "size": file_storage.file_size(i),
            "size_formatted": format_size(file_storage.file_size(i)),
        })
    return info


@app.post("/api/torrent/fetch-info")
async def fetch_torrent_info(req: MagnetRequest, request: Request):
    """
    Resolve a magnet link and return torrent metadata.
    Reuses cached handles to avoid DHT metadata loss.
    """
    magnet_link = req.magnet_link.strip()

    if not magnet_link.startswith("magnet:"):
        raise HTTPException(status_code=400, detail="Invalid magnet link. Must start with 'magnet:'")

    torrent_id = generate_torrent_id(magnet_link)

    # Check active downloads first
    if torrent_id in active_downloads:
        handle = active_downloads[torrent_id]["handle"]
        if handle.is_valid() and handle.status().has_metadata:
            torrent_info = handle.torrent_file()
            return _build_torrent_info_dict(torrent_info, magnet_link, handle.status())

    # Check metadata cache
    if torrent_id in metadata_cache:
        cached = metadata_cache[torrent_id]
        if cached["handle"].is_valid() and cached["handle"].status().has_metadata:
            return cached["info"]

    try:
        # Check if already in session
        existing_handle = None
        for h in ses.get_torrents():
            if h.is_valid() and str(h.info_hash()) == torrent_id:
                existing_handle = h
                break

        if existing_handle:
            handle = existing_handle
        else:
            try:
                params = lt.parse_magnet_uri(magnet_link)
            except Exception as pe:
                raise HTTPException(status_code=400, detail=f"Malformed magnet URI: {str(pe)}")
            params.save_path = DOWNLOAD_DIR
            params.flags |= lt.torrent_flags.upload_mode
            handle = ses.add_torrent(params)
            handle.set_flags(lt.torrent_flags.upload_mode)

        # Wait for metadata
        timeout = 60
        start = time.time()
        while not handle.status().has_metadata:
            if await request.is_disconnected():
                if torrent_id not in active_downloads:
                    try:
                        ses.remove_torrent(handle)
                    except Exception:
                        pass
                raise HTTPException(status_code=499, detail="Client cancelled metadata fetch.")
            await asyncio.sleep(0.5)
            if time.time() - start > timeout:
                if torrent_id not in active_downloads:
                    try:
                        ses.remove_torrent(handle)
                    except Exception:
                        pass
                raise HTTPException(
                    status_code=408,
                    detail="Metadata fetch timed out. The torrent may have no active peers. Try again later."
                )

        torrent_info = handle.torrent_file()
        info = _build_torrent_info_dict(torrent_info, magnet_link, handle.status())

        # Cap metadata cache size
        if len(metadata_cache) >= 100:
            oldest_key = next(iter(metadata_cache))
            metadata_cache.pop(oldest_key, None)

        metadata_cache[torrent_id] = {
            "info": info,
            "handle": handle,
            "fetched_at": time.time(),
        }

        return info

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching torrent info: {str(e)}")


@app.post("/api/torrent/upload-file")
async def upload_torrent_file(file: UploadFile = File(...)):
    """Upload a .torrent file and return its metadata."""
    if not file.filename.lower().endswith(".torrent"):
        raise HTTPException(status_code=400, detail="Only .torrent files are supported.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".torrent", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        ti = lt.torrent_info(tmp_path)
    except Exception as exc:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise HTTPException(status_code=400, detail=f"Invalid .torrent file: {str(exc)}")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    torrent_id = str(ti.info_hash())
    magnet_link = lt.make_magnet_uri(ti)

    # Check active downloads first
    if torrent_id in active_downloads:
        handle = active_downloads[torrent_id]["handle"]
        if handle.is_valid():
            return _build_torrent_info_dict(ti, magnet_link, handle.status())

    # Check if already in session
    existing_handle = None
    for h in ses.get_torrents():
        if h.is_valid() and str(h.info_hash()) == torrent_id:
            existing_handle = h
            break

    if existing_handle:
        handle = existing_handle
    else:
        params = lt.add_torrent_params()
        params.ti = ti
        params.save_path = DOWNLOAD_DIR
        params.flags |= lt.torrent_flags.upload_mode
        handle = ses.add_torrent(params)
        handle.set_flags(lt.torrent_flags.upload_mode)

    info = _build_torrent_info_dict(ti, magnet_link, handle.status())

    if len(metadata_cache) >= 100:
        oldest_key = next(iter(metadata_cache))
        metadata_cache.pop(oldest_key, None)

    metadata_cache[torrent_id] = {
        "info": info,
        "handle": handle,
        "fetched_at": time.time(),
    }

    return info


@app.post("/api/torrent/download")
async def start_download(req: TorrentDownloadRequest):
    """Start downloading a torrent from a magnet link."""
    magnet_link = req.magnet_link.strip()

    if not magnet_link.startswith("magnet:"):
        raise HTTPException(status_code=400, detail="Invalid magnet link.")

    torrent_id = generate_torrent_id(magnet_link)

    if torrent_id in active_downloads:
        existing = active_downloads[torrent_id]
        if existing["handle"].is_valid():
            if existing["paused"]:
                existing["handle"].resume()
                existing["paused"] = False
            return {"torrent_id": torrent_id, "message": "Already downloading", "status": "existing"}

    try:
        handle = None

        if torrent_id in metadata_cache:
            cached_handle = metadata_cache[torrent_id]["handle"]
            if cached_handle.is_valid():
                handle = cached_handle
                handle.unset_flags(lt.torrent_flags.upload_mode)
                handle.resume()

        if not handle:
            for h in ses.get_torrents():
                if h.is_valid() and str(h.info_hash()) == torrent_id:
                    handle = h
                    handle.unset_flags(lt.torrent_flags.upload_mode)
                    handle.resume()
                    break

        if not handle:
            params = lt.parse_magnet_uri(magnet_link)
            params.save_path = DOWNLOAD_DIR
            handle = ses.add_torrent(params)

        if req.selected_files is not None:
            if not handle.status().has_metadata:
                timeout = 60
                start = time.time()
                while not handle.status().has_metadata:
                    await asyncio.sleep(0.5)
                    if time.time() - start > timeout:
                        break

            if handle.status().has_metadata:
                ti = handle.torrent_file()
                num_files = ti.files().num_files()
                priorities = [0] * num_files
                for idx in req.selected_files:
                    if 0 <= idx < num_files:
                        priorities[idx] = 4
                handle.prioritize_files(priorities)

        active_downloads[torrent_id] = {
            "handle": handle,
            "added_at": time.time(),
            "magnet_link": magnet_link,
            "paused": False,
        }

        return {"torrent_id": torrent_id, "message": "Download started", "status": "started"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error starting download: {str(e)}")


@app.get("/api/torrent/progress/{torrent_id}")
async def stream_progress(torrent_id: str, request: Request):
    """Stream download progress via Server-Sent Events."""

    if torrent_id not in active_downloads:
        raise HTTPException(status_code=404, detail="Torrent not found")

    async def event_generator():
        while True:
            if await request.is_disconnected():
                break

            if torrent_id not in active_downloads:
                yield {"event": "removed", "data": json.dumps({"message": "Torrent removed"})}
                break

            entry = active_downloads[torrent_id]
            handle = entry["handle"]

            if not handle.is_valid():
                yield {"event": "error", "data": json.dumps({"message": "Invalid torrent handle"})}
                break

            status = handle.status()
            state = get_state_string(status.state)

            eta = -1
            if status.download_rate > 0 and status.total_wanted > 0:
                remaining = status.total_wanted - status.total_wanted_done
                eta = int(remaining / status.download_rate)
            elif status.total_wanted > 0 and status.total_wanted_done == status.total_wanted:
                eta = 0

            progress_data = {
                "torrent_id": torrent_id,
                "name": status.name if status.name else "Fetching metadata...",
                "state": state,
                "progress": round(status.progress * 100, 2),
                "download_rate": status.download_rate,
                "download_rate_formatted": format_size(status.download_rate) + "/s",
                "upload_rate": status.upload_rate,
                "upload_rate_formatted": format_size(status.upload_rate) + "/s",
                "total_downloaded": status.total_wanted_done,
                "total_downloaded_formatted": format_size(status.total_wanted_done),
                "total_size": status.total_wanted,
                "total_size_formatted": format_size(status.total_wanted),
                "num_peers": status.num_peers,
                "num_seeds": status.num_seeds,
                "eta": eta,
                "eta_formatted": format_time(eta),
                "paused": entry["paused"],
            }

            yield {"event": "progress", "data": json.dumps(progress_data)}

            if state in ("finished", "seeding"):
                if not entry.get("history_recorded"):
                    entry["history_recorded"] = True
                    save_path = entry.get("save_path", get_torrent_dir())
                    name = status.name if status.name else "Torrent Download"
                    target = os.path.join(save_path, name)
                    history.add_history(
                        title=name,
                        item_type="torrent",
                        file_path=target,
                        file_size=status.total_wanted,
                        source_url=entry.get("magnet_link", ""),
                    )
                yield {"event": "complete", "data": json.dumps(progress_data)}
                break

            await asyncio.sleep(2.0 if entry["paused"] else 0.5)

    return EventSourceResponse(event_generator())


@app.get("/api/torrent/downloads")
async def list_downloads():
    """List all active/completed downloads."""
    downloads = []
    for tid, entry in list(active_downloads.items()):
        handle = entry["handle"]
        if not handle.is_valid():
            continue
        status = handle.status()
        state = get_state_string(status.state)
        downloads.append({
            "torrent_id": tid,
            "name": status.name if status.name else "Fetching metadata...",
            "state": state,
            "progress": round(status.progress * 100, 2),
            "download_rate_formatted": format_size(status.download_rate) + "/s",
            "upload_rate_formatted": format_size(status.upload_rate) + "/s",
            "total_size_formatted": format_size(status.total_wanted),
            "num_peers": status.num_peers,
            "paused": entry["paused"],
            "added_at": entry["added_at"],
        })
    return {"downloads": downloads}


@app.post("/api/torrent/download/{torrent_id}/pause")
async def pause_download(torrent_id: str):
    """Pause a download."""
    if torrent_id not in active_downloads:
        raise HTTPException(status_code=404, detail="Torrent not found")

    handle = active_downloads[torrent_id]["handle"]
    if handle.is_valid():
        handle.pause()
    active_downloads[torrent_id]["paused"] = True
    return {"message": "Download paused", "torrent_id": torrent_id}


@app.post("/api/torrent/download/{torrent_id}/resume")
async def resume_download(torrent_id: str):
    """Resume a paused download."""
    if torrent_id not in active_downloads:
        raise HTTPException(status_code=404, detail="Torrent not found")

    handle = active_downloads[torrent_id]["handle"]
    if handle.is_valid():
        handle.resume()
    active_downloads[torrent_id]["paused"] = False
    return {"message": "Download resumed", "torrent_id": torrent_id}


@app.delete("/api/torrent/download/{torrent_id}/cancel")
async def cancel_download(torrent_id: str):
    """Cancel and remove a download."""
    if torrent_id not in active_downloads:
        raise HTTPException(status_code=404, detail="Torrent not found")

    handle = active_downloads[torrent_id]["handle"]
    if handle.is_valid():
        delete_flag = get_delete_files_flag()
        try:
            ses.remove_torrent(handle, delete_flag)
        except Exception:
            try:
                ses.remove_torrent(handle)
            except Exception:
                pass

    del active_downloads[torrent_id]

    if torrent_id in metadata_cache:
        del metadata_cache[torrent_id]

    return {"message": "Download cancelled and files removed", "torrent_id": torrent_id}


@app.post("/api/torrent/downloads/pause-all")
async def pause_all_torrents():
    """Pause all active torrent downloads."""
    count = 0
    for tid, entry in active_downloads.items():
        handle = entry["handle"]
        if handle.is_valid():
            handle.pause()
            entry["paused"] = True
            count += 1
    return {"message": f"Paused {count} downloads", "count": count}


@app.post("/api/torrent/downloads/resume-all")
async def resume_all_torrents():
    """Resume all paused torrent downloads."""
    count = 0
    for tid, entry in active_downloads.items():
        handle = entry["handle"]
        if handle.is_valid():
            handle.resume()
            entry["paused"] = False
            count += 1
    return {"message": f"Resumed {count} downloads", "count": count}


@app.get("/api/torrent/system-status")
async def get_system_status():
    """Return overall session stats and storage space."""
    import shutil
    try:
        total, used, free = shutil.disk_usage(DOWNLOAD_DIR)
    except Exception:
        free = 0

    total_download_rate = 0
    total_upload_rate = 0
    downloading_count = 0
    seeding_count = 0
    paused_count = 0

    for tid, entry in list(active_downloads.items()):
        handle = entry["handle"]
        if not handle.is_valid():
            continue
        status = handle.status()
        total_download_rate += status.download_rate
        total_upload_rate += status.upload_rate

        state_str = get_state_string(status.state)
        if entry["paused"]:
            paused_count += 1
        elif state_str in ("finished", "seeding"):
            seeding_count += 1
        else:
            downloading_count += 1

    return {
        "download_dir": DOWNLOAD_DIR,
        "free_space": free,
        "disk_free_gb": round(free / (1024 ** 3), 2),
        "free_space_formatted": format_size(free),
        "total_download_rate": total_download_rate,
        "download_rate_formatted": format_size(total_download_rate) + "/s",
        "total_download_rate_formatted": format_size(total_download_rate) + "/s",
        "active_count": len(active_downloads),
        "downloading_count": downloading_count,
        "seeding_count": seeding_count,
        "paused_count": paused_count,
    }


@app.get("/api/torrent/download/{torrent_id}/details")
async def get_torrent_details(torrent_id: str):
    """Return detailed per-file status for an active torrent."""
    if torrent_id not in active_downloads:
        raise HTTPException(status_code=404, detail="Torrent not found")

    handle = active_downloads[torrent_id]["handle"]
    if not handle.is_valid():
        raise HTTPException(status_code=400, detail="Torrent handle is invalid")

    status = handle.status()
    file_progress = []

    if status.has_metadata:
        torrent_info = handle.torrent_file()
        file_storage = torrent_info.files()
        fp = handle.file_progress()
        priorities = handle.file_priorities()

        for i in range(file_storage.num_files()):
            f_size = file_storage.file_size(i)
            done = fp[i] if i < len(fp) else 0
            pct = round((done / f_size * 100), 1) if f_size > 0 else 100.0
            prio = priorities[i] if i < len(priorities) else 4

            file_progress.append({
                "index": i,
                "path": file_storage.file_path(i),
                "name": file_storage.file_path(i).split("/")[-1],
                "size": f_size,
                "size_formatted": format_size(f_size),
                "downloaded": done,
                "downloaded_formatted": format_size(done),
                "progress": pct,
                "priority": prio,
                "skipped": prio == 0
            })

    return {
        "torrent_id": torrent_id,
        "name": status.name if status.name else "Fetching metadata...",
        "files": file_progress
    }


# ─── Bandwidth Limits & Peer/Tracker Telemetry Endpoints ─────────────────────

class SpeedLimitRequest(BaseModel):
    download_limit_kb: int = 0
    upload_limit_kb: int = 0


class FilePriorityRequest(BaseModel):
    file_index: int
    priority: int


@app.get("/api/torrent/settings/speed-limits")
async def get_speed_limits():
    """Get current session speed limits in KB/s."""
    cfg = history.get_config()
    return {
        "download_limit_kb": cfg.get("download_limit_kb", 0),
        "upload_limit_kb": cfg.get("upload_limit_kb", 0),
    }


@app.post("/api/torrent/settings/speed-limits")
async def set_speed_limits(req: SpeedLimitRequest):
    """Set global session speed limits (KB/s, 0 = unlimited)."""
    dl_bytes = max(0, int(req.download_limit_kb)) * 1024
    ul_bytes = max(0, int(req.upload_limit_kb)) * 1024
    ses.apply_settings({
        "download_rate_limit": dl_bytes,
        "upload_rate_limit": ul_bytes,
    })
    updated = history.save_config(
        download_limit_kb=req.download_limit_kb,
        upload_limit_kb=req.upload_limit_kb,
    )
    return {
        "success": True,
        "download_limit_kb": updated.get("download_limit_kb", 0),
        "upload_limit_kb": updated.get("upload_limit_kb", 0),
    }


@app.post("/api/torrent/download/{torrent_id}/file-priority")
async def set_file_priority(torrent_id: str, req: FilePriorityRequest):
    """Set download priority for an individual file (0=skip, 1-7=priority)."""
    if torrent_id not in active_downloads:
        raise HTTPException(status_code=404, detail="Torrent not found")

    handle = active_downloads[torrent_id]["handle"]
    if not handle.is_valid():
        raise HTTPException(status_code=400, detail="Invalid torrent handle")

    try:
        handle.file_priority(int(req.file_index), int(req.priority))
        return {"success": True, "file_index": req.file_index, "priority": req.priority}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/torrent/download/{torrent_id}/peers")
async def get_torrent_peers(torrent_id: str):
    """Retrieve connected peer list for an active torrent."""
    if torrent_id not in active_downloads:
        raise HTTPException(status_code=404, detail="Torrent not found")

    handle = active_downloads[torrent_id]["handle"]
    if not handle.is_valid():
        return {"peers": [], "total": 0}

    try:
        peer_list = handle.get_peer_info()
    except Exception as exc:
        return {"peers": [], "total": 0, "error": str(exc)}

    peers_data = []
    for p in peer_list:
        try:
            client_name = p.client.decode("utf-8", errors="ignore") if isinstance(p.client, bytes) else str(p.client)
            if not client_name:
                client_name = "Peer"
            ip_str = f"{p.ip[0]}:{p.ip[1]}" if isinstance(p.ip, (tuple, list)) else str(p.ip)
            peers_data.append({
                "ip": ip_str,
                "client": client_name,
                "down_speed": p.down_speed,
                "down_speed_formatted": format_size(p.down_speed) + "/s",
                "up_speed": p.up_speed,
                "up_speed_formatted": format_size(p.up_speed) + "/s",
                "progress": round(p.progress * 100, 1),
            })
        except Exception:
            continue

    return {"peers": peers_data, "total": len(peers_data)}


@app.get("/api/torrent/download/{torrent_id}/trackers")
async def get_torrent_trackers(torrent_id: str):
    """Retrieve tracker list and statuses for an active torrent."""
    if torrent_id not in active_downloads:
        raise HTTPException(status_code=404, detail="Torrent not found")

    handle = active_downloads[torrent_id]["handle"]
    if not handle.is_valid():
        return {"trackers": [], "total": 0}

    try:
        trackers_list = handle.trackers()
    except Exception as exc:
        return {"trackers": [], "total": 0, "error": str(exc)}

    trackers_data = []
    for t in trackers_list:
        try:
            trackers_data.append({
                "url": t.url,
                "tier": t.tier,
                "verified": getattr(t, "verified", False),
            })
        except Exception:
            continue

    return {"trackers": trackers_data, "total": len(trackers_data)}


# ─── System, History & Configuration Endpoints ──────────────────────────────

class PathRequest(BaseModel):
    file_path: str


class ConfigUpdateRequest(BaseModel):
    video_dir: Optional[str] = None
    torrent_dir: Optional[str] = None


@app.get("/api/history")
async def api_get_history(limit: int = 50, offset: int = 0, search: str = ""):
    """Return persistent download history."""
    items = history.get_history(limit=limit, offset=offset, search=search)
    return {"history": items}


@app.delete("/api/history/{item_id}")
async def api_delete_history(item_id: int, delete_file: bool = False):
    """Delete a history record and optionally delete the file on disk."""
    success = history.delete_history_item(item_id, delete_file=delete_file)
    if not success:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"success": True}


@app.delete("/api/history")
async def api_clear_history():
    """Clear all history items."""
    count = history.clear_all_history()
    return {"cleared": count}


@app.post("/api/system/open-file")
async def api_open_file(req: PathRequest):
    """Open a file with the system default application."""
    if not os.path.exists(req.file_path):
        raise HTTPException(status_code=404, detail="File does not exist on disk.")
    success = history.open_file_path(req.file_path)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to open file on host system.")
    return {"success": True}


@app.post("/api/system/show-in-folder")
async def api_show_in_folder(req: PathRequest):
    """Reveal file in the system file manager."""
    if not os.path.exists(req.file_path):
        raise HTTPException(status_code=404, detail="File or folder does not exist on disk.")
    success = history.show_in_folder(req.file_path)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to open file manager.")
    return {"success": True}


@app.get("/api/system/config")
async def api_get_config():
    """Return active directories and configuration."""
    return history.get_config()


@app.post("/api/system/config")
async def api_update_config(req: ConfigUpdateRequest):
    """Update active download directories."""
    updated = history.save_config(video_dir=req.video_dir, torrent_dir=req.torrent_dir)
    return updated


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🚀 DownloadHub starting on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)



