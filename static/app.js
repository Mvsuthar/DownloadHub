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

// Playlist Selectors
const playlistCard = $('#playlist-card');
const playlistThumb = $('#playlist-thumb');
const playlistTitle = $('#playlist-title');
const playlistUploader = $('#playlist-uploader');
const playlistVideoCount = $('#playlist-video-count');
const playlistTotalDuration = $('#playlist-total-duration');
const playlistPlatformBadge = $('#playlist-platform-badge');
const playlistSelectAllCheck = $('#playlist-select-all-check');
const playlistSelectionCounter = $('#playlist-selection-counter');
const playlistSelectionDuration = $('#playlist-selection-duration');
const playlistQualitySelect = $('#playlist-quality-select');
const playlistDownloadBtn = $('#playlist-download-btn');
const playlistEntriesList = $('#playlist-entries-list');

// Queue Selectors
const videoQueueSection = $('#video-queue-section');
const queueStatusChip = $('#queue-status-chip');
const videoQueueList = $('#video-queue-list');
const videoQueueClearBtn = $('#video-queue-clear-btn');
const videoQueueCancelAllBtn = $('#video-queue-cancel-all-btn');

let videoData = null;
let currentPlaylistData = null;
let playlistSelectedIndices = new Set();
let videoQueuePollTimer = null;

let videoDownloading = false;
let videoCurrentTaskId = null;
let videoCurrentEvtSource = null;
let lastCompletedVideoPath = null;

function formatSeconds(seconds) {
    if (!seconds || seconds <= 0) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
    return `${pad(m)}:${pad(s)}`;
}

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
        setVideoStatus('⚠ Please enter a video or playlist URL.', 'warning');
        showToast('Please enter a video or playlist URL.', 'warning');
        return;
    }

    setVideoBtnLoading(videoFetchBtn, true);
    setVideoStatus('Fetching video or playlist information…');
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

        if (data.is_playlist) {
            // Handle Playlist Extraction
            hideVideoCard(videoInfoCard);
            hideVideoCard(videoOptionsCard);

            currentPlaylistData = data;
            videoData = null;

            if (playlistThumb) {
                if (data.thumbnail) {
                    playlistThumb.src = data.thumbnail;
                    playlistThumb.style.display = 'block';
                } else {
                    playlistThumb.style.display = 'none';
                }
            }
            if (playlistTitle) playlistTitle.textContent = data.title || 'Playlist';
            if (playlistUploader) playlistUploader.textContent = data.uploader || 'Unknown';
            if (playlistVideoCount) playlistVideoCount.textContent = `${data.total_count} Videos`;
            if (playlistTotalDuration) playlistTotalDuration.textContent = data.total_duration_formatted || '--:--';
            if (playlistPlatformBadge) playlistPlatformBadge.textContent = data.platform || 'YouTube';

            playlistSelectedIndices = new Set(data.entries.map((_, i) => i));
            renderPlaylistEntries(data.entries);
            updatePlaylistSelectionStats();

            showVideoCard(playlistCard);
            setVideoStatus(`✔ Playlist loaded — ${data.entries.length} videos available.`, 'success');
            showToast(`Playlist loaded: ${data.entries.length} videos`, 'success');
        } else {
            // Handle Single Video
            hideVideoCard(playlistCard);
            currentPlaylistData = null;
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
                const videoGroup = document.createElement('optgroup');
                videoGroup.label = '🎬 Video Formats';
                const audioGroup = document.createElement('optgroup');
                audioGroup.label = '🎵 Audio Formats / Encoders';

                for (const fmt of data.formats) {
                    const opt = document.createElement('option');
                    opt.value = fmt.format_id;
                    opt.textContent = fmt.label;
                    if (fmt.category === 'audio' || fmt.format_id.startsWith('audio-') || fmt.format_id.startsWith('bestaudio')) {
                        audioGroup.appendChild(opt);
                    } else {
                        videoGroup.appendChild(opt);
                    }
                }

                if (videoGroup.children.length > 0) videoQualitySelect.appendChild(videoGroup);
                if (audioGroup.children.length > 0) videoQualitySelect.appendChild(audioGroup);
            }

            const subtitleContainer = $('#video-subtitle-container');
            const subtitleSelect = $('#video-subtitle-select');
            const embedSubsContainer = $('#video-embed-subs-container');

            if (subtitleSelect && subtitleContainer) {
                subtitleSelect.innerHTML = '<option value="">None (No Subtitles)</option>';
                if (data.subtitles && data.subtitles.length > 0) {
                    for (const sub of data.subtitles) {
                        const opt = document.createElement('option');
                        opt.value = sub.lang;
                        opt.textContent = sub.label;
                        subtitleSelect.appendChild(opt);
                    }
                    subtitleContainer.style.display = 'flex';
                    if (embedSubsContainer) embedSubsContainer.style.display = 'flex';
                } else {
                    subtitleContainer.style.display = 'none';
                    if (embedSubsContainer) embedSubsContainer.style.display = 'none';
                }
            }

            showVideoCard(videoInfoCard);
            showVideoCard(videoOptionsCard);
            setVideoStatus('✔ Video info loaded — select quality to download.', 'success');
            showToast('Video information loaded!', 'success');
        }

    } catch (err) {
        setVideoStatus(`✖ ${err.message}`, 'error');
        showToast(err.message, 'error');
    } finally {
        setVideoBtnLoading(videoFetchBtn, false);
    }
}

