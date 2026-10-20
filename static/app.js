/**
 * DownloadHub — Handcrafted Desktop Frontend Engine
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── TOAST SYSTEM ───────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
    const container = $('#toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    
    let icon = 'ℹ';
    if (type === 'success') icon = '✔';
    if (type === 'error') icon = '✖';
    if (type === 'warning') icon = '⚠';

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.transition = 'all 200ms ease-in';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 200);
    }, duration);
}

// ─── SYSTEM STATUS POLLING ──────────────────────────────────────────────────
async function updateSystemStatus() {
    try {
        const res = await fetch('/api/torrent/system-status');
        if (!res.ok) return;
        const data = await res.json();

        const diskEl = $('#sys-disk-space');
        const speedEl = $('#sys-speed-total');
        
        if (diskEl) diskEl.textContent = `${data.disk_free_gb.toFixed(1)} GB Free`;
        if (speedEl) speedEl.textContent = `↓ ${data.download_rate_formatted}`;
    } catch (e) {
        // Silent background update catch
    }
}

setInterval(updateSystemStatus, 4000);
updateSystemStatus();

// ─── TAB SWITCHING LOGIC ────────────────────────────────────────────────────
const tabBtns = $$('.tab-btn');
const tabPanels = $$('.tab-panel');
const tabIndicator = $('.tab-indicator');

function updateTabIndicator(activeBtn) {
    if (!tabIndicator || !activeBtn) return;
    const bar = activeBtn.closest('.tab-bar');
    if (!bar) return;
    const barRect = bar.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    const leftOffset = btnRect.left - barRect.left - 6;
    tabIndicator.style.width = `${btnRect.width}px`;
    tabIndicator.style.transform = `translateX(${leftOffset}px)`;
}

tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateTabIndicator(btn);

        const targetPanelId = btn.getAttribute('data-tab');
        tabPanels.forEach(panel => {
            if (panel.id === targetPanelId) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });

        if (targetPanelId === 'history-panel') {
            loadHistory();
        }
    });
});

window.addEventListener('resize', () => {
    const activeBtn = $('.tab-btn.active');
    if (activeBtn) updateTabIndicator(activeBtn);
});

// Initial tab indicator positioning
setTimeout(() => {
    const activeBtn = $('.tab-btn.active');
    if (activeBtn) updateTabIndicator(activeBtn);
}, 60);

// ─── VIDEO DOWNLOADER MODULE ────────────────────────────────────────────────

const videoUrlInput = $('#video-url-input');
const videoFetchBtn = $('#video-fetch-btn');
const videoInfoCard = $('#video-info-card');
const videoInfoThumb = $('#video-info-thumb');
const videoInfoTitle = $('#video-info-title');
const videoInfoDetails = $('#video-info-details');
const videoInfoPlatform = $('#video-info-platform');
const videoOptionsCard = $('#video-options-card');
const videoQualitySelect = $('#video-quality-select');
const videoDownloadBtn = $('#video-download-btn');
const videoProgressCard = $('#video-progress-card');
const videoProgressTitle = $('#video-progress-title');
const videoProgressPct = $('#video-progress-pct');
const videoProgressFill = $('#video-progress-fill');
const videoStatSpeed = $('#video-stat-speed');
const videoStatEta = $('#video-stat-eta');
const videoStatSize = $('#video-stat-size');
const videoStatusText = $('#video-status-text');
const videoStatusBar = $('#video-status-bar');
const videoCancelBtn = $('#video-cancel-btn');

let videoData = null;
let videoDownloading = false;
let videoCurrentTaskId = null;
let videoCurrentEvtSource = null;
let lastCompletedVideoPath = null;

function setVideoStatus(text, level = '') {
    if (videoStatusText) videoStatusText.textContent = text;
    if (videoStatusBar) videoStatusBar.className = 'status-bar mt-4' + (level ? ` status-bar--${level}` : '');
}

function showVideoCard(el) {
    if (el) el.hidden = false;
}

function hideVideoCard(el) {
    if (el) el.hidden = true;
}

function setVideoBtnLoading(btn, loading) {
    if (!btn) return;
    const text = btn.querySelector('.btn__text');
    const loader = btn.querySelector('.btn__loader');
    if (loading) {
        if (text) text.hidden = true;
        if (loader) loader.hidden = false;
        btn.disabled = true;
    } else {
        if (text) text.hidden = false;
        if (loader) loader.hidden = true;
        btn.disabled = false;
    }
}

async function fetchVideoInfo() {
    const url = videoUrlInput.value.trim();
    if (!url) {
        setVideoStatus('⚠ Please enter a video URL.', 'warning');
        showToast('Please enter a video URL.', 'warning');
        return;
    }

    setVideoBtnLoading(videoFetchBtn, true);
    setVideoStatus('Fetching video information…');
    if (!videoDownloading) {
        hideVideoCard(videoProgressCard);
    }

    try {
        const resp = await fetch('/api/video/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        const data = await resp.json();

        if (!resp.ok) throw new Error(data.error || 'Failed to fetch video details');

        videoData = data;

        if (videoInfoThumb) {
            if (data.thumbnail) {
                videoInfoThumb.src = data.thumbnail;
                videoInfoThumb.style.display = 'block';
            } else {
                videoInfoThumb.style.display = 'none';
            }
        }
        if (videoInfoTitle) videoInfoTitle.textContent = data.title;
        
        const parts = [];
        if (data.uploader && data.uploader !== 'Unknown') parts.push(data.uploader);
        if (data.duration_formatted) parts.push(data.duration_formatted);
        if (videoInfoDetails) videoInfoDetails.textContent = parts.join(' • ');
        if (videoInfoPlatform) videoInfoPlatform.textContent = data.platform;

        if (videoQualitySelect) {
            videoQualitySelect.innerHTML = '';
            for (const fmt of data.formats) {
                const opt = document.createElement('option');
                opt.value = fmt.format_id;
                opt.textContent = fmt.label;
                videoQualitySelect.appendChild(opt);
            }
        }

        showVideoCard(videoInfoCard);
        showVideoCard(videoOptionsCard);
        setVideoStatus('✔ Video info loaded — select quality to download.', 'success');
        showToast('Video information loaded!', 'success');

    } catch (err) {
        setVideoStatus(`✖ ${err.message}`, 'error');
        showToast(err.message, 'error');
    } finally {
        setVideoBtnLoading(videoFetchBtn, false);
    }
}

async function startVideoDownload() {
    if (!videoData || videoDownloading) return;

    const formatId = videoQualitySelect ? videoQualitySelect.value : 'best';
    videoDownloading = true;
    setVideoBtnLoading(videoDownloadBtn, true);

    videoProgressTitle.textContent = 'Downloading…';
    videoProgressPct.textContent = '0%';
    videoProgressFill.style.width = '0%';
    videoStatSpeed.textContent = 'Speed: --';
    videoStatEta.textContent = 'ETA: --:--';
    videoStatSize.textContent = '';
    showVideoCard(videoProgressCard);
    setVideoStatus('Downloading video…');

    lastCompletedVideoPath = null;
    const videoActions = $('#video-complete-actions');
    if (videoActions) videoActions.setAttribute('hidden', '');

    try {
        const resp = await fetch('/api/video/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: videoData.url, format_id: formatId }),
        });

        const { task_id, error } = await resp.json();
        if (error) throw new Error(error);

        videoCurrentTaskId = task_id;
        const evtSource = new EventSource(`/api/video/progress/${task_id}`);
        videoCurrentEvtSource = evtSource;

        evtSource.addEventListener('progress', (e) => {
            const d = JSON.parse(e.data);

            videoProgressPct.textContent = `${d.percent}%`;
            videoProgressFill.style.width = `${d.percent}%`;

            if (d.speed) videoStatSpeed.textContent = `Speed: ${d.speed}`;
            if (d.eta) videoStatEta.textContent = `ETA: ${d.eta}`;
            if (d.total) videoStatSize.textContent = `${d.downloaded} / ${d.total}`;

            if (d.status === 'merging') {
                videoProgressTitle.textContent = 'Merging video & audio streams…';
            }

            if (d.status === 'complete') {
                videoProgressTitle.textContent = '✔ Download complete!';
                videoProgressPct.textContent = '100%';
                videoProgressFill.style.width = '100%';
                setVideoStatus(`✔ Download completed successfully!`, 'success');
                showToast('Video download finished!', 'success');

                if (d.filepath) {
                    lastCompletedVideoPath = d.filepath;
                    if (videoActions) videoActions.removeAttribute('hidden');
                }

                evtSource.close();
                finishVideoDownload();
            }

            if (d.status === 'cancelled' || d.status === 'error') {
                videoProgressTitle.textContent = d.status === 'cancelled' ? '⏹ Download cancelled' : '✖ Download failed';
                setVideoStatus(d.error || 'Download stopped', d.status === 'cancelled' ? 'warning' : 'error');
                evtSource.close();
                finishVideoDownload();
            }
        });

        evtSource.addEventListener('error', () => {
            evtSource.close();
            setVideoStatus('✖ Connection to download server lost.', 'error');
            finishVideoDownload();
        });

    } catch (err) {
        setVideoStatus(`✖ ${err.message}`, 'error');
        showToast(err.message, 'error');
        finishVideoDownload();
    }
}

function finishVideoDownload() {
    videoDownloading = false;
    videoCurrentTaskId = null;
    videoCurrentEvtSource = null;
    setVideoBtnLoading(videoDownloadBtn, false);
}

async function cancelVideoDownload() {
    if (!videoCurrentTaskId) return;
    try {
        await fetch(`/api/video/cancel/${videoCurrentTaskId}`, { method: 'POST' });
        showToast('Cancel request sent', 'info');
    } catch (err) {
        console.error('Cancel error:', err);
    }
}

if (videoFetchBtn) videoFetchBtn.addEventListener('click', fetchVideoInfo);
if ($('#video-paste-btn')) {
    $('#video-paste-btn').addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                videoUrlInput.value = text.trim();
                showToast('URL pasted from clipboard', 'info');
                fetchVideoInfo();
            } else {
                showToast('Clipboard is empty', 'warning');
            }
        } catch (err) {
            showToast('Unable to read clipboard. Please paste manually.', 'warning');
        }
    });
}
if (videoUrlInput) {
    videoUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') fetchVideoInfo();
    });
}
if (videoDownloadBtn) videoDownloadBtn.addEventListener('click', startVideoDownload);
if (videoCancelBtn) videoCancelBtn.addEventListener('click', cancelVideoDownload);

// ─── TORRENT DOWNLOADER MODULE ──────────────────────────────────────────────

let torrentCurrentInfo = null;
const torrentActiveEventSources = {};
const torrentDownloadCards = {};

const torrentMagnetInput = $('#torrent-magnetInput');
const torrentFetchBtn = $('#torrent-fetchBtn');
const torrentLoadingSection = $('#torrent-loadingSection');
const torrentErrorSection = $('#torrent-errorSection');
const torrentInfoSection = $('#torrent-infoSection');
const torrentDownloadsHeader = $('#torrent-downloadsHeader');
const torrentDownloadsList = $('#torrent-downloadsList');
const torrentActiveCount = $('#torrent-activeCount');

if (torrentMagnetInput) {
    torrentMagnetInput.addEventListener('paste', (e) => {
        setTimeout(() => {
            const val = torrentMagnetInput.value.trim();
            if (val.startsWith('magnet:')) {
                fetchTorrentInfo();
            }
        }, 100);
    });

    torrentMagnetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') fetchTorrentInfo();
    });
}

if (torrentFetchBtn) torrentFetchBtn.addEventListener('click', fetchTorrentInfo);
if ($('#torrent-paste-btn')) {
    $('#torrent-paste-btn').addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                torrentMagnetInput.value = text.trim();
                showToast('Magnet link pasted from clipboard', 'info');
                fetchTorrentInfo();
            } else {
                showToast('Clipboard is empty', 'warning');
            }
        } catch (err) {
            showToast('Unable to read clipboard. Please paste manually.', 'warning');
        }
    });
}
if ($('#torrent-cancelFetchBtn')) $('#torrent-cancelFetchBtn').addEventListener('click', cancelTorrentFetch);
if ($('#torrent-resetErrorBtn')) $('#torrent-resetErrorBtn').addEventListener('click', resetTorrentUI);
if ($('#torrent-closeInfoBtn')) $('#torrent-closeInfoBtn').addEventListener('click', resetTorrentUI);
if ($('#torrent-selectAllBtn')) $('#torrent-selectAllBtn').addEventListener('click', selectAllFiles);
if ($('#torrent-deselectAllBtn')) $('#torrent-deselectAllBtn').addEventListener('click', deselectAllFiles);
if ($('#torrent-downloadBtn')) $('#torrent-downloadBtn').addEventListener('click', startTorrentDownload);

// Dropzone & File Input for .torrent
const torrentDropzone = $('#torrent-dropzone');
const torrentFileInput = $('#torrent-fileInput');

if (torrentDropzone && torrentFileInput) {
    torrentDropzone.addEventListener('click', () => torrentFileInput.click());

    torrentDropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            torrentFileInput.click();
        }
    });

    torrentDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        torrentDropzone.classList.add('dragover');
    });

    torrentDropzone.addEventListener('dragleave', () => {
        torrentDropzone.classList.remove('dragover');
    });

    torrentDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        torrentDropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleTorrentFileUpload(e.dataTransfer.files[0]);
        }
    });

    torrentFileInput.addEventListener('change', () => {
        if (torrentFileInput.files && torrentFileInput.files.length > 0) {
            handleTorrentFileUpload(torrentFileInput.files[0]);
        }
    });
}

async function handleTorrentFileUpload(file) {
    if (!file.name.toLowerCase().endsWith('.torrent')) {
        showToast('Please select a valid .torrent file.', 'warning');
        return;
    }

    showTorrentSection('loading');
    if (torrentFetchBtn) torrentFetchBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/torrent/upload-file', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to parse .torrent file');
        }

        const data = await response.json();
        torrentCurrentInfo = data;
        displayTorrentInfo(data);
        showTorrentSection('info');
        showToast('Torrent file metadata loaded!', 'success');
    } catch (err) {
        showTorrentError('Upload Error', err.message);
        showToast(err.message, 'error');
    } finally {
        if (torrentFetchBtn) torrentFetchBtn.disabled = false;
        if (torrentFileInput) torrentFileInput.value = '';
    }
}

// Batch pause / resume all
if ($('#torrent-pauseAllBtn')) {
    $('#torrent-pauseAllBtn').addEventListener('click', async () => {
        await fetch('/api/torrent/downloads/pause-all', { method: 'POST' });
        showToast('All downloads paused', 'info');
    });
}

if ($('#torrent-resumeAllBtn')) {
    $('#torrent-resumeAllBtn').addEventListener('click', async () => {
        await fetch('/api/torrent/downloads/resume-all', { method: 'POST' });
        showToast('All downloads resumed', 'info');
    });
}

// File category filter buttons
$$('.file-filter-chips .filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.file-filter-chips .filter-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        filterFilesByCategory(filter);
    });
});

function filterFilesByCategory(category) {
    const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v'];
    const audioExts = ['.mp3', '.flac', '.aac', '.wav', '.ogg', '.m4a'];
    const docExts = ['.pdf', '.epub', '.zip', '.rar', '.7z', '.txt', '.doc', '.docx', '.iso'];

    $$('#torrent-fileList .file-item').forEach(item => {
        const name = item.querySelector('.file-name').textContent.toLowerCase();
        let show = true;

        if (category === 'video') show = videoExts.some(ext => name.endsWith(ext));
        if (category === 'audio') show = audioExts.some(ext => name.endsWith(ext));
        if (category === 'doc') show = docExts.some(ext => name.endsWith(ext));

        item.style.display = show ? 'flex' : 'none';
    });
}

let torrentFetchAbortController = null;

function cancelTorrentFetch() {
    if (torrentFetchAbortController) {
        torrentFetchAbortController.abort();
        torrentFetchAbortController = null;
    }
    showTorrentSection('input');
    if (torrentFetchBtn) torrentFetchBtn.disabled = false;
    showToast('Metadata fetch cancelled.', 'info');
}

async function fetchTorrentInfo() {
    const magnetLink = torrentMagnetInput.value.trim();
    if (!magnetLink) {
        showToast('Please enter a magnet link or hash.', 'warning');
        return;
    }

    if (torrentFetchAbortController) {
        torrentFetchAbortController.abort();
    }
    torrentFetchAbortController = new AbortController();

    showTorrentSection('loading');
    if (torrentFetchBtn) torrentFetchBtn.disabled = true;

    try {
        const response = await fetch('/api/torrent/fetch-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ magnet_link: magnetLink }),
            signal: torrentFetchAbortController.signal,
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to fetch torrent info');
        }

        const data = await response.json();
        torrentCurrentInfo = data;
        displayTorrentInfo(data);
        showTorrentSection('info');
        showToast('Torrent metadata fetched!', 'success');

    } catch (err) {
        if (err.name === 'AbortError') {
            return;
        }
        showTorrentError('Metadata Error', err.message);
        showToast(err.message, 'error');
    } finally {
        if (torrentFetchBtn) torrentFetchBtn.disabled = false;
        torrentFetchAbortController = null;
    }
}

function displayTorrentInfo(info) {
    if ($('#torrent-torrentName')) $('#torrent-torrentName').textContent = info.name;
    if ($('#torrent-totalSize')) $('#torrent-totalSize').textContent = info.total_size_formatted;
    if ($('#torrent-numFiles')) $('#torrent-numFiles').textContent = `${info.num_files} files`;
    if ($('#torrent-numPeers')) $('#torrent-numPeers').textContent = `${info.num_peers} peers / ${info.num_seeds} seeds`;
    if ($('#torrent-numPieces')) $('#torrent-numPieces').textContent = `${info.num_pieces} (${info.piece_length_formatted})`;

    const fileList = $('#torrent-fileList');
    if (!fileList) return;

    fileList.innerHTML = '';
    info.files.forEach((file) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.onclick = (e) => {
            if (e.target.tagName !== 'INPUT') {
                const cb = item.querySelector('input');
                if (cb) cb.checked = !cb.checked;
            }
        };

        item.innerHTML = `
            <input type="checkbox" id="torrent-file-${file.index}" data-index="${file.index}" checked>
            <div class="file-info" style="flex: 1; min-width: 0;">
                <div class="file-name" title="${escapeHtml(file.path)}">${escapeHtml(getFileName(file.path))}</div>
            </div>
            <div class="file-size">${file.size_formatted}</div>
        `;
        fileList.appendChild(item);
    });
}

function selectAllFiles() {
    $$('#torrent-fileList input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function deselectAllFiles() {
    $$('#torrent-fileList input[type="checkbox"]').forEach(cb => cb.checked = false);
}

async function startTorrentDownload() {
    if (!torrentCurrentInfo) return;

    const selectedFiles = [];
    $$('#torrent-fileList input[type="checkbox"]:checked').forEach(cb => {
        selectedFiles.push(parseInt(cb.dataset.index));
    });

    if (selectedFiles.length === 0) {
        showToast('Please select at least one file to download.', 'warning');
        return;
    }

    const downloadBtn = $('#torrent-downloadBtn');
    if (downloadBtn) downloadBtn.disabled = true;

    try {
        const response = await fetch('/api/torrent/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                magnet_link: torrentCurrentInfo.magnet_link,
                selected_files: selectedFiles,
            }),
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to start download');
        }

        const data = await response.json();
        const torrentId = data.torrent_id;

        createTorrentDownloadCard(torrentId, torrentCurrentInfo.name);
        startTorrentProgressStream(torrentId);

        showTorrentSection('input');
        torrentMagnetInput.value = '';
        torrentCurrentInfo = null;
        showToast('Torrent download started!', 'success');

    } catch (err) {
        showTorrentError('Download Error', err.message);
        showToast(err.message, 'error');
    } finally {
        if (downloadBtn) downloadBtn.disabled = false;
    }
}

function createTorrentDownloadCard(torrentId, name) {
    if (torrentDownloadsHeader) torrentDownloadsHeader.style.display = 'block';

    if (torrentDownloadCards[torrentId]) return;

    const card = document.createElement('div');
    card.className = 'glass-card download-card';
    card.id = `torrent-download-${torrentId}`;

    card.innerHTML = `
        <div class="download-card-header">
            <div class="download-card-title">
                <h3 title="${escapeHtml(name)}">${escapeHtml(name)}</h3>
                <span class="state-badge downloading_metadata" id="torrent-state-${torrentId}">connecting</span>
            </div>
            <div class="download-card-controls">
                <button class="btn-icon pause-btn" id="torrent-pause-${torrentId}" title="Pause">⏸</button>
                <button class="btn-icon cancel-btn" id="torrent-cancel-${torrentId}" title="Cancel">✕</button>
            </div>
        </div>

        <div class="progress-track" style="height: 8px; margin: 10px 0;">
            <div class="progress-fill" id="torrent-progress-fill-${torrentId}" style="width: 0%"></div>
        </div>

        <div class="download-stats">
            <div class="download-stat">
                <div class="label">Speed ↓</div>
                <div class="value" id="torrent-speed-${torrentId}">0 B/s</div>
            </div>
            <div class="download-stat">
                <div class="label">Upload ↑</div>
                <div class="value" id="torrent-upload-${torrentId}">0 B/s</div>
            </div>
            <div class="download-stat">
                <div class="label">ETA</div>
                <div class="value" id="torrent-eta-${torrentId}">∞</div>
            </div>
            <div class="download-stat">
                <div class="label">Peers</div>
                <div class="value" id="torrent-peers-${torrentId}">0</div>
            </div>
        </div>
    `;

    torrentDownloadsList.prepend(card);
    torrentDownloadCards[torrentId] = card;

    card.querySelector('.pause-btn').addEventListener('click', () => toggleTorrentPause(torrentId));
    card.querySelector('.cancel-btn').addEventListener('click', () => cancelTorrentDownload(torrentId));

    updateTorrentActiveCount();
}

function startTorrentProgressStream(torrentId) {
    if (torrentActiveEventSources[torrentId]) return;

    const eventSource = new EventSource(`/api/torrent/progress/${torrentId}`);
    torrentActiveEventSources[torrentId] = eventSource;

    eventSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data);
        updateTorrentDownloadCard(torrentId, data);
    });

    eventSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        updateTorrentDownloadCard(torrentId, data);
        markTorrentComplete(torrentId);
        eventSource.close();
        delete torrentActiveEventSources[torrentId];
        updateTorrentActiveCount();
    });

    eventSource.addEventListener('removed', () => {
        eventSource.close();
        delete torrentActiveEventSources[torrentId];
        updateTorrentActiveCount();
    });

    eventSource.addEventListener('error', () => {
        eventSource.close();
        delete torrentActiveEventSources[torrentId];
        updateTorrentActiveCount();
    });
}

function updateTorrentDownloadCard(torrentId, data) {
    const card = torrentDownloadCards[torrentId];
    if (!card) return;

    const titleEl = card.querySelector('h3');
    if (data.name && data.name !== 'Fetching metadata...') {
        titleEl.textContent = data.name;
        titleEl.title = data.name;
    }

    const stateBadge = $(`#torrent-state-${torrentId}`);
    if (stateBadge) {
        const stateText = data.paused ? 'paused' : data.state;
        stateBadge.textContent = stateText.replace(/_/g, ' ');
        stateBadge.className = `state-badge ${data.paused ? 'paused' : data.state}`;
    }

    const progressFill = $(`#torrent-progress-fill-${torrentId}`);
    if (progressFill) progressFill.style.width = `${data.progress}%`;

    const speedEl = $(`#torrent-speed-${torrentId}`);
    if (speedEl) speedEl.textContent = data.download_rate_formatted;

    const uploadEl = $(`#torrent-upload-${torrentId}`);
    if (uploadEl) uploadEl.textContent = data.upload_rate_formatted;

    const etaEl = $(`#torrent-eta-${torrentId}`);
    if (etaEl) etaEl.textContent = data.eta_formatted;

    const peersEl = $(`#torrent-peers-${torrentId}`);
    if (peersEl) peersEl.textContent = data.num_peers;

    const pauseBtn = $(`#torrent-pause-${torrentId}`);
    if (pauseBtn) {
        pauseBtn.textContent = data.paused ? '▶' : '⏸';
        pauseBtn.title = data.paused ? 'Resume' : 'Pause';
    }
}

function markTorrentComplete(torrentId) {
    const stateBadge = $(`#torrent-state-${torrentId}`);
    if (stateBadge) {
        stateBadge.textContent = 'complete';
        stateBadge.className = 'state-badge complete';
    }
    const speedEl = $(`#torrent-speed-${torrentId}`);
    if (speedEl) speedEl.textContent = '—';
    const etaEl = $(`#torrent-eta-${torrentId}`);
    if (etaEl) etaEl.textContent = 'Done';

    const card = torrentDownloadCards[torrentId];
    if (card && !card.querySelector('.torrent-show-folder-btn')) {
        const actionRow = document.createElement('div');
        actionRow.className = 'complete-actions mt-3';
        actionRow.innerHTML = `
            <button class="btn btn-secondary btn-sm torrent-show-folder-btn" type="button">📁 Show in Folder</button>
        `;
        card.appendChild(actionRow);
        actionRow.querySelector('.torrent-show-folder-btn').addEventListener('click', async () => {
            try {
                const confRes = await fetch('/api/system/config');
                if (confRes.ok) {
                    const conf = await confRes.json();
                    if (conf.torrent_download_dir) {
                        showInFolder(conf.torrent_download_dir);
                    }
                }
            } catch (e) {
                console.error(e);
            }
        });
    }
}

async function toggleTorrentPause(torrentId) {
    const pauseBtn = $(`#torrent-pause-${torrentId}`);
    const isPaused = pauseBtn.title === 'Resume';
    const endpoint = isPaused ? `/api/torrent/download/${torrentId}/resume` : `/api/torrent/download/${torrentId}/pause`;

    try {
        await fetch(endpoint, { method: 'POST' });
        showToast(isPaused ? 'Resumed download' : 'Paused download', 'info');
    } catch (err) {
        console.error('Pause/Resume error:', err);
    }
}

async function cancelTorrentDownload(torrentId) {
    if (!confirm('Cancel this torrent download? Downloaded files will be removed.')) return;

    try {
        const response = await fetch(`/api/torrent/download/${torrentId}/cancel`, { method: 'DELETE' });
        if (!response.ok) return;

        if (torrentActiveEventSources[torrentId]) {
            torrentActiveEventSources[torrentId].close();
            delete torrentActiveEventSources[torrentId];
        }

        const card = torrentDownloadCards[torrentId];
        if (card) {
            card.remove();
            delete torrentDownloadCards[torrentId];
            updateTorrentActiveCount();
        }
        showToast('Torrent removed', 'info');
    } catch (err) {
        console.error('Cancel error:', err);
    }
}

function showTorrentSection(section) {
    if (torrentLoadingSection) torrentLoadingSection.classList.add('hidden');
    if (torrentErrorSection) torrentErrorSection.classList.add('hidden');
    if (torrentInfoSection) torrentInfoSection.classList.add('hidden');

    if (section === 'loading' && torrentLoadingSection) torrentLoadingSection.classList.remove('hidden');
    if (section === 'error' && torrentErrorSection) torrentErrorSection.classList.remove('hidden');
    if (section === 'info' && torrentInfoSection) torrentInfoSection.classList.remove('hidden');
}

function showTorrentError(title, message) {
    if ($('#torrent-errorTitle')) $('#torrent-errorTitle').textContent = title;
    if ($('#torrent-errorMessage')) $('#torrent-errorMessage').textContent = message;
    showTorrentSection('error');
}

function resetTorrentUI() {
    showTorrentSection('input');
    torrentCurrentInfo = null;
    if (torrentMagnetInput) torrentMagnetInput.value = '';
}

function updateTorrentActiveCount() {
    if (torrentActiveCount) {
        torrentActiveCount.textContent = Object.keys(torrentActiveEventSources).length;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getFileName(path) {
    return path.split('/').pop() || path;
}

document.addEventListener('DOMContentLoaded', () => {
    loadExistingTorrentDownloads();

    // Wire completed video action buttons
    const videoOpenFileBtn = $('#video-open-file-btn');
    const videoShowFolderBtn = $('#video-show-folder-btn');
    if (videoOpenFileBtn) {
        videoOpenFileBtn.addEventListener('click', () => {
            if (lastCompletedVideoPath) openFile(lastCompletedVideoPath);
        });
    }
    if (videoShowFolderBtn) {
        videoShowFolderBtn.addEventListener('click', () => {
            if (lastCompletedVideoPath) showInFolder(lastCompletedVideoPath);
        });
    }
});

async function loadExistingTorrentDownloads() {
    try {
        const response = await fetch('/api/torrent/downloads');
        if (!response.ok) return;

        const data = await response.json();
        if (data.downloads && data.downloads.length > 0) {
            data.downloads.forEach(dl => {
                createTorrentDownloadCard(dl.torrent_id, dl.name);
                if (dl.state !== 'finished' && dl.state !== 'seeding') {
                    startTorrentProgressStream(dl.torrent_id);
                } else {
                    markTorrentComplete(dl.torrent_id);
                }
            });
        }
    } catch (err) {
        // No downloads yet
    }
}

// ─── SYSTEM FILE OPERATIONS & UTILITIES ──────────────────────────────────────

async function openFile(filePath) {
    if (!filePath) return;
    try {
        const res = await fetch('/api/system/open-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: filePath }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Could not open file on system.', 'error');
        } else {
            showToast('Opening file with default application...', 'info');
        }
    } catch (e) {
        showToast('Failed to open file: ' + e.message, 'error');
    }
}

async function showInFolder(filePath) {
    if (!filePath) return;
    try {
        const res = await fetch('/api/system/show-in-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: filePath }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Could not reveal file in folder.', 'error');
        } else {
            showToast('Opening file location...', 'info');
        }
    } catch (e) {
        showToast('Failed to show folder: ' + e.message, 'error');
    }
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

// ─── SETTINGS MODAL ENGINE ──────────────────────────────────────────────────

const settingsModal = $('#settings-modal');
const headerSettingsBtn = $('#header-settings-btn');
const closeSettingsBtn = $('#close-settings-btn');
const cancelSettingsBtn = $('#cancel-settings-btn');
const saveSettingsBtn = $('#save-settings-btn');
const cfgVideoDir = $('#cfg-video-dir');
const cfgTorrentDir = $('#cfg-torrent-dir');

function openSettingsModal() {
    loadSettings();
    if (settingsModal) settingsModal.removeAttribute('hidden');
}

function closeSettingsModal() {
    if (settingsModal) settingsModal.setAttribute('hidden', '');
}

async function loadSettings() {
    try {
        const res = await fetch('/api/system/config');
        if (!res.ok) return;
        const config = await res.json();
        if (cfgVideoDir) cfgVideoDir.value = config.video_download_dir || '';
        if (cfgTorrentDir) cfgTorrentDir.value = config.torrent_download_dir || '';
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

async function saveSettings() {
    const videoDir = cfgVideoDir ? cfgVideoDir.value.trim() : '';
    const torrentDir = cfgTorrentDir ? cfgTorrentDir.value.trim() : '';

    try {
        const res = await fetch('/api/system/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_dir: videoDir, torrent_dir: torrentDir }),
        });
        if (res.ok) {
            showToast('Download directories updated!', 'success');
            closeSettingsModal();
        } else {
            showToast('Failed to save settings.', 'error');
        }
    } catch (e) {
        showToast('Error saving settings: ' + e.message, 'error');
    }
}

if (headerSettingsBtn) headerSettingsBtn.addEventListener('click', openSettingsModal);
if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);
if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', closeSettingsModal);
if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });
}

// ─── HISTORY ENGINE ─────────────────────────────────────────────────────────

const historyList = $('#history-list');
const historySearchInput = $('#history-search-input');
const historyClearBtn = $('#history-clear-btn');
let historySearchDebounce = null;

async function loadHistory(query = '') {
    if (!historyList) return;
    try {
        const res = await fetch(`/api/history?search=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        const data = await res.json();
        renderHistory(data.history || []);
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

function renderHistory(items) {
    if (!historyList) return;
    historyList.innerHTML = '';

    if (!items || items.length === 0) {
        historyList.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon">📜</div>
                <h3>No Downloads in History</h3>
                <p>Downloaded videos and torrents will automatically appear here.</p>
            </div>
        `;
        return;
    }

    items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'history-card';
        const isVideo = (item.type || item.item_type) === 'video';
        const badgeClass = isVideo ? 'history-badge--video' : 'history-badge--torrent';
        const badgeLabel = isVideo ? '🎬 Video' : '🧲 Torrent';
        const timestamp = item.completed_at ? (item.completed_at < 1e11 ? item.completed_at * 1000 : item.completed_at) : Date.now();
        const dateStr = new Date(timestamp).toLocaleString();

        card.innerHTML = `
            <div class="history-info">
                <div class="history-title-row">
                    <span class="history-badge ${badgeClass}">${badgeLabel}</span>
                    <span class="history-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
                </div>
                <div class="history-meta">
                    <span>${formatBytes(item.file_size)}</span>
                    <span>•</span>
                    <span>${dateStr}</span>
                    <span>•</span>
                    <span class="history-path" title="${escapeHtml(item.file_path)}">${escapeHtml(item.file_path)}</span>
                </div>
            </div>
            <div class="history-actions">
                <button class="btn btn-primary btn-sm open-btn" type="button" title="Open File">▶ Open</button>
                <button class="btn btn-secondary btn-sm folder-btn" type="button" title="Show in Folder">📁 Folder</button>
                <button class="btn btn-secondary btn-sm delete-btn" type="button" title="Delete from history">🗑</button>
            </div>
        `;

        card.querySelector('.open-btn').addEventListener('click', () => openFile(item.file_path));
        card.querySelector('.folder-btn').addEventListener('click', () => showInFolder(item.file_path));
        card.querySelector('.delete-btn').addEventListener('click', () => deleteHistoryItem(item.id));

        historyList.appendChild(card);
    });
}

async function deleteHistoryItem(id) {
    try {
        const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Removed item from history', 'info');
            const searchVal = historySearchInput ? historySearchInput.value.trim() : '';
            loadHistory(searchVal);
        }
    } catch (e) {
        showToast('Failed to delete item: ' + e.message, 'error');
    }
}

async function clearAllHistory() {
    if (!confirm('Are you sure you want to clear your entire download history? (Files on disk will remain safe)')) return;
    try {
        const res = await fetch('/api/history', { method: 'DELETE' });
        if (res.ok) {
            showToast('Download history cleared', 'success');
            loadHistory();
        }
    } catch (e) {
        showToast('Failed to clear history: ' + e.message, 'error');
    }
}

if (historyClearBtn) historyClearBtn.addEventListener('click', clearAllHistory);

if (historySearchInput) {
    historySearchInput.addEventListener('input', (e) => {
        clearTimeout(historySearchDebounce);
        historySearchDebounce = setTimeout(() => {
            loadHistory(e.target.value.trim());
        }, 250);
    });
}
