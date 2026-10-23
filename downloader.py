"""
Core download engine wrapping yt-dlp.
Supports 1800+ video streaming platforms.
"""

import shutil
import subprocess
import yt_dlp
import os
from typing import Union
from utils import sanitize_filename, get_default_download_dir, format_duration


def _has_ffmpeg() -> bool:
    """Check whether FFmpeg is available on the system PATH."""
    return shutil.which("ffmpeg") is not None


class VideoInfo:
    """Holds metadata for a fetched video."""

    def __init__(self, info_dict: dict):
        self.title = info_dict.get("title", "Unknown Title")
        self.thumbnail = info_dict.get("thumbnail")
        self.duration = info_dict.get("duration")
        self.uploader = info_dict.get("uploader", "Unknown")
        self.url = info_dict.get("webpage_url", info_dict.get("url", ""))
        self.extractor = info_dict.get("extractor_key", "Generic")
        self.view_count = info_dict.get("view_count")
        self.description = info_dict.get("description", "")
        self.formats = self._parse_formats(info_dict)
        self.subtitles = self._parse_subtitles(info_dict)

    @staticmethod
    def _parse_subtitles(info_dict: dict) -> list[dict]:
        """Extract available subtitles and auto-captions."""
        subs = []
        seen = set()

        # Manual subtitles
        manual = info_dict.get("subtitles") or {}
        for lang, formats in manual.items():
            name = lang
            if formats and isinstance(formats, list) and len(formats) > 0:
                name = formats[0].get("name") or lang
            label = f"{name} ({lang})" if name != lang else lang.upper()
            subs.append({
                "lang": lang,
                "name": name,
                "auto": False,
                "label": label,
            })
            seen.add(lang)

        # Automatic captions
        auto = info_dict.get("automatic_captions") or {}
        for lang, formats in auto.items():
            if lang not in seen:
                name = lang
                if formats and isinstance(formats, list) and len(formats) > 0:
                    name = formats[0].get("name") or lang
                label = f"{name} ({lang}) [Auto]" if name != lang else f"{lang.upper()} [Auto]"
                subs.append({
                    "lang": lang,
                    "name": name,
                    "auto": True,
                    "label": label,
                })
                seen.add(lang)

        return subs

    @staticmethod
    def _parse_formats(info_dict: dict) -> list[dict]:
        """Parse available formats into a clean list for the UI.

        Uses vcodec^=avc1 (H.264) and acodec^=mp4a (AAC) filters to
        ensure the downloaded streams are natively compatible with mp4
        containers and every media player.
        """
        formats = info_dict.get("formats", [])
        if not formats:
            return [{"format_id": "best", "label": "Best Quality", "note": "Auto"}]

        # H.264 video + AAC audio = universally playable mp4.
        # Fallback chain: H.264+AAC -> any mp4+m4a -> pre-merged mp4 -> best
        parsed = [
            {
                "format_id": (
                    "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/"
                    "best[ext=mp4]/best"
                ),
                "label": "🎬 Best Quality (Video + Audio)",
                "note": "Recommended",
                "category": "video",
            },
            {
                "format_id": (
                    "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=1080][ext=mp4]/best[height<=1080]"
                ),
                "label": "📺 1080p (Full HD)",
                "note": "1080p",
                "category": "video",
            },
            {
                "format_id": (
                    "bestvideo[height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=720][ext=mp4]/best[height<=720]"
                ),
                "label": "📺 720p (HD)",
                "note": "720p",
                "category": "video",
            },
            {
                "format_id": (
                    "bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=480][ext=mp4]/best[height<=480]"
                ),
                "label": "📺 480p (SD)",
                "note": "480p",
                "category": "video",
            },
            {
                "format_id": (
                    "bestvideo[height<=360][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=360][ext=mp4]/best[height<=360]"
                ),
                "label": "📺 360p (Low)",
                "note": "360p",
                "category": "video",
            },
            {
                "format_id": "audio-mp3-320",
                "label": "🎵 MP3 Audio (320 kbps High Quality)",
                "note": "MP3",
                "category": "audio",
            },
            {
                "format_id": "audio-m4a",
                "label": "🎵 M4A Audio (AAC Standard)",
                "note": "M4A",
                "category": "audio",
            },
            {
                "format_id": "audio-flac",
                "label": "🎵 FLAC Audio (Lossless)",
                "note": "FLAC",
                "category": "audio",
            },
            {
                "format_id": "audio-wav",
                "label": "🎵 WAV Audio (Uncompressed Studio)",
                "note": "WAV",
                "category": "audio",
            },
            {
                "format_id": "bestaudio[acodec^=mp4a]/bestaudio[ext=m4a]/bestaudio/best",
                "label": "🎵 Audio Only (Fastest)",
                "note": "Audio",
                "category": "audio",
            },
        ]

        return parsed