function renderPlaylistEntries(entries) {
    if (!playlistEntriesList) return;
    playlistEntriesList.innerHTML = '';

    entries.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.className = 'playlist-entry-item';
        row.dataset.index = idx;

        const isChecked = playlistSelectedIndices.has(idx);

        row.innerHTML = `
            <input type="checkbox" class="playlist-entry-check" data-index="${idx}" ${isChecked ? 'checked' : ''} aria-label="Select ${escapeHtml(entry.title)}">
            <span class="playlist-entry-idx">#${idx + 1}</span>
            ${entry.thumbnail ? `<img class="playlist-entry-thumb" src="${entry.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<div class="playlist-entry-thumb-placeholder">🎬</div>`}
            <div class="playlist-entry-info">
                <span class="playlist-entry-title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</span>
                <span class="playlist-entry-channel">${escapeHtml(entry.uploader || '')}</span>
            </div>
            <span class="playlist-entry-duration">${entry.duration_formatted || '--:--'}</span>
        `;

        const checkInput = row.querySelector('.playlist-entry-check');
        checkInput.addEventListener('change', (e) => {
            const index = Number(e.target.dataset.index);
            if (e.target.checked) {
                playlistSelectedIndices.add(index);
            } else {
                playlistSelectedIndices.delete(index);
            }
            updatePlaylistSelectionStats();
        });

        playlistEntriesList.appendChild(row);
    });
}

function updatePlaylistSelectionStats() {
    if (!currentPlaylistData) return;
    const total = currentPlaylistData.entries.length;
    const count = playlistSelectedIndices.size;

    if (playlistSelectionCounter) {
        playlistSelectionCounter.textContent = `${count} of ${total} selected`;
    }

    let totalDuration = 0;
    for (const idx of playlistSelectedIndices) {
        const item = currentPlaylistData.entries[idx];
        if (item && item.duration) {
            totalDuration += Number(item.duration);
        }
    }

    if (playlistSelectionDuration) {
        playlistSelectionDuration.textContent = totalDuration > 0 ? `(${formatSeconds(totalDuration)})` : '';
    }

    if (playlistDownloadBtn) {
        const text = playlistDownloadBtn.querySelector('.btn__text');
        if (text) text.textContent = `⬇ Download Selected (${count})`;
        playlistDownloadBtn.disabled = count === 0;
    }

    if (playlistSelectAllCheck) {
        playlistSelectAllCheck.checked = (count === total && total > 0);
        playlistSelectAllCheck.indeterminate = (count > 0 && count < total);
    }
}

async function startPlaylistBatchDownload() {
    if (!currentPlaylistData || playlistSelectedIndices.size === 0) return;

    const selectedItems = [];
    for (const idx of playlistSelectedIndices) {
        const item = currentPlaylistData.entries[idx];
        if (item) {
            selectedItems.push({
                url: item.url,
                title: item.title,
                thumbnail: item.thumbnail,
                duration: item.duration,
                duration_formatted: item.duration_formatted,
            });
        }
    }

    const formatId = playlistQualitySelect ? playlistQualitySelect.value : 'best';

    setVideoBtnLoading(playlistDownloadBtn, true);
    setVideoStatus(`Queuing ${selectedItems.length} videos for batch download…`);

    try {
        const resp = await fetch('/api/video/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: selectedItems,
                format_id: formatId,
            }),
        });

        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to queue playlist batch');

        showToast(`Queued ${data.queued_count} videos in download manager!`, 'success');
        setVideoStatus(`✔ ${data.queued_count} videos added to queue.`, 'success');
        fetchVideoQueue();
    } catch (err) {
        setVideoStatus(`✖ ${err.message}`, 'error');
        showToast(err.message, 'error');
    } finally {
        setVideoBtnLoading(playlistDownloadBtn, false);
    }
}

async function fetchVideoQueue() {
    try {
        const res = await fetch('/api/video/queue');
        if (!res.ok) return;
        const data = await res.json();

        if (!data.tasks || data.tasks.length === 0) {
            if (videoQueueSection) hideVideoCard(videoQueueSection);
            return;
        }

        if (videoQueueSection) showVideoCard(videoQueueSection);

        if (queueStatusChip) {
            queueStatusChip.textContent = `${data.active_count} Active • ${data.queued_count} Queued • ${data.completed_count} Done`;
        }

        if (videoQueueList) {
            renderVideoQueueItems(data.tasks);
        }

        clearTimeout(videoQueuePollTimer);
        if (data.active_count > 0 || data.queued_count > 0) {
            videoQueuePollTimer = setTimeout(fetchVideoQueue, 1500);
        } else {
            videoQueuePollTimer = setTimeout(fetchVideoQueue, 5000);
        }
    } catch (e) {
        // Silent catch for background polling
    }
}

function renderVideoQueueItems(tasks) {
    if (!videoQueueList) return;
    videoQueueList.innerHTML = '';

    tasks.forEach((t) => {
        const card = document.createElement('div');
        card.className = 'queue-item';

        const statusClass = `status-badge ${t.status}`;
        const canCancel = ['queued', 'starting', 'downloading', 'merging'].includes(t.status);
        const isComplete = t.status === 'complete';

        let statsText = '';
        if (t.status === 'downloading' || t.status === 'merging') {
            const parts = [];
            if (t.speed) parts.push(`Speed: ${t.speed}`);
            if (t.eta) parts.push(`ETA: ${t.eta}`);
            if (t.total) parts.push(`${t.downloaded} / ${t.total}`);
            statsText = parts.join(' • ');
        } else if (t.status === 'queued') {
            statsText = 'Waiting in queue (3 active max)…';
        } else if (t.status === 'complete') {
            statsText = `Completed ${t.filename || ''} (${t.downloaded || ''})`;
        } else if (t.status === 'error') {
            statsText = `Error: ${t.error || 'Download failed'}`;
        } else if (t.status === 'cancelled') {
            statsText = 'Cancelled by user';
        }

        card.innerHTML = `
            <div class="queue-item-row">
                ${t.thumbnail ? `<img class="queue-item-thumb" src="${t.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<div class="queue-item-thumb" style="display:flex;align-items:center;justify-content:center;background:#141b2d;font-size:0.75rem;">🎬</div>`}
                <div class="queue-item-main">
                    <span class="queue-item-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
                    <div class="queue-item-meta">
                        <span class="format-badge">${escapeHtml(t.format_id)}</span>
                        ${t.duration_formatted ? `<span>${t.duration_formatted}</span>` : ''}
                    </div>
                </div>
                <div class="queue-item-badges">
                    <span class="${statusClass}">${t.status}</span>
                    <div class="queue-item-actions">
                        ${canCancel ? `<button class="queue-btn-icon queue-btn-cancel" title="Cancel this download" data-task-id="${t.task_id}">✕</button>` : ''}
                        ${isComplete && t.filepath ? `
                            <button class="btn btn-secondary btn-xs queue-play-btn" data-filepath="${escapeHtml(t.filepath)}" title="Play in browser">▶ Play</button>
                            <button class="btn btn-secondary btn-xs queue-folder-btn" data-filepath="${escapeHtml(t.filepath)}" title="Show in folder">📁</button>
                        ` : ''}
                    </div>
                </div>
            </div>
            ${(t.status === 'downloading' || t.status === 'merging' || t.percent > 0) ? `
                <div class="queue-item-progress-track">
                    <div class="queue-item-progress-fill" style="width: ${t.percent}%"></div>
                </div>
            ` : ''}
            <div class="queue-item-stats">
                <span>${escapeHtml(statsText)}</span>
                ${(t.status === 'downloading' || t.status === 'merging') ? `<span>${t.percent}%</span>` : ''}
            </div>
        `;

        const cancelBtn = card.querySelector('.queue-btn-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', async () => {
                await fetch(`/api/video/cancel/${t.task_id}`, { method: 'POST' });
                showToast('Download cancelled', 'warning');
                fetchVideoQueue();
            });
        }

        const playBtn = card.querySelector('.queue-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                openFile(t.filepath);
            });
        }

        const folderBtn = card.querySelector('.queue-folder-btn');
        if (folderBtn) {
            folderBtn.addEventListener('click', () => {
                showInFolder(t.filepath);
            });
        }

        videoQueueList.appendChild(card);
    });
}

async function startVideoDownload() {
    if (!videoData || videoDownloading) return;

    const formatId = videoQualitySelect ? videoQualitySelect.value : 'best';
    const subSelect = $('#video-subtitle-select');
    const embedCheck = $('#video-embed-subs-check');
    const subtitlesLang = subSelect && subSelect.value ? subSelect.value : null;
    const embedSubtitles = embedCheck ? embedCheck.checked : false;

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
            body: JSON.stringify({
                url: videoData.url,
                format_id: formatId,
                subtitles_lang: subtitlesLang,
                embed_subtitles: embedSubtitles,
            }),
        });

        const { task_id, error } = await resp.json();
        if (error) throw new Error(error);

        videoCurrentTaskId = task_id;
        fetchVideoQueue();
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

// Playlist & Queue Event Listeners
if (playlistSelectAllCheck) {
    playlistSelectAllCheck.addEventListener('change', (e) => {
        if (!currentPlaylistData) return;
        if (e.target.checked) {
            playlistSelectedIndices = new Set(currentPlaylistData.entries.map((_, i) => i));
        } else {
            playlistSelectedIndices.clear();
        }
        const checks = $$('.playlist-entry-check');
        checks.forEach(c => c.checked = e.target.checked);
        updatePlaylistSelectionStats();
    });
}

if (playlistDownloadBtn) {
    playlistDownloadBtn.addEventListener('click', startPlaylistBatchDownload);
}

if (videoQueueClearBtn) {
    videoQueueClearBtn.addEventListener('click', async () => {
        const res = await fetch('/api/video/clear-completed', { method: 'POST' });
        if (res.ok) {
            showToast('Cleared finished downloads', 'info');
            fetchVideoQueue();
        }
    });
}

if (videoQueueCancelAllBtn) {
    videoQueueCancelAllBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to cancel all queued and active downloads?')) return;
        const res = await fetch('/api/video/cancel-all', { method: 'POST' });
        if (res.ok) {
            showToast('All downloads cancelled', 'warning');
            fetchVideoQueue();
        }
    });
}

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
                <button class="btn-icon stream-card-btn" id="torrent-stream-${torrentId}" title="Stream / Watch Media">▶</button>
                <button class="btn-icon drawer-toggle-btn" id="torrent-drawer-toggle-${torrentId}" title="Inspect Details (Files, Peers, Trackers)">📊</button>
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

        <!-- Telemetry Drawer (Phase 2) -->
        <div class="torrent-drawer" id="torrent-drawer-${torrentId}" hidden>
            <div class="drawer-tabs">
                <button type="button" class="drawer-tab-btn active" data-drawer-tab="files" data-torrent-id="${torrentId}">Files (<span id="drawer-files-count-${torrentId}">0</span>)</button>
                <button type="button" class="drawer-tab-btn" data-drawer-tab="peers" data-torrent-id="${torrentId}">Peers (<span id="drawer-peers-count-${torrentId}">0</span>)</button>
                <button type="button" class="drawer-tab-btn" data-drawer-tab="trackers" data-torrent-id="${torrentId}">Trackers (<span id="drawer-trackers-count-${torrentId}">0</span>)</button>
            </div>
            <div class="drawer-panel active" id="drawer-panel-files-${torrentId}">
                <div class="drawer-files-content" id="drawer-files-content-${torrentId}">Loading files...</div>
            </div>
            <div class="drawer-panel" id="drawer-panel-peers-${torrentId}">
                <div class="drawer-peers-content" id="drawer-peers-content-${torrentId}">Loading peers...</div>
            </div>
            <div class="drawer-panel" id="drawer-panel-trackers-${torrentId}">
                <div class="drawer-trackers-content" id="drawer-trackers-content-${torrentId}">Loading trackers...</div>
            </div>
        </div>
    `;

    torrentDownloadsList.prepend(card);
    torrentDownloadCards[torrentId] = card;

    card.querySelector('.stream-card-btn').addEventListener('click', () => streamTorrentCard(torrentId));
    card.querySelector('.pause-btn').addEventListener('click', () => toggleTorrentPause(torrentId));
    card.querySelector('.cancel-btn').addEventListener('click', () => cancelTorrentDownload(torrentId));
    card.querySelector('.drawer-toggle-btn').addEventListener('click', () => toggleTorrentDrawer(torrentId));

    // Drawer tab switching
    card.querySelectorAll('.drawer-tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', (e) => {
            const targetTab = e.currentTarget.getAttribute('data-drawer-tab');
            switchDrawerTab(torrentId, targetTab);
        });
    });

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
    loadSpeedLimits();

    // Wire completed video action buttons
    const videoPlayBtn = $('#video-play-btn');
    const videoOpenFileBtn = $('#video-open-file-btn');
    const videoShowFolderBtn = $('#video-show-folder-btn');
    if (videoPlayBtn) {
        videoPlayBtn.addEventListener('click', () => {
            if (lastCompletedVideoPath) {
                const title = videoData ? videoData.title : 'Downloaded Media';
                const streamUrl = `/api/media/stream?path=${encodeURIComponent(lastCompletedVideoPath)}`;
                openPlayerModal(streamUrl, title, false, lastCompletedVideoPath);
            }
        });
    }
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
        const isMedia = isVideo || isMediaFile(item.file_path);
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
                ${isMedia ? `<button class="btn btn-primary btn-sm play-btn" type="button" title="Play in Browser">▶ Play</button>` : ''}
                <button class="btn btn-secondary btn-sm open-btn" type="button" title="Open with Default App">↗ Open</button>
                <button class="btn btn-secondary btn-sm folder-btn" type="button" title="Show in Folder">📁 Folder</button>
                <button class="btn btn-secondary btn-sm delete-btn" type="button" title="Delete from history">🗑</button>
            </div>
        `;

        if (isMedia) {
            const playBtn = card.querySelector('.play-btn');
            if (playBtn) {
                playBtn.addEventListener('click', () => {
                    const streamUrl = `/api/media/stream?path=${encodeURIComponent(item.file_path)}`;
                    openPlayerModal(streamUrl, item.title, false, item.file_path);
                });
            }
        }

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

// ─── SPEED LIMITER ENGINE (PHASE 2) ─────────────────────────────────────────

const headerSpeedLimitBtn = $('#header-speed-limit-btn');
const speedLimitLabel = $('#speed-limit-label');
const speedLimiterModal = $('#speed-limiter-modal');
const closeSpeedLimiterBtn = $('#close-speed-limiter-btn');
const cancelSpeedLimiterBtn = $('#cancel-speed-limiter-btn');
const saveSpeedLimiterBtn = $('#save-speed-limiter-btn');
const customSpeedInput = $('#custom-speed-input');
const customUploadInput = $('#custom-upload-input');
const speedPresetBtns = $$('.speed-preset-btn');

async function loadSpeedLimits() {
    try {
        const res = await fetch('/api/torrent/settings/speed-limits');
        if (!res.ok) return;
        const data = await res.json();
        updateSpeedLimitBadge(data.download_limit_kb);
        if (customSpeedInput) customSpeedInput.value = data.download_limit_kb || 0;
        if (customUploadInput) customUploadInput.value = data.upload_limit_kb || 0;
        highlightActivePreset(data.download_limit_kb);
    } catch (e) {
        console.error('Failed to load speed limits:', e);
    }
}

function updateSpeedLimitBadge(dlKb) {
    if (!speedLimitLabel) return;
    if (!dlKb || dlKb === 0) {
        speedLimitLabel.textContent = 'Unlimited';
    } else if (dlKb >= 1024) {
        speedLimitLabel.textContent = `${(dlKb / 1024).toFixed(0)} MB/s`;
    } else {
        speedLimitLabel.textContent = `${dlKb} KB/s`;
    }
}

function highlightActivePreset(dlKb) {
    speedPresetBtns.forEach(btn => {
        const speed = parseInt(btn.getAttribute('data-speed'), 10);
        if (speed === (dlKb || 0)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function openSpeedLimiterModal() {
    loadSpeedLimits();
    if (speedLimiterModal) speedLimiterModal.removeAttribute('hidden');
}

function closeSpeedLimiterModal() {
    if (speedLimiterModal) speedLimiterModal.setAttribute('hidden', '');
}

async function saveSpeedLimits() {
    const dlKb = customSpeedInput ? parseInt(customSpeedInput.value || '0', 10) : 0;
    const ulKb = customUploadInput ? parseInt(customUploadInput.value || '0', 10) : 0;

    try {
        const res = await fetch('/api/torrent/settings/speed-limits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_limit_kb: dlKb, upload_limit_kb: ulKb }),
        });
        if (res.ok) {
            updateSpeedLimitBadge(dlKb);
            highlightActivePreset(dlKb);
            showToast(dlKb === 0 ? 'Speed limit removed (Unlimited)' : `Bandwidth limit set to ${dlKb} KB/s`, 'success');
            closeSpeedLimiterModal();
        } else {
            showToast('Failed to apply speed limits.', 'error');
        }
    } catch (e) {
        showToast('Error applying speed limits: ' + e.message, 'error');
    }
}

speedPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        speedPresetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const speed = btn.getAttribute('data-speed');
        if (customSpeedInput) customSpeedInput.value = speed;
    });
});

if (headerSpeedLimitBtn) headerSpeedLimitBtn.addEventListener('click', openSpeedLimiterModal);
if (closeSpeedLimiterBtn) closeSpeedLimiterBtn.addEventListener('click', closeSpeedLimiterModal);
if (cancelSpeedLimiterBtn) cancelSpeedLimiterBtn.addEventListener('click', closeSpeedLimiterModal);
if (saveSpeedLimiterBtn) saveSpeedLimiterBtn.addEventListener('click', saveSpeedLimits);

if (speedLimiterModal) {
    speedLimiterModal.addEventListener('click', (e) => {
        if (e.target === speedLimiterModal) closeSpeedLimiterModal();
    });
}

// ─── TORRENT TELEMETRY & DRAWER ENGINE (PHASE 2) ────────────────────────────

const torrentDrawerPollIntervals = {};

function toggleTorrentDrawer(torrentId) {
    const drawer = $(`#torrent-drawer-${torrentId}`);
    if (!drawer) return;

    const isHidden = drawer.hasAttribute('hidden');
    if (isHidden) {
        drawer.removeAttribute('hidden');
        fetchTorrentTelemetry(torrentId);
        // Start live polling every 2.5 seconds
        if (!torrentDrawerPollIntervals[torrentId]) {
            torrentDrawerPollIntervals[torrentId] = setInterval(() => {
                fetchTorrentTelemetry(torrentId);
            }, 2500);
        }
    } else {
        drawer.setAttribute('hidden', '');
        if (torrentDrawerPollIntervals[torrentId]) {
            clearInterval(torrentDrawerPollIntervals[torrentId]);
            delete torrentDrawerPollIntervals[torrentId];
        }
    }
}

