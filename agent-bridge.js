// ===================================
// Agent Bridge — Voice transcript + notes + save
//
// 1. Wires up the ElevenLabs voice widget (tool calls + transcript)
// 2. Shows both user & agent transcriptions in real time
// 3. Notes panel for jotting ideas during conversation
// 4. Manual "Save to Bitbinder" on any message
// ===================================

import {
    collection,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

let auth, db, functions;
let currentUser = null;

// DOM refs
let messagesArea;

// Voice transcript state
let currentAgentBubble = null;
let currentAgentText = '';
let currentUserBubble = null;
let voiceActive = false;

const AGENT_ID = 'agent_7401ka31ry6qftr9ab89em3339w9';
const NOTES_STORAGE_KEY = 'bitbuilder_notes';

// ===================================
// Init — wait for Firebase
// ===================================

function init() {
    if (!window.firebaseApp) {
        setTimeout(init, 100);
        return;
    }

    auth = window.firebaseApp.auth;
    db = window.firebaseApp.db;
    functions = window.firebaseApp.functions;

    messagesArea = document.getElementById('messages-area');

    if (!messagesArea) {
        setTimeout(init, 100);
        return;
    }

    // Notes panel
    initNotes();

    // Clear transcript button
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            messagesArea.innerHTML = '';
            appendMessage('assistant', 'Transcript cleared. Press the phone icon to connect with BitBuilder!');
        });
    }

    // Save modal wiring
    initSaveModal();

    // Listen for postMessage from the widget iframe
    setupIframeBridge();

    // Warn before navigating away — transcript isn't persisted
    setupNavGuard();

    // Auth listener
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            console.log('[bridge] User:', user.uid);
        }
    });

    console.log('[bridge] Initialized');
}

// ===================================
// Notes Panel
// ===================================

function initNotes() {
    const notesInput = document.getElementById('notes-input');
    const charCount = document.getElementById('notes-char-count');
    const copyBtn = document.getElementById('copy-notes-btn');
    const clearBtn = document.getElementById('clear-notes-btn');

    if (!notesInput) return;

    // Restore saved notes
    const saved = localStorage.getItem(NOTES_STORAGE_KEY);
    if (saved) {
        notesInput.value = saved;
        if (charCount) charCount.textContent = saved.length;
    }

    // Auto-save on input
    let saveTimer = null;
    notesInput.addEventListener('input', () => {
        if (charCount) charCount.textContent = notesInput.value.length;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            localStorage.setItem(NOTES_STORAGE_KEY, notesInput.value);
        }, 500);
    });

    // Copy notes
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            if (!notesInput.value.trim()) return;
            try {
                await navigator.clipboard.writeText(notesInput.value);
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { copyBtn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1500);
            } catch {
                // Fallback
                notesInput.select();
                document.execCommand('copy');
            }
        });
    }

    // Clear notes
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (notesInput.value && !confirm('Clear all notes?')) return;
            notesInput.value = '';
            if (charCount) charCount.textContent = '0';
            localStorage.removeItem(NOTES_STORAGE_KEY);
        });
    }
}

// ===================================
// 1. IFRAME BRIDGE — listen for postMessage from widget-frame.html
// ===================================

function setupIframeBridge() {
    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'ws-open':
                voiceActive = true;
                updateVoiceStatus('connected');
                appendMessage('system', '🎤 Voice connected — start talking!');
                break;

            case 'ws-close':
                voiceActive = false;
                updateVoiceStatus('idle');
                appendMessage('system', '🔇 Voice ended');
                currentAgentBubble = null;
                currentAgentText = '';
                currentUserBubble = null;
                break;

            case 'ws-message':
                handleVoiceMessage(msg.data);
                break;

            case 'save-joke':
                saveJokeToFirestore(msg.params).then(result => {
                    if (result.success) appendMessage('tool', '✅ Joke saved to Bitbinder!');
                    else appendMessage('tool', '❌ ' + (result.error || 'Save failed'));
                    // Reply to iframe
                    const iframe = document.getElementById('widget-frame');
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage(
                            { type: 'save-joke-result', reqId: msg.reqId, result },
                            '*'
                        );
                    }
                });
                break;
        }
    });
    console.log('[bridge] Iframe bridge ready');
}

function updateVoiceStatus(state) {
    const statusEl = document.getElementById('voice-status');
    if (!statusEl) return;
    const dot = statusEl.querySelector('.status-dot');
    const label = statusEl.querySelector('.status-label');

    statusEl.classList.remove('connected', 'idle');
    if (state === 'connected') {
        statusEl.classList.add('connected');
        if (dot) dot.style.background = 'var(--success)';
        if (label) label.textContent = 'Listening...';
    } else {
        statusEl.classList.add('idle');
        if (dot) dot.style.background = 'var(--text-tertiary)';
        if (label) label.textContent = 'Tap to call';
    }
}

