"""
Core download engine wrapping yt-dlp.
Supports 1800+ video streaming platforms.
"""

import shutil
import subprocess
import yt_dlp
import os
from utils import sanitize_filename, get_default_download_dir


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
            },
            {
                "format_id": (
                    "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=1080][ext=mp4]/best[height<=1080]"
                ),
                "label": "📺 1080p (Full HD)",
                "note": "1080p",
            },
            {
                "format_id": (
                    "bestvideo[height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=720][ext=mp4]/best[height<=720]"
                ),
                "label": "📺 720p (HD)",
                "note": "720p",
            },
            {
                "format_id": (
                    "bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=480][ext=mp4]/best[height<=480]"
                ),
                "label": "📺 480p (SD)",
                "note": "480p",
            },
            {
                "format_id": (
                    "bestvideo[height<=360][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
                    "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=360][ext=mp4]/best[height<=360]"
                ),
                "label": "📺 360p (Low)",
                "note": "360p",
            },
            {
                "format_id": "bestaudio[acodec^=mp4a]/bestaudio[ext=m4a]/bestaudio/best",
                "label": "🎵 Audio Only (Best)",
                "note": "Audio",
            },
        ]

        return parsed


class Downloader:
    """High-level download interface around yt-dlp."""

    def __init__(self):
        self.ffmpeg_available = _has_ffmpeg()

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

    def download(
        self,
        url: str,
        output_dir: str = None,
        format_id: str = "best",
        progress_hook=None,
        filename: str = None,
        status_callback=None,
    ) -> str:
        """
        Download a video.

        Args:
            url:            Video URL.
            output_dir:     Destination folder (defaults to ~/Downloads).
            format_id:      yt-dlp format selector string.
            progress_hook:  Callable receiving a dict with download progress.
            filename:       Optional custom output filename (without extension).
            status_callback: Optional callable(status_str) for phase updates.

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


        ydl_opts = {
            "format": format_id,
            "outtmpl": outtmpl,
            "quiet": True,
            "no_warnings": True,
            "no_color": True,
            "restrictfilenames": False,
        }

        is_audio_only = 'audio' in format_id.lower() or format_id.startswith('bestaudio')

        if self.ffmpeg_available:
            if is_audio_only:
                ydl_opts["postprocessors"] = [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "320",
                    },
                    {"key": "FFmpegMetadata"},
                ]
            else:
                ydl_opts["merge_output_format"] = "mp4"
                ydl_opts["keepvideo"] = False
                ydl_opts["postprocessors"] = [
                    {"key": "FFmpegMetadata"},
                ]

        if progress_hook:
            ydl_opts["progress_hooks"] = [progress_hook]

        final_path = None

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

                if info:
                    raw_path = ydl.prepare_filename(info)
                    base_path = os.path.splitext(raw_path)[0]
                    mp3_path = base_path + ".mp3"
                    m4a_path = base_path + ".m4a"
                    mp4_path = base_path + ".mp4"

                    if is_audio_only and os.path.isfile(mp3_path):
                        final_path = mp3_path
                    elif is_audio_only and os.path.isfile(m4a_path):
                        final_path = m4a_path
                    elif os.path.isfile(mp4_path):
                        final_path = mp4_path
                    elif os.path.isfile(raw_path):
                        final_path = raw_path
        except Exception:
            raise

        # Only re-encode video downloads (skip audio-only)
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

