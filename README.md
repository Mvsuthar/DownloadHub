# 🚀 DownloadHub

> A modern, unified desktop web downloader combining high-speed video extraction (`yt-dlp`) and a full-featured torrent client (`libtorrent`) with real-time SSE progress updates, sequential in-browser streaming, batch playlist downloads, and bandwidth throttling.

---

## ✨ Features

### 🎬 Video & Batch Downloader
- **1,800+ Platforms**: Powered by `yt-dlp` (YouTube, Vimeo, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, and more).
- **YouTube Playlists & Channels**: Ultra-fast flat extraction (< 2s) without downloading media upfront. Interactive selection card with *Select All*, video checkboxes, total duration estimation, and bulk download actions.
- **Concurrent Download Queue**: Multi-item download manager with configurable concurrency (up to 3 simultaneous downloads), queue status badges (*Queued*, *Downloading*, *Merging*, *Complete*), and *Cancel All* / *Clear Finished* controls.
- **Audio Extractors & Codecs**: High-bitrate audio extraction presets including MP3 320kbps, AAC/M4A, FLAC, and WAV.
- **Subtitles Extraction & Embedding**: Detects available subtitle tracks and automatically extracts or embeds them via FFmpeg.
- **Format & Quality Selection**: Choose resolutions (4K, 1080p, 720p, 480p, 360p) or custom streams before downloading.

### ⚡ Torrent Downloader & Sequential Streaming
- **High-Performance Engine**: Powered by `libtorrent` (v2.x) with DHT, PeX, LSD, and UPnP/NAT-PMP enabled.
- **In-Browser HTML5 Media Streaming**: Stream partially downloaded torrent video and audio files directly in the browser while downloading using HTTP 206 Partial Content Range requests.
- **Sequential Piece Prioritization**: Automatically prioritizes header, initial, and tail pieces to enable smooth video playback from the first minute of download.
- **Magnet Link & `.torrent` Support**: Instant metadata inspection and downloading from magnet links or drag-and-drop `.torrent` files.
- **Torrent Details Drawer**:
  - **Files Tab**: Inspect all files inside a torrent with individual priority toggles (*Normal*, *High*, *Skip*) and progress bars.
  - **Peers Tab**: Real-time table of connected peers, client software, IP addresses, upload/download rates, and flags.
  - **Trackers Tab**: Monitor all tracker announce tiers, seeds, leechers, and connection statuses.

### 🎛️ Bandwidth Management & Telemetry
- **Global Speed Limiter**: Quick header chip with speed presets (*Unlimited*, *500 KB/s*, *1 MB/s*, *2 MB/s*, *5 MB/s*, *10 MB/s*) or custom limits applied dynamically to libtorrent.
- **Aggregated Telemetry**: Real-time header metrics for total system bandwidth, active transfer counts, and free disk space.

### 📜 History & File Management
- **Persistent SQLite History**: Automatic logging of all completed downloads with search, item filters (*All*, *Video*, *Torrent*), and deletion tools.
- **Native Desktop Integration**: One-click *"Open File"* and *"Show in Folder"* buttons to reveal downloaded files directly in your OS file manager (Linux `xdg-open`, macOS `open`, Windows `explorer`).
- **Configurable Directories**: In-app Settings modal to customize download destination directories on the fly.

### 🎨 Clean Dark Glassmorphic UI
- **Handcrafted Slate Theme**: Vibrant modern design with smooth gradients, responsive layout, micro-animations, and zero heavy frontend frameworks (pure Vanilla HTML5, CSS, and JavaScript).
- **In-Browser Player Modal**: Floating HTML5 player modal with keyboard shortcuts (<kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> seek, <kbd>Esc</kbd> close).

---

## 🛠️ Tech Stack

- **Backend**: Python 3.10+, FastAPI, Uvicorn, SSE-Starlette
- **Engines**: `yt-dlp`, `libtorrent`, `ffmpeg`, `sqlite3`
- **Frontend**: Vanilla JavaScript (ES6+), Modern Vanilla CSS (Desktop Slate Dark Theme, Flexbox/Grid)

---

## 📋 Prerequisites

- **Python 3.10+**
- **FFmpeg** (strongly recommended for merging video/audio streams and subtitle embedding):
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
python3 app.py
```

Open your browser at **`http://localhost:8000`** to start downloading!

---

## 📂 Project Structure

```
DownloadHub/
├── app.py             # Unified FastAPI backend, queue manager & SSE event streaming
├── downloader.py      # yt-dlp engine wrapper, playlist parser & format presets
├── history.py         # SQLite persistence engine & configuration store
├── utils.py           # Formatting utilities, duration/size parsers & desktop helpers
├── requirements.txt   # Python project dependencies
├── static/
│   ├── index.html     # Single-page web dashboard (Video, Torrent, History, Modals)
│   ├── styles.css     # Modern dark glassmorphic stylesheet
│   └── app.js         # Frontend controller, queue polling & SSE listeners
├── data/              # SQLite database storage (history.db)
└── README.md          # Project documentation
```

---

## ⚙️ Configuration

Downloads are saved to your user directory by default:
- **Videos**: `~/Downloads`
- **Torrents**: `~/Downloads/Torrents`

You can change download paths at any time via the **⚙ Settings** button in the top navigation bar or via `POST /api/system/config`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