function handleVoiceMessage(data) {
    switch (data.type) {
        case 'user_transcript': {
            const evt = data.user_transcription_event || data;
            const text = evt.user_transcript || '';
            if (!text) break;
            if (evt.is_final) {
                if (currentUserBubble) {
                    currentUserBubble.textContent = text;
                    currentUserBubble.classList.remove('interim');
                    currentUserBubble = null;
                } else {
                    appendMessage('user', text);
                }
            } else {
                if (!currentUserBubble) {
                    currentUserBubble = appendMessage('user', text, true);
                    currentUserBubble.classList.add('interim');
                } else {
                    currentUserBubble.textContent = text;
                }
            }
            break;
        }

        case 'agent_response': {
            const evt = data.agent_response_event || data;
            const text = evt.agent_response || '';
            if (!text) break;
            if (!currentAgentBubble) {
                currentAgentBubble = appendMessage('assistant', text, true);
                currentAgentText = text;
            } else {
                currentAgentText = text;
                setBubbleHTML(currentAgentBubble, text);
            }
            break;
        }

        case 'agent_response_correction': {
            const evt = data.agent_response_correction_event || data;
            const text = evt.agent_response || evt.agent_response_correction || '';
            if (text && currentAgentBubble) {
                currentAgentText = text;
                setBubbleHTML(currentAgentBubble, text);
            }
            break;
        }

        case 'client_tool_call': {
            const call = data.client_tool_call || data;
            if (call.tool_name === 'save_joke') {
                saveJokeToFirestore(call.parameters).then(result => {
                    if (result.success) appendMessage('tool', '✅ Joke saved to Bitbinder!');
                    else appendMessage('tool', '❌ ' + (result.error || 'Save failed'));
                });
            }
            break;
        }

        case 'interruption':
        case 'turn_end':
        case 'end_of_turn':
            currentAgentBubble = null;
            currentAgentText = '';
            currentUserBubble = null;
            break;
    }
}

// ===================================
// 2. SAVE TO BITBINDER — direct Firestore write + manual UI
// ===================================

async function saveJokeToFirestore(params) {
    if (!currentUser) return { error: 'Not authenticated' };

    const content = params.content || params.joke || '';
    let tags = params.tags || [];
    if (typeof tags === 'string') tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (!content) return { error: 'Joke content is required' };
    if (!Array.isArray(tags) || tags.length === 0) tags = ['untagged'];

    try {
        const ref = await addDoc(collection(db, 'jokes'), {
            userId: currentUser.uid,
            content,
            tags,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log('[bridge] Joke saved:', ref.id);
        return { success: true, jokeId: ref.id, message: 'Saved!' };
    } catch (err) {
        console.error('[bridge] Save error:', err);
        return { error: 'Failed: ' + err.message };
    }
}

function initSaveModal() {
    const modal = document.getElementById('save-modal');
    const form = document.getElementById('save-joke-form');
    const contentEl = document.getElementById('save-joke-content');
    const tagsEl = document.getElementById('save-joke-tags');
    const closeBtn = document.getElementById('save-modal-close');
    const cancelBtn = document.getElementById('save-modal-cancel');

    if (!modal || !form) return;

    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = contentEl.value.trim();
        const tags = tagsEl.value.split(',').map(t => t.trim()).filter(Boolean);
        if (!content) return;

        const result = await saveJokeToFirestore({ content, tags: tags.length ? tags : ['untagged'] });
        if (result.success) {
            appendMessage('tool', '✅ Joke saved to Bitbinder!');
            modal.classList.add('hidden');
            contentEl.value = '';
            tagsEl.value = '';
        } else {
            alert('Error: ' + result.error);
        }
    });

    // Expose for save buttons
    window.openSaveModal = function (text) {
        contentEl.value = text || '';
        tagsEl.value = '';
        modal.classList.remove('hidden');
        contentEl.focus();
    };
}

// ===================================
// DOM helpers
// ===================================

function appendMessage(role, content, returnEl = false) {
    if (!messagesArea) messagesArea = document.getElementById('messages-area');
    if (!messagesArea) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'message ' + role + '-message';

    // Add speaker label for user/assistant
    if (role === 'user' || role === 'assistant') {
        const label = document.createElement('span');
        label.className = 'message-label';
        label.textContent = role === 'user' ? 'You' : 'Bit Builder';
        wrapper.appendChild(label);
    }

    const body = document.createElement('div');
    body.className = 'message-body';

    if (role === 'assistant') {
        setBubbleHTML(body, content);
        wrapper.appendChild(body);
        // Add a save button to agent messages
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-save-joke';
        saveBtn.innerHTML = '<i class="fas fa-bookmark"></i> Save';
        saveBtn.title = 'Save to Bitbinder';
        saveBtn.addEventListener('click', () => {
            window.openSaveModal(body.textContent.trim());
        });
        wrapper.appendChild(saveBtn);
    } else {
        body.textContent = content;
        wrapper.appendChild(body);
    }

    messagesArea.appendChild(wrapper);
    messagesArea.scrollTop = messagesArea.scrollHeight;

    return returnEl ? wrapper : wrapper;
}

function setBubbleHTML(el, text) {
    // Preserve save button if present (for live-updating agent bubbles)
    el.innerHTML = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    if (messagesArea) messagesArea.scrollTop = messagesArea.scrollHeight;
}

// ===================================
// Start
// ===================================

init();
