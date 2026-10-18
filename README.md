# 🚀 DownloadHub

> A modern, unified web downloader combining high-speed video extraction (`yt-dlp`) and a full-featured torrent client (`libtorrent`) with real-time SSE progress updates.

---

## ✨ Features

### 🎬 Video Downloader
- **1,800+ Platforms**: Powered by `yt-dlp` (YouTube, Vimeo, Twitter/X, Instagram, TikTok, Reddit, and more).
- **Format & Quality Selection**: Choose resolutions (4K, 1080p, 720p, 480p) or extract audio directly (MP3/M4A).
- **Metadata Preview**: Automatically extracts title, thumbnail, duration, uploader, and available formats before downloading.
- **Smart Re-encoding**: Integrates with `ffmpeg` to ensure maximum compatibility.
- **Real-Time Progress**: Live SSE (Server-Sent Events) stream displaying percentage, download speed, downloaded size, and ETA.

### ⚡ Torrent Downloader
- **High-Performance Engine**: Powered by `libtorrent` (v2.x) with DHT, PeX, LSD, and UPnP/NAT-PMP enabled.
- **Magnet Link & File Support**: Instant metadata inspection and downloading from magnet links or `.torrent` files.
- **Selective File Downloads**: Browse the internal torrent directory tree and select only the specific files you want.
- **Transfer Controls**: Pause, resume, and cancel active downloads with live speed and peer monitoring.

### 🎨 Clean Modern UI
- **Dark Glassmorphism Interface**: Sleek, responsive web frontend with tabs for video and torrent management.
- **Live System Stats**: Real-time disk space status, active transfer counts, and aggregated bandwidth monitoring.
- **Zero Heavy Frontend Frameworks**: Lightweight Vanilla HTML5/CSS/JavaScript with zero bundle bloat.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.10+, FastAPI, Uvicorn, SSE-Starlette
- **Engines**: `yt-dlp`, `libtorrent`, `ffmpeg`
- **Frontend**: Vanilla JavaScript (ES6+), Modern CSS (Dark Theme, Flexbox/Grid)

---

## 📋 Prerequisites

- **Python 3.10+**
- **FFmpeg** (strongly recommended for merging video/audio streams):
  ```bash
  # Debian / Ubuntu
  sudo apt install ffmpeg

  # macOS
  brew install ffmpeg

  # Arch Linux
  sudo pacman -S ffmpeg
  ```

---

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/Mvsuthar/DownloadHub.git
cd DownloadHub
```

### 2. Create and activate a virtual environment
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Launch the application
```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

Open your browser at **`http://localhost:8000`** to start downloading!

---

## 📂 Project Structure

```
DownloadHub/
├── app.py             # Unified FastAPI backend & SSE event streaming
├── downloader.py      # yt-dlp wrapper and format extraction
├── utils.py           # Formatting utilities and cross-platform helpers
├── requirements.txt   # Python project dependencies
├── static/
│   ├── index.html     # Single-page web dashboard
│   ├── styles.css     # Modern dark glassmorphic styling
│   └── app.js         # Frontend controller & SSE event listeners
├── .gitignore         # Git ignore rules for virtual environments & media
└── README.md          # Project documentation
```

---

## ⚙️ Configuration

Downloads are saved to your user directory by default:
- **Videos**: `~/Downloads`
- **Torrents**: `~/Downloads/Torrents`

You can customize download directories, rate limits, and connection limits in [app.py](file:///home/mihir/Desktop/Playground/Tool/app.py).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
