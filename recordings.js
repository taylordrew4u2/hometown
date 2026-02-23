// ===================================
// Bit Builder — Recordings Logic
// ===================================

import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// ===================================
// State
// ===================================

let auth, db;
let recordingsData = [];
let currentRecordingId = null;
let recordingsUnsubscribe = null;
let audioElement = null;
let isPlaying = false;
let animFrameId = null;

// Sample audio URL for dummy data (public domain tone)
const SAMPLE_AUDIO_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

// Dummy recording templates
const DUMMY_RECORDINGS = [
    { name: 'Open Mic — The Laugh Factory', duration: 512 },
    { name: 'Practice Session #12', duration: 225 },
    { name: 'New Bit — Airline Food', duration: 80 },
    { name: 'Crowd Work Practice', duration: 340 },
    { name: 'Five Minutes of New Material', duration: 310 },
    { name: 'Late Night Set — Comedy Store', duration: 420 },
    { name: 'Callback Riff Experiment', duration: 95 },
    { name: 'Tag Run — Dating Jokes', duration: 180 },
];

// ===================================
// DOM References
// ===================================

let recordingsList, emptyState;
let detailModal, detailClose, detailTitle, detailDate, detailDuration, detailSetlistRow, detailSetlist;
let playPauseBtn, playIcon, seekSlider, currentTimeEl, totalTimeEl;
let transcriptionText, transcribeBtn, saveTranscriptionBtn;
let shareBtn, deleteBtn;
let deleteModal, confirmDelete, cancelDelete;
let renameModal, renameClose, renameForm, renameInput, renameCancel;
let fabAdd;

// ===================================
// Initialisation
// ===================================

const initRecordingsApp = () => {
    if (!window.firebaseApp) {
        console.error('Firebase not initialized yet');
        setTimeout(initRecordingsApp, 100);
        return;
    }

    auth = window.firebaseApp.auth;
    db = window.firebaseApp.db;

    const bindUI = () => {
        // List
        recordingsList = document.getElementById('recordings-list');
        emptyState = document.getElementById('empty-state');

        // Detail modal
        detailModal = document.getElementById('detail-modal');
        detailClose = document.getElementById('detail-close');
        detailTitle = document.getElementById('detail-title');
        detailDate = document.getElementById('detail-date');
        detailDuration = document.getElementById('detail-duration');
        detailSetlistRow = document.getElementById('detail-setlist-row');
        detailSetlist = document.getElementById('detail-setlist');

        // Audio player
        playPauseBtn = document.getElementById('play-pause-btn');
        playIcon = document.getElementById('play-icon');
        seekSlider = document.getElementById('seek-slider');
        currentTimeEl = document.getElementById('current-time');
        totalTimeEl = document.getElementById('total-time');

        // Transcription
        transcriptionText = document.getElementById('transcription-text');
        transcribeBtn = document.getElementById('transcribe-btn');
        saveTranscriptionBtn = document.getElementById('save-transcription-btn');

        // Actions
        shareBtn = document.getElementById('share-btn');
        deleteBtn = document.getElementById('delete-btn');

        // Delete modal
        deleteModal = document.getElementById('delete-modal');
        confirmDelete = document.getElementById('confirm-delete');
        cancelDelete = document.getElementById('cancel-delete');

        // Rename modal
        renameModal = document.getElementById('rename-modal');
        renameClose = document.getElementById('rename-close');
        renameForm = document.getElementById('rename-form');
        renameInput = document.getElementById('rename-input');
        renameCancel = document.getElementById('rename-cancel');

        // FAB
        fabAdd = document.getElementById('fab-add');

        // --- Bind events ---

        // FAB → add dummy recording
        fabAdd.addEventListener('click', addDummyRecording);

        // Detail modal close
        detailClose.addEventListener('click', closeDetailModal);

        // Player
        playPauseBtn.addEventListener('click', togglePlayPause);
        seekSlider.addEventListener('input', onSeek);

        // Transcription
        transcribeBtn.addEventListener('click', simulateTranscription);
        transcriptionText.addEventListener('input', onTranscriptionEdit);
        saveTranscriptionBtn.addEventListener('click', saveTranscription);

        // Share / Delete
        shareBtn.addEventListener('click', shareRecording);
        deleteBtn.addEventListener('click', () => openDeleteModal());

        // Delete confirmation
        confirmDelete.addEventListener('click', deleteRecording);
        cancelDelete.addEventListener('click', closeDeleteModal);

        // Rename
        renameClose.addEventListener('click', closeRenameModal);
        renameCancel.addEventListener('click', closeRenameModal);
        renameForm.addEventListener('submit', saveRename);

        // Close modals on overlay click
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) closeDetailModal();
        });
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) closeDeleteModal();
        });
        renameModal.addEventListener('click', (e) => {
            if (e.target === renameModal) closeRenameModal();
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindUI, { once: true });
    } else {
        bindUI();
    }

    // Auth listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            loadRecordings();
        } else {
            recordingsData = [];
            if (recordingsUnsubscribe) {
                recordingsUnsubscribe();
                recordingsUnsubscribe = null;
            }
            if (recordingsList) recordingsList.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
        }
    });
};