class PlaylistInfo:
    """Holds metadata and video entries for a fetched playlist or channel."""

    def __init__(self, info_dict: dict):
        self.id = info_dict.get("id", "")
        self.title = info_dict.get("title", "Unknown Playlist")
        self.uploader = (
            info_dict.get("uploader")
            or info_dict.get("channel")
            or info_dict.get("uploader_id")
            or "Unknown"
        )
        self.extractor = info_dict.get("extractor_key", "Generic")
        self.webpage_url = info_dict.get("webpage_url", info_dict.get("url", ""))
        self.description = info_dict.get("description", "")
        self.thumbnail = info_dict.get("thumbnail")

        raw_entries = info_dict.get("entries") or []
        self.entries = []
        total_seconds = 0

        for idx, entry in enumerate(raw_entries):
            if not entry:
                continue

            entry_url = entry.get("url") or entry.get("webpage_url") or ""
            video_id = entry.get("id", str(idx + 1))
            if not entry_url or not entry_url.startswith("http"):
                if entry.get("ie_key") == "Youtube" or len(str(video_id)) == 11:
                    entry_url = f"https://www.youtube.com/watch?v={video_id}"
                else:
                    entry_url = entry.get("url") or ""

            thumb = entry.get("thumbnail")
            if not thumb and entry.get("thumbnails"):
                thumbs = entry.get("thumbnails")
                if isinstance(thumbs, list) and len(thumbs) > 0:
                    thumb = thumbs[-1].get("url")

            dur = entry.get("duration")
            if dur and isinstance(dur, (int, float)):
                total_seconds += int(dur)

            self.entries.append({
                "index": idx,
                "id": str(video_id),
                "title": entry.get("title") or f"Video #{idx + 1}",
                "duration": dur,
                "duration_formatted": format_duration(dur) if dur else "--:--",
                "uploader": entry.get("uploader") or entry.get("channel") or self.uploader,
                "url": entry_url,
                "thumbnail": thumb,
            })

        self.total_count = len(self.entries)
        self.total_duration_seconds = total_seconds
        self.total_duration_formatted = format_duration(total_seconds) if total_seconds > 0 else "N/A"
        if not self.thumbnail and self.entries and self.entries[0].get("thumbnail"):
            self.thumbnail = self.entries[0]["thumbnail"]
        self.formats = VideoInfo._parse_formats(info_dict)


