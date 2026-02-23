// ===================================
// Agent Bridge — Unified voice + text + save
//
// 1. Wires up the ElevenLabs voice widget (tool calls + transcript)
// 2. Provides text-chat via its own WebSocket to the same agent
// 3. Manual "Save to Bitbinder" on any message
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

// DOM
let messagesArea, messageInput, sendBtn, chatForm;

// Text-chat WebSocket state
let ws = null;
let wsConnected = false;
let waitingForAgent = false;
let currentResponseEl = null;
let currentResponseText = '';
let finalizeTimer = null;

// Voice transcript state
let currentAgentBubble = null;
let currentAgentText = '';
let currentUserBubble = null;
let voiceActive = false;

const AGENT_ID = 'agent_7401ka31ry6qftr9ab89em3339w9';

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
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    chatForm = document.getElementById('text-chat-form');

    if (!chatForm || !messagesArea) {
        setTimeout(init, 100);
        return;
    }

    // Text input handlers
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendTextMessage();
    });
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendTextMessage();
        }
    });
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    // Tap / focus on input area should always re‑enable typing
    const inputArea = document.querySelector('.input-area');
    if (inputArea) {
        inputArea.addEventListener('click', () => {
            if (!waitingForAgent) setInputEnabled(true);
            messageInput.focus();
        });
        inputArea.addEventListener('touchstart', () => {
            if (!waitingForAgent) setInputEnabled(true);
            messageInput.focus();
        }, { passive: true });
    }

    // Clear button
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            messagesArea.innerHTML = '';
        });
    }

    // Save modal wiring
    initSaveModal();

    // Auth listener
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            console.log('[bridge] User:', user.uid);
            wireVoiceWidget();
        }
        if (ws) { ws.close(); ws = null; wsConnected = false; }
    });

    console.log('[bridge] Initialized');
}

// ===================================
// 1. VOICE WIDGET — tool registration + WebSocket transcript
// ===================================

function wireVoiceWidget() {
    const widget = document.querySelector('elevenlabs-convai');
    if (!widget) {
        setTimeout(wireVoiceWidget, 300);
        return;
    }

    // Try to register save_joke client tool on the widget
    function tryRegister() {
        if (typeof widget.registerClientTool === 'function') {
            widget.registerClientTool('save_joke', async (params) => {
                console.log('[bridge] Widget save_joke:', params);
                const result = await saveJokeToFirestore(params);
                if (result.success) {
                    appendMessage('tool', '✅ Joke saved to Bitbinder!');
                } else {
                    appendMessage('tool', '❌ ' + (result.error || 'Save failed'));
                }
                return result;
            });
            console.log('[bridge] Registered save_joke on widget');
            return true;
        }
        return false;
    }

    if (!tryRegister()) {
        widget.addEventListener('elevenlabs-convai:ready', tryRegister);
        let attempts = 0;
        const poll = setInterval(() => {
            if (tryRegister() || ++attempts > 50) clearInterval(poll);
        }, 300);
    }

    // Catch-all tool call event
    widget.addEventListener('elevenlabs-convai:call', async (e) => {
        const { tool_name, parameters, callback } = e.detail || {};
        if (tool_name === 'save_joke') {
            const result = await saveJokeToFirestore(parameters);
            if (result.success) appendMessage('tool', '✅ Joke saved to Bitbinder!');
            if (typeof callback === 'function') callback(result);
        }
    });

    // Intercept WebSocket for live transcript
    interceptWebSocket();

    console.log('[bridge] Voice widget wired');
}

// ===================================
// Intercept WebSocket for voice transcripts
// ===================================

const OriginalWebSocket = window.WebSocket;