initRecordingsApp();

// ===================================
// Load Recordings (real-time)
// ===================================

function loadRecordings() {
    const user = auth.currentUser;
    if (!user) return;

    if (recordingsUnsubscribe) recordingsUnsubscribe();

    const q = query(
        collection(db, 'recordings'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
    );

    recordingsUnsubscribe = onSnapshot(q, (snapshot) => {
        recordingsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderRecordingsList();
    }, (error) => {
        console.error('Error loading recordings:', error);
        // If index does not exist yet, still show empty state
        recordingsData = [];
        renderRecordingsList();
    });
}

// ===================================
// Render List
// ===================================

function renderRecordingsList() {
    recordingsList.innerHTML = '';

    if (recordingsData.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    recordingsData.forEach((rec) => {
        const item = document.createElement('div');
        item.className = 'recording-item';
        item.addEventListener('click', () => openRecordingDetail(rec.id));

        // Icon
        const icon = document.createElement('div');
        icon.className = 'rec-icon';
        icon.innerHTML = '<i class="fas fa-waveform-lines"></i>' +
            '<div class="recording-pulse"></div>';

        // Body
        const body = document.createElement('div');
        body.className = 'rec-body';

        const title = document.createElement('div');
        title.className = 'rec-title';
        title.textContent = rec.name || 'Untitled Recording';

        const subtitle = document.createElement('div');
        subtitle.className = 'rec-subtitle';
        const dateStr = formatDate(rec.createdAt);
        const durStr = formatDuration(rec.duration || 0);
        subtitle.textContent = `${dateStr} · ${durStr}`;

        body.appendChild(title);
        body.appendChild(subtitle);

        // Chevron
        const chevron = document.createElement('div');
        chevron.className = 'rec-chevron';
        chevron.innerHTML = '<i class="fas fa-chevron-right"></i>';

        item.appendChild(icon);
        item.appendChild(body);
        item.appendChild(chevron);
        recordingsList.appendChild(item);
    });
}

// ===================================
// Open Detail Modal
// ===================================

function openRecordingDetail(id) {
    const rec = recordingsData.find(r => r.id === id);
    if (!rec) return;

    currentRecordingId = id;

    // Title (tappable to rename)
    detailTitle.textContent = rec.name || 'Untitled Recording';
    detailTitle.style.cursor = 'pointer';
    detailTitle.onclick = () => openRenameModal(rec);

    // Metadata
    detailDate.textContent = formatDate(rec.createdAt);
    detailDuration.textContent = formatDuration(rec.duration || 0);

    if (rec.setListId) {
        detailSetlistRow.style.display = 'flex';
        detailSetlist.textContent = rec.setListId;
    } else {
        detailSetlistRow.style.display = 'none';
    }

    // Transcription
    transcriptionText.value = rec.transcription || '';
    saveTranscriptionBtn.style.display = 'none';

    // Audio setup
    resetAudioPlayer();
    if (rec.fileUrl) {
        setupAudioPlayer(rec.fileUrl, rec.duration);
    }

    detailModal.classList.remove('hidden');
}

function closeDetailModal() {
    detailModal.classList.add('hidden');
    resetAudioPlayer();
    currentRecordingId = null;
}

// ===================================
// Audio Player
// ===================================

function setupAudioPlayer(url, fallbackDuration) {
    audioElement = new Audio(url);
    audioElement.preload = 'metadata';

    audioElement.addEventListener('loadedmetadata', () => {
        const dur = audioElement.duration;
        totalTimeEl.textContent = formatDuration(Math.floor(dur));
        seekSlider.max = dur;
    });

    audioElement.addEventListener('ended', () => {
        isPlaying = false;
        playIcon.className = 'fas fa-play';
        cancelAnimationFrame(animFrameId);
    });

    // If metadata doesn't load, use fallback duration
    if (fallbackDuration) {
        totalTimeEl.textContent = formatDuration(fallbackDuration);
        seekSlider.max = fallbackDuration;
    }
}

function resetAudioPlayer() {
    if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
        audioElement = null;
    }
    isPlaying = false;
    if (playIcon) playIcon.className = 'fas fa-play';
    if (seekSlider) seekSlider.value = 0;
    if (currentTimeEl) currentTimeEl.textContent = '0:00';
    if (totalTimeEl) totalTimeEl.textContent = '0:00';
    cancelAnimationFrame(animFrameId);
}

function togglePlayPause() {
    if (!audioElement) return;

    if (isPlaying) {
        audioElement.pause();
        isPlaying = false;
        playIcon.className = 'fas fa-play';
        cancelAnimationFrame(animFrameId);
    } else {
        audioElement.play().then(() => {
            isPlaying = true;
            playIcon.className = 'fas fa-pause';
            updateProgress();
        }).catch(err => {
            console.error('Playback error:', err);
        });
    }
}

function updateProgress() {
    if (!audioElement || !isPlaying) return;
    seekSlider.value = audioElement.currentTime;
    currentTimeEl.textContent = formatDuration(Math.floor(audioElement.currentTime));
    animFrameId = requestAnimationFrame(updateProgress);
}

function onSeek() {
    if (!audioElement) return;
    audioElement.currentTime = Number(seekSlider.value);
    currentTimeEl.textContent = formatDuration(Math.floor(audioElement.currentTime));
}

// ===================================
// Transcription
// ===================================

function simulateTranscription() {
    const rec = recordingsData.find(r => r.id === currentRecordingId);
    if (!rec) return;

    if (rec.transcription && rec.transcription.trim()) {
        // Already has a transcription — confirm overwrite
        if (!confirm('This recording already has a transcription. Overwrite it?')) return;
    }

    transcribeBtn.disabled = true;
    transcribeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transcribing…';

    // Simulate a delay
    setTimeout(async () => {
        const sampleTranscription =
            `[Auto-transcription]\n\n` +
            `So I was at the airport the other day... and you know how they have those ` +
            `moving walkways? I always feel like I'm in a race with the people NOT on it. ` +
            `Like, buddy, I'm going the same direction as you, I just made a better life choice.\n\n` +
            `And what's the deal with the announcement — "the moving walkway is ending." ` +
            `Yeah, I can see that. I don't need a warning for the floor continuing. ` +
            `Nobody announces "stairs are ending" at the top.\n\n` +
            `[End of transcription — ${formatDuration(rec.duration || 0)} total]`;

        transcriptionText.value = sampleTranscription;

        // Save to Firestore
        try {
            const recRef = doc(db, 'recordings', currentRecordingId);
            await updateDoc(recRef, {
                transcription: sampleTranscription,
                updatedAt: serverTimestamp()
            });
        } catch (err) {
            console.error('Error saving transcription:', err);
        }

        transcribeBtn.disabled = false;
        transcribeBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Transcribe';
    }, 2000);
}

function onTranscriptionEdit() {
    // Show save button when user manually edits
    saveTranscriptionBtn.style.display = 'block';
}

async function saveTranscription() {
    if (!currentRecordingId) return;

    try {
        const recRef = doc(db, 'recordings', currentRecordingId);
        await updateDoc(recRef, {
            transcription: transcriptionText.value,
            updatedAt: serverTimestamp()
        });
        saveTranscriptionBtn.style.display = 'none';

        // Also update local data so it's in sync
        const rec = recordingsData.find(r => r.id === currentRecordingId);
        if (rec) rec.transcription = transcriptionText.value;
    } catch (err) {
        console.error('Error saving transcription:', err);
        alert('Error saving transcription: ' + err.message);
    }
}

// ===================================
// Share
// ===================================

function shareRecording() {
    const rec = recordingsData.find(r => r.id === currentRecordingId);
    if (!rec) return;

    const shareData = {
        title: rec.name || 'Recording',
        text: `Check out my recording: ${rec.name || 'Untitled'}` +
              (rec.transcription ? `\n\n${rec.transcription.substring(0, 200)}…` : ''),
    };

    if (rec.fileUrl) {
        shareData.url = rec.fileUrl;
    }

    if (navigator.share) {
        navigator.share(shareData).catch(err => {
            if (err.name !== 'AbortError') console.error('Share failed:', err);
        });
    } else {
        // Fallback: copy to clipboard
        const text = `${shareData.title}\n${shareData.text}${shareData.url ? '\n' + shareData.url : ''}`;
        navigator.clipboard.writeText(text).then(() => {
            alert('Copied to clipboard!');
        }).catch(() => {
            alert('Sharing is not supported on this device.');
        });
    }
}

// ===================================
// Delete
// ===================================

function openDeleteModal() {
    closeDetailModal();
    deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
    deleteModal.classList.add('hidden');
}

async function deleteRecording() {
    if (!currentRecordingId) return;

    try {
        await deleteDoc(doc(db, 'recordings', currentRecordingId));
        closeDeleteModal();
        currentRecordingId = null;
    } catch (err) {
        console.error('Error deleting recording:', err);
        alert('Error deleting recording: ' + err.message);
    }
}

// ===================================
// Rename
// ===================================

function openRenameModal(rec) {
    renameInput.value = rec.name || '';
    renameModal.classList.remove('hidden');
    renameInput.focus();
}

function closeRenameModal() {
    renameModal.classList.add('hidden');
    renameForm.reset();
}

async function saveRename(e) {
    e.preventDefault();
    if (!currentRecordingId) return;

    const newName = renameInput.value.trim();
    if (!newName) return;

    try {
        const recRef = doc(db, 'recordings', currentRecordingId);
        await updateDoc(recRef, {
            name: newName,
            updatedAt: serverTimestamp()
        });
        detailTitle.textContent = newName;
        closeRenameModal();
    } catch (err) {
        console.error('Error renaming recording:', err);
        alert('Error renaming: ' + err.message);
    }
}

// ===================================
// Add Dummy Recording
// ===================================

async function addDummyRecording() {
    const user = auth.currentUser;
    if (!user) { alert('Not signed in'); return; }

    const template = DUMMY_RECORDINGS[Math.floor(Math.random() * DUMMY_RECORDINGS.length)];
    const duration = template.duration + Math.floor(Math.random() * 60) - 30; // ±30s jitter

    try {
        await addDoc(collection(db, 'recordings'), {
            userId: user.uid,
            name: template.name,
            fileUrl: SAMPLE_AUDIO_URL,
            duration: Math.max(30, duration),
            setListId: null,
            transcription: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (err) {
        console.error('Error adding dummy recording:', err);
        alert('Error adding recording: ' + err.message);
    }
}

// ===================================
// Helpers
// ===================================

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(timestamp) {
    if (!timestamp) return 'Unknown date';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}