class Downloader:
    """High-level download interface around yt-dlp."""

    def __init__(self):
        self.ffmpeg_available = _has_ffmpeg()

    @staticmethod
    def is_playlist_url(url: str) -> bool:
        """Check whether the given URL indicates a playlist or channel."""
        u = url.lower().strip()
        return any(k in u for k in ("/playlist", "list=", "/channel/", "/c/", "/@"))

    def fetch_playlist(self, url: str) -> PlaylistInfo:
        """
        Extract playlist metadata and video entries in flat mode (< 1-2 sec) without downloading media.
        """
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": "in_playlist",
            "no_color": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return PlaylistInfo(info)

    def fetch_info(self, url: str) -> VideoInfo:
        """
        Fetch video metadata without downloading.
        Raises yt_dlp.utils.DownloadError on failure.
        """
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "no_color": True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return VideoInfo(info)
        except Exception:
            raise

    def fetch_any(self, url: str) -> tuple[bool, Union[PlaylistInfo, VideoInfo]]:
        """
        Extract either playlist or single video metadata.
        Returns (is_playlist: bool, info_object).
        """
        # If explicitly formatted as playlist, try fast flat extraction first
        if self.is_playlist_url(url):
            try:
                pl = self.fetch_playlist(url)
                if pl.total_count > 0:
                    return True, pl
            except Exception:
                pass  # Fallback to single video extraction

        # Try flat check first
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": "in_playlist",
            "no_color": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            raw_info = ydl.extract_info(url, download=False)

            if raw_info and (raw_info.get("_type") == "playlist" or raw_info.get("entries")):
                return True, PlaylistInfo(raw_info)
            else:
                parsed = VideoInfo(raw_info)
                if not parsed.formats:
                    # Flat extraction omitted formats; re-fetch with full formats
                    return False, self.fetch_info(url)
                return False, parsed

    def download(
        self,
        url: str,
        output_dir: str = None,
        format_id: str = "best",
        progress_hook=None,
        filename: str = None,
        status_callback=None,
        subtitles_lang: str = None,
        embed_subtitles: bool = False,
    ) -> str:
        """
        Download a video.

        Args:
            url:             Video URL.
            output_dir:      Destination folder (defaults to ~/Downloads).
            format_id:       yt-dlp format selector string or custom audio key.
            progress_hook:   Callable receiving a dict with download progress.
            filename:        Optional custom output filename (without extension).
            status_callback: Optional callable(status_str) for phase updates.
            subtitles_lang:  Optional subtitle language code (e.g. 'en').
            embed_subtitles: Whether to embed subtitles directly into video.

        Returns:
            Path to the downloaded file.
        """
        if output_dir is None:
            output_dir = get_default_download_dir()

        os.makedirs(output_dir, exist_ok=True)

        if filename:
            outtmpl = os.path.join(output_dir, f"{sanitize_filename(filename)}.%(ext)s")
        else:
            outtmpl = os.path.join(output_dir, "%(title)s.%(ext)s")

        is_audio_only = (
            format_id.startswith("audio-")
            or "audio" in format_id.lower()
            or format_id.startswith("bestaudio")
        )

        # Map custom audio keys to yt-dlp format and codec
        audio_codec = "mp3"
        audio_quality = "320"
        actual_format = format_id

        if format_id == "1080p":
            actual_format = "bestvideo[height<=?1080]+bestaudio/best[height<=?1080]/best"
        elif format_id == "720p":
            actual_format = "bestvideo[height<=?720]+bestaudio/best[height<=?720]/best"
        elif format_id == "480p":
            actual_format = "bestvideo[height<=?480]+bestaudio/best[height<=?480]/best"
        elif format_id == "360p":
            actual_format = "bestvideo[height<=?360]+bestaudio/best[height<=?360]/best"
        elif format_id == "best":
            actual_format = "bestvideo+bestaudio/best"
        elif format_id == "audio-mp3-320":
            actual_format = "bestaudio/best"
            audio_codec = "mp3"
            audio_quality = "320"
        elif format_id == "audio-m4a":
            actual_format = "bestaudio[acodec^=mp4a]/bestaudio[ext=m4a]/bestaudio/best"
            audio_codec = "m4a"
            audio_quality = None
        elif format_id == "audio-flac":
            actual_format = "bestaudio/best"
            audio_codec = "flac"
            audio_quality = None
        elif format_id == "audio-wav":
            actual_format = "bestaudio/best"
            audio_codec = "wav"
            audio_quality = None
        elif format_id == "audio-best":
            actual_format = "bestaudio[acodec^=mp4a]/bestaudio[ext=m4a]/bestaudio/best"
            audio_codec = "mp3"
            audio_quality = "320"

        ydl_opts = {
            "format": actual_format,
            "outtmpl": outtmpl,
            "quiet": True,
            "no_warnings": True,
            "no_color": True,
            "restrictfilenames": False,
        }

        # Subtitles configuration
        if subtitles_lang:
            ydl_opts["writesubtitles"] = True
            ydl_opts["writeautomaticsub"] = True
            ydl_opts["subtitleslangs"] = [subtitles_lang]
            ydl_opts["subtitlesformat"] = "srt/vtt/best"

        if self.ffmpeg_available:
            postprocessors = []

            if is_audio_only:
                extract_audio_opts = {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": audio_codec,
                }
                if audio_quality:
                    extract_audio_opts["preferredquality"] = audio_quality
                postprocessors.append(extract_audio_opts)
                postprocessors.append({"key": "FFmpegMetadata"})
            else:
                ydl_opts["merge_output_format"] = "mp4"
                ydl_opts["keepvideo"] = False

                # Handle subtitles
                if subtitles_lang:
                    postprocessors.append({
                        "key": "FFmpegSubtitlesConvertor",
                        "format": "srt",
                    })
                    if embed_subtitles:
                        postprocessors.append({"key": "FFmpegEmbedSubtitle"})

                postprocessors.append({"key": "FFmpegMetadata"})

            ydl_opts["postprocessors"] = postprocessors

        if progress_hook:
            ydl_opts["progress_hooks"] = [progress_hook]

        final_path = None

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

                if info:
                    raw_path = ydl.prepare_filename(info)
                    base_path = os.path.splitext(raw_path)[0]

                    candidates = [
                        base_path + f".{audio_codec}",
                        base_path + ".mp3",
                        base_path + ".m4a",
                        base_path + ".flac",
                        base_path + ".wav",
                        base_path + ".mp4",
                        raw_path,
                    ]

                    for cand in candidates:
                        if os.path.isfile(cand):
                            final_path = cand
                            break
        except Exception:
            raise

        # Only re-encode video downloads if necessary (skip audio-only)
        if final_path and self.ffmpeg_available and not is_audio_only:
            if status_callback:
                status_callback("re-encoding")
            final_path = self._ensure_h264(final_path)

        return final_path or output_dir

    def _ensure_h264(self, filepath: str) -> str:
        """Re-encode video to H.264+AAC if it isn't already.

        Checks the file's codecs with ffprobe.  If the video stream is
        not H.264 or the audio stream is not AAC, re-encodes to a
        universally playable mp4.
        """
        try:
            probe = subprocess.run(
                [
                    "ffprobe", "-v", "error",
                    "-select_streams", "v:0",
                    "-show_entries", "stream=codec_name",
                    "-of", "csv=p=0",
                    filepath,
                ],
                capture_output=True, text=True, timeout=15,
            )
            vcodec = probe.stdout.strip()

            probe_a = subprocess.run(
                [
                    "ffprobe", "-v", "error",
                    "-select_streams", "a:0",
                    "-show_entries", "stream=codec_name",
                    "-of", "csv=p=0",
                    filepath,
                ],
                capture_output=True, text=True, timeout=15,
            )
            acodec = probe_a.stdout.strip()

            if vcodec == "h264" and acodec == "aac":
                return filepath

            # Re-encode to a temp file, then replace original
            base, ext = os.path.splitext(filepath)
            tmp_path = base + "_converted.mp4"

            cmd = [
                "ffmpeg", "-y", "-i", filepath,
                "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart",
                tmp_path,
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=600)

            if os.path.isfile(tmp_path) and os.path.getsize(tmp_path) > 0:
                os.replace(tmp_path, filepath)
                if not filepath.endswith(".mp4"):
                    mp4_path = base + ".mp4"
                    os.rename(filepath, mp4_path)
                    return mp4_path
            return filepath

        except Exception:
            return filepath  # on any error, return original file

