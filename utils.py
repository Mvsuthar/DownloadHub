"""
Utility helpers for the Video Downloader application.
"""

import os
import re
import math


def format_bytes(size_bytes: float) -> str:
    """Convert bytes to a human-readable string (e.g. '12.5 MB')."""
    if size_bytes is None or size_bytes <= 0:
        return "0 B"
    units = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size_bytes, 1024)))
    i = min(i, len(units) - 1)
    value = size_bytes / (1024 ** i)
    return f"{value:.1f} {units[i]}"


def format_duration(seconds) -> str:
    """Convert seconds to HH:MM:SS or MM:SS string."""
    if seconds is None:
        return "Unknown"
    seconds = int(seconds)
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def format_speed(bytes_per_second) -> str:
    """Convert download speed to a human-readable string."""
    if bytes_per_second is None:
        return "-- B/s"
    return f"{format_bytes(bytes_per_second)}/s"


def format_eta(seconds) -> str:
    """Format estimated time of arrival."""
    if seconds is None:
        return "--:--"
    return format_duration(seconds)


def sanitize_filename(name: str) -> str:
    """Remove characters that are illegal in file paths."""
    if not name: 
        return "video"
    # Remove characters not allowed in most file systems
    sanitized = re.sub(r'[<>:"/\\|?*]', '', name)
    # Collapse whitespace
    sanitized = re.sub(r'\s+', ' ', sanitized).strip()
    # Limit length
    if len(sanitized) > 200:
        sanitized = sanitized[:200]
    return sanitized or "video"


def get_default_download_dir() -> str:
    """Return the user's default Downloads directory."""
    downloads = os.path.join(os.path.expanduser("~"), "Downloads")
    if os.path.isdir(downloads):
        return downloads
    return os.path.expanduser("~")


def get_platform_name(url: str) -> str:
    """Extract a friendly platform name from a URL."""
    platform_map = {
        "youtube.com": "YouTube",
        "youtu.be": "YouTube",
        "vimeo.com": "Vimeo",
        "dailymotion.com": "Dailymotion",
        "twitter.com": "Twitter / X",
        "x.com": "Twitter / X",
        "instagram.com": "Instagram",
        "reddit.com": "Reddit",
        "tiktok.com": "TikTok",
        "twitch.tv": "Twitch",
        "facebook.com": "Facebook",
        "fb.watch": "Facebook",
        "soundcloud.com": "SoundCloud",
        "bilibili.com": "Bilibili",
    }
    url_lower = url.lower()
    for domain, name in platform_map.items():
        if domain in url_lower:
            return name
    return "Video Platform"