function interceptWebSocket() {
    if (window.__wsIntercepted) return;
    window.__wsIntercepted = true;

    window.WebSocket = function (url, protocols) {
        const sock = protocols
            ? new OriginalWebSocket(url, protocols)
            : new OriginalWebSocket(url);

        if (typeof url === 'string' && url.includes('elevenlabs.io')) {
            console.log('[bridge] Intercepted ElevenLabs WS');

            sock.addEventListener('message', (event) => {
                try {
                    handleVoiceMessage(JSON.parse(event.data));
                } catch { /* binary audio */ }
            });

            sock.addEventListener('open', () => {
                voiceActive = true;
                appendMessage('system', '🎤 Voice connected');
            });

            sock.addEventListener('close', () => {
                voiceActive = false;
                appendMessage('system', '🔇 Voice ended');
                currentAgentBubble = null;
                currentAgentText = '';
                currentUserBubble = null;
                // Re‑enable text input when voice call ends
                if (!waitingForAgent) setInputEnabled(true);
            });
        }

        return sock;
    };

    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
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
            // Voice widget tool call came through WebSocket directly
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
// 2. TEXT CHAT — own WebSocket to ElevenLabs agent
// ===================================

async function getSignedUrl() {
    const fn = httpsCallable(functions, 'getSignedUrl');
    const result = await fn();
    return result.data.signedUrl;
}

async function connectTextWS() {
    if (ws && ws.readyState === OriginalWebSocket.OPEN) return;

    let wsUrl;
    try {
        wsUrl = await getSignedUrl();
        console.log('[bridge] Got signed URL for text chat');
    } catch (err) {
        console.warn('[bridge] Signed URL failed, using direct:', err.message);
        wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
    }

    return new Promise((resolve, reject) => {
        // Use ORIGINAL WebSocket so the interceptor doesn't capture this one
        ws = new OriginalWebSocket(wsUrl);

        const timeout = setTimeout(() => {
            if (!wsConnected) { ws.close(); reject(new Error('Connection timed out')); }
        }, 15000);

        ws.onopen = () => {
            console.log('[bridge] Text WS open');
            ws.send(JSON.stringify({
                type: 'conversation_initiation_client_data',
                conversation_config_override: {
                    agent: {
                        prompt: {
                            prompt: 'You are Bit Builder, an AI comedy writing assistant. You help users create, develop, and refine comedy material. You\'re witty, supportive, and knowledgeable about comedy writing techniques. Keep responses concise and well-formatted. Use emojis occasionally.'
                        },
                        first_message: null,
                        language: 'en'
                    }
                }
            }));
        };

        ws.onmessage = (event) => {
            const msgType = handleTextWSMessage(event);
            if (!wsConnected && msgType === 'metadata') {
                wsConnected = true;
                clearTimeout(timeout);
                resolve();
            }
        };

        ws.onerror = (err) => {
            console.error('[bridge] Text WS error:', err);
            clearTimeout(timeout);
            if (!wsConnected) reject(new Error('Could not connect'));
        };

        ws.onclose = () => {
            console.log('[bridge] Text WS closed');
            wsConnected = false;
            ws = null;
            if (waitingForAgent) { waitingForAgent = false; setInputEnabled(true); }
        };
    });
}

function handleTextWSMessage(event) {
    let data;
    try { data = JSON.parse(event.data); } catch { return null; }

    console.log('[bridge] Text WS:', data.type);

    switch (data.type) {
        case 'conversation_initiation_metadata':
            return 'metadata';

        case 'agent_response': {
            const text = (data.agent_response_event || data).agent_response || '';
            if (text) {
                if (!currentResponseEl) {
                    currentResponseEl = appendMessage('assistant', '', true);
                    currentResponseText = '';
                }
                currentResponseText = text;
                setBubbleHTML(currentResponseEl, currentResponseText);
                scheduleFinalize();
            }
            return 'agent_response';
        }

        case 'agent_response_correction': {
            const text = (data.agent_response_correction_event || data).agent_response
                || (data.agent_response_correction_event || data).agent_response_correction || '';
            if (text && currentResponseEl) {
                currentResponseText = text;
                setBubbleHTML(currentResponseEl, currentResponseText);
                scheduleFinalize();
            }
            return 'correction';
        }

        case 'audio':
            if (currentResponseEl) scheduleFinalize();
            return 'audio';

        case 'ping': {
            const pingEvt = data.ping_event || data;
            if (ws && ws.readyState === OriginalWebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'pong', event_id: pingEvt.event_id }));
            }
            return 'ping';
        }

        case 'client_tool_call': {
            const call = data.client_tool_call || data;
            handleTextToolCall(call);
            return 'tool_call';
        }

        default:
            return data.type;
    }
}