function switchDrawerTab(torrentId, tabName) {
    const card = torrentDownloadCards[torrentId];
    if (!card) return;

    card.querySelectorAll('.drawer-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-drawer-tab') === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const panels = card.querySelectorAll('.drawer-panel');
    panels.forEach(panel => {
        if (panel.id === `drawer-panel-${tabName}-${torrentId}`) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });
}

async function fetchTorrentTelemetry(torrentId) {
    try {
        const [detailsRes, peersRes, trackersRes] = await Promise.all([
            fetch(`/api/torrent/download/${torrentId}/details`),
            fetch(`/api/torrent/download/${torrentId}/peers`),
            fetch(`/api/torrent/download/${torrentId}/trackers`),
        ]);

        if (detailsRes.ok) {
            const data = await detailsRes.json();
            renderDrawerFiles(torrentId, data.files || []);
        }

        if (peersRes.ok) {
            const data = await peersRes.json();
            renderDrawerPeers(torrentId, data.peers || []);
        }

        if (trackersRes.ok) {
            const data = await trackersRes.json();
            renderDrawerTrackers(torrentId, data.trackers || []);
        }
    } catch (e) {
        // Silent poll error catch
    }
}

function renderDrawerFiles(torrentId, files) {
    const container = $(`#drawer-files-content-${torrentId}`);
    const countEl = $(`#drawer-files-count-${torrentId}`);
    if (countEl) countEl.textContent = files.length;
    if (!container) return;

    if (!files || files.length === 0) {
        container.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Fetching file list from swarm...</div>';
        return;
    }

    let html = `
        <table class="drawer-table">
            <thead>
                <tr>
                    <th style="width: 38%;">File</th>
                    <th>Size</th>
                    <th>Progress</th>
                    <th>Priority</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
    `;

    files.forEach(f => {
        const media = isMediaFile(f.name);
        html += `
            <tr>
                <td title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</td>
                <td>${f.size_formatted}</td>
                <td>${f.progress}%</td>
                <td>
                    <select class="priority-select" data-torrent-id="${torrentId}" data-file-index="${f.index}">
                        <option value="1" ${f.priority === 1 || f.priority === 4 ? 'selected' : ''}>Normal</option>
                        <option value="7" ${f.priority === 7 ? 'selected' : ''}>High</option>
                        <option value="0" ${f.priority === 0 ? 'selected' : ''}>Skip</option>
                    </select>
                </td>
                <td>
                    ${media ? `<button type="button" class="btn-stream btn-drawer-stream" data-torrent-id="${torrentId}" data-file-index="${f.index}" data-name="${escapeHtml(f.name)}">▶ Stream</button>` : `<span style="color:var(--text-muted); font-size:0.75rem;">—</span>`}
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Attach priority change listener
    container.querySelectorAll('.priority-select').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            const fIdx = parseInt(e.target.getAttribute('data-file-index'), 10);
            const prio = parseInt(e.target.value, 10);
            try {
                const res = await fetch(`/api/torrent/download/${torrentId}/file-priority`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_index: fIdx, priority: prio }),
                });
                if (res.ok) {
                    showToast(`File priority set to ${prio === 0 ? 'Skip' : prio === 7 ? 'High' : 'Normal'}`, 'info');
                }
            } catch (err) {
                showToast('Failed to change file priority', 'error');
            }
        });
    });

    // Attach stream button listener
    container.querySelectorAll('.btn-drawer-stream').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const fIdx = parseInt(e.currentTarget.getAttribute('data-file-index'), 10);
            const fName = e.currentTarget.getAttribute('data-name');
            streamTorrentFile(torrentId, fIdx, fName);
        });
    });
}

function renderDrawerPeers(torrentId, peers) {
    const container = $(`#drawer-peers-content-${torrentId}`);
    const countEl = $(`#drawer-peers-count-${torrentId}`);
    if (countEl) countEl.textContent = peers.length;
    if (!container) return;

    if (!peers || peers.length === 0) {
        container.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Searching for connected peers via DHT & trackers...</div>';
        return;
    }

    let html = `
        <table class="drawer-table">
            <thead>
                <tr>
                    <th>Peer Endpoint</th>
                    <th>Client</th>
                    <th>↓ Down Speed</th>
                    <th>↑ Up Speed</th>
                    <th>Progress</th>
                </tr>
            </thead>
            <tbody>
    `;

    peers.forEach(p => {
        html += `
            <tr>
                <td>${escapeHtml(p.ip)}</td>
                <td>${escapeHtml(p.client)}</td>
                <td>${p.down_speed_formatted}</td>
                <td>${p.up_speed_formatted}</td>
                <td>${p.progress}%</td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function renderDrawerTrackers(torrentId, trackers) {
    const container = $(`#drawer-trackers-content-${torrentId}`);
    const countEl = $(`#drawer-trackers-count-${torrentId}`);
    if (countEl) countEl.textContent = trackers.length;
    if (!container) return;

    if (!trackers || trackers.length === 0) {
        container.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">No trackers registered for this swarm.</div>';
        return;
    }

    let html = `
        <table class="drawer-table">
            <thead>
                <tr>
                    <th>Tier</th>
                    <th>Tracker Announce URL</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    trackers.forEach(t => {
        const verifiedBadge = t.verified ? '<span style="color: var(--primary-emerald);">✔ Verified</span>' : '<span style="color: var(--text-muted);">Registered</span>';
        html += `
            <tr>
                <td>Tier ${t.tier}</td>
                <td title="${escapeHtml(t.url)}">${escapeHtml(t.url)}</td>
                <td>${verifiedBadge}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ─── IN-BROWSER HTML5 MEDIA PLAYER & STREAMING CONTROLLER (PHASE 3) ────────

const playerModal = $('#player-modal');
const playerVideo = $('#media-player-video');
const playerModalTitle = $('#player-modal-title');
const playerStreamBadge = $('#player-stream-badge');
const playerBufferAlert = $('#player-buffer-alert');
const playerBufferMsg = $('#player-buffer-msg');
const playerMediaFormat = $('#player-media-format');
const playerOpenFileBtn = $('#player-open-file-btn');
const closePlayerBtn = $('#close-player-btn');
const playerDoneBtn = $('#player-done-btn');

let activePlayerStreamUrl = null;
let activePlayerFilePath = null;

function isMediaFile(filename) {
    if (!filename) return false;
    const mediaExts = ['.mp4', '.m4v', '.webm', '.mkv', '.avi', '.mov', '.mp3', '.m4a', '.flac', '.wav', '.ogg'];
    const lower = filename.toLowerCase();
    return mediaExts.some(ext => lower.endsWith(ext));
}

function openPlayerModal(streamUrl, title = 'Media Stream', isStreaming = false, filePath = null) {
    if (!playerModal || !playerVideo) return;

    activePlayerStreamUrl = streamUrl;
    activePlayerFilePath = filePath;

    if (playerModalTitle) playerModalTitle.textContent = title;
    if (playerStreamBadge) {
        playerStreamBadge.textContent = isStreaming ? 'STREAMING' : 'PLAYBACK';
        playerStreamBadge.style.display = 'inline-flex';
    }

    const extMatch = (title || streamUrl).match(/\.([a-z0-9]+)(?:[?#]|$)/i);
    const ext = extMatch ? extMatch[1].toUpperCase() : 'MP4';
    if (playerMediaFormat) playerMediaFormat.textContent = `${ext} • HTML5`;

    if (playerOpenFileBtn) {
        if (filePath) {
            playerOpenFileBtn.style.display = 'inline-flex';
            playerOpenFileBtn.onclick = () => openFile(filePath);
        } else {
            playerOpenFileBtn.style.display = 'none';
        }
    }

    if (playerBufferAlert) {
        playerBufferAlert.style.display = isStreaming ? 'flex' : 'none';
        if (playerBufferMsg) playerBufferMsg.textContent = isStreaming
            ? 'Buffering stream pieces from swarm...'
            : '';
    }

    playerVideo.src = streamUrl;
    playerModal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';

    playerVideo.play().catch(e => {
        console.log('Autoplay deferred:', e);
    });

    playerVideo.oncanplay = () => {
        if (playerBufferAlert) playerBufferAlert.style.display = 'none';
    };

    playerVideo.onerror = (e) => {
        if (isStreaming) {
            if (playerBufferAlert) {
                playerBufferAlert.style.display = 'flex';
                if (playerBufferMsg) playerBufferMsg.textContent = 'Buffering next pieces...';
            }
        } else {
            showToast('Unable to stream media format directly in browser. Try opening in external app.', 'warning');
        }
    };
}

function closePlayerModal() {
    if (!playerModal || !playerVideo) return;
    playerVideo.pause();
    playerVideo.removeAttribute('src');
    playerVideo.load();
    playerModal.setAttribute('hidden', '');
    document.body.style.overflow = '';
    activePlayerStreamUrl = null;
    activePlayerFilePath = null;
}

if (closePlayerBtn) closePlayerBtn.addEventListener('click', closePlayerModal);
if (playerDoneBtn) playerDoneBtn.addEventListener('click', closePlayerModal);
if (playerModal) {
    playerModal.addEventListener('click', (e) => {
        if (e.target === playerModal) closePlayerModal();
    });
}
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && playerModal && !playerModal.hasAttribute('hidden')) {
        closePlayerModal();
    }
});

async function streamTorrentFile(torrentId, fileIndex, fileName) {
    try {
        await fetch(`/api/torrent/download/${torrentId}/sequential`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sequential: true, file_index: fileIndex }),
        });

        const streamUrl = `/api/torrent/stream/${torrentId}/${fileIndex}`;
        openPlayerModal(streamUrl, fileName, true);
        showToast(`Streaming ${fileName} with sequential priority`, 'info');
    } catch (e) {
        showToast('Failed to start torrent stream: ' + e.message, 'error');
    }
}

async function streamTorrentCard(torrentId) {
    try {
        const res = await fetch(`/api/torrent/download/${torrentId}/details`);
        if (!res.ok) throw new Error('Failed to retrieve torrent details');
        const data = await res.json();
        const files = data.files || [];
        const mediaFiles = files.filter(f => isMediaFile(f.name));

        if (mediaFiles.length === 0) {
            showToast('No playable media files found in this torrent yet. Check Details drawer.', 'warning');
            return;
        }

        mediaFiles.sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0));
        const target = mediaFiles[0];
        streamTorrentFile(torrentId, target.index, target.name);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// Initial fetch for video download queue
fetchVideoQueue();