async function handleTextToolCall(call) {
    const { tool_name, tool_call_id, parameters } = call;
    let result, isError = false;

    if (tool_name === 'save_joke') {
        result = await saveJokeToFirestore(parameters);
        if (result.error) isError = true;
    } else {
        result = { error: 'Unknown tool: ' + tool_name };
        isError = true;
    }

    if (ws && ws.readyState === OriginalWebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'client_tool_result',
            tool_call_id,
            result: JSON.stringify(result),
            is_error: isError
        }));
    }

    appendMessage('tool', isError
        ? '❌ ' + (result.error || 'Tool failed')
        : '✅ Joke saved to Bitbinder!'
    );
}

function scheduleFinalize() {
    clearTimeout(finalizeTimer);
    finalizeTimer = setTimeout(() => {
        if (currentResponseEl) {
            currentResponseEl = null;
            currentResponseText = '';
            waitingForAgent = false;
            setInputEnabled(true);
        }
    }, 1500);
}

async function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    if (!currentUser) { appendMessage('system', '⚠️ Please log in first.'); return; }

    appendMessage('user', text);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    setInputEnabled(false);
    waitingForAgent = true;

    try {
        if (!ws || ws.readyState !== OriginalWebSocket.OPEN) {
            const msg = appendMessage('system', '🔄 Connecting...');
            await connectTextWS();
            msg.remove();
        }
        ws.send(JSON.stringify({ text }));
        console.log('[bridge] Sent:', text);

        setTimeout(() => {
            if (waitingForAgent && !currentResponseEl) {
                waitingForAgent = false;
                setInputEnabled(true);
                appendMessage('system', '⚠️ No response. Try again.');
            }
        }, 30000);
    } catch (err) {
        console.error('[bridge] Send error:', err);
        waitingForAgent = false;
        setInputEnabled(true);
        appendMessage('system', '❌ ' + (err.message || 'Connection failed'));
    }
}

// ===================================
// 3. SAVE TO BITBINDER — direct Firestore write + manual UI
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

    if (role === 'assistant') {
        setBubbleHTML(wrapper, content);
        // Add a save button to agent messages
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-save-joke';
        saveBtn.textContent = '💾 Save';
        saveBtn.title = 'Save to Bitbinder';
        saveBtn.addEventListener('click', () => {
            window.openSaveModal(wrapper.textContent.replace('💾 Save', '').trim());
        });
        wrapper.appendChild(saveBtn);
    } else {
        wrapper.textContent = content;
    }

    messagesArea.appendChild(wrapper);
    messagesArea.scrollTop = messagesArea.scrollHeight;

    return returnEl ? wrapper : wrapper;
}

function setBubbleHTML(el, text) {
    // Preserve save button if present
    const saveBtn = el.querySelector('.btn-save-joke');
    el.innerHTML = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    if (saveBtn) el.appendChild(saveBtn);
    if (messagesArea) messagesArea.scrollTop = messagesArea.scrollHeight;
}

function setInputEnabled(enabled) {
    if (messageInput) {
        messageInput.disabled = !enabled;
        // On mobile, removing disabled may not restore focus; nudge it
        if (enabled) messageInput.removeAttribute('disabled');
    }
    if (sendBtn) {
        sendBtn.disabled = !enabled;
        sendBtn.textContent = enabled ? 'Send' : '...';
    }
}

// ===================================
// Start
// ===================================

init();
