// ===================================
// Text Chat — type-to-agent via authenticated WebSocket
//
// Gets a signed WebSocket URL from the getSignedUrl Cloud Function,
// then connects to the ElevenLabs agent for text-based chat.
// Also handles client tool calls (save_joke → Firestore).
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

// WebSocket state
let ws = null;
let conversationId = null;
let connected = false;
let waitingForAgent = false;
let currentResponseEl = null;
let currentResponseText = '';
let finalizeTimer = null;

// DOM references
let messagesArea, messageInput, sendBtn, chatForm;

// ===================================
// Wait for Firebase, then initialize
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

    if (!chatForm) {
        setTimeout(init, 100);
        return;
    }

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            console.log('[text-chat] User authenticated:', user.uid);
        }
        // Reset connection when user changes
        if (ws) {
            ws.close();
            ws = null;
            connected = false;
        }
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    console.log('[text-chat] Initialized');
}

// ===================================
// Get signed WebSocket URL from Cloud Function
// ===================================

async function getSignedUrl() {
    const getSignedUrlFn = httpsCallable(functions, 'getSignedUrl');
    const result = await getSignedUrlFn();
    return result.data.signedUrl;
}

// ===================================
// WebSocket connection to agent
// ===================================

const AGENT_ID = 'agent_7401ka31ry6qftr9ab89em3339w9';
const DIRECT_WS_URL = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;

async function connectToAgent() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        return;
    }

    // Try signed URL first, fall back to direct connection
    let wsUrl;
    try {
        console.log('[text-chat] Getting signed URL...');
        const signedUrl = await getSignedUrl();
        wsUrl = signedUrl;
        console.log('[text-chat] Got signed URL');
    } catch (err) {
        console.warn('[text-chat] Signed URL unavailable, using direct connection:', err.message);
        wsUrl = DIRECT_WS_URL;
    }

    console.log('[text-chat] Connecting WebSocket...');

    return new Promise((resolve, reject) => {
        ws = new WebSocket(wsUrl);

        const timeout = setTimeout(() => {
            if (!connected) {
                ws.close();
                reject(new Error('Connection timed out. Please try again.'));
            }
        }, 15000);

        ws.onopen = () => {
            console.log('[text-chat] WebSocket connected');
            // Send config override with system prompt
            ws.send(JSON.stringify({
                type: 'conversation_initiation_client_data',
                conversation_config_override: {
                    agent: {
                        prompt: {
                            prompt: 'You are Bit Builder, an AI comedy writing assistant. You help users create, develop, and refine comedy material. You\'re witty, supportive, and knowledgeable about comedy writing techniques.\n\nIMPORTANT: You have a tool called save_joke that saves jokes to the user\'s Bitbinder (their personal joke collection). When you and the user agree on a joke that\'s ready to save, call the save_joke tool with:\n- content: the final joke text\n- tags: an array of relevant tags (e.g. ["pun", "short"], ["observational", "relatable"])\n\nAlways offer to save good jokes. If the user asks to save a joke, use the save_joke tool immediately.\n\nYou are in TEXT CHAT mode. Keep responses concise and well-formatted. Use emojis occasionally.'
                        },
                        first_message: null,
                        language: 'en'
                    }
                }
            }));
        };

        ws.onmessage = (event) => {
            const msgType = handleWSMessage(event);

            // Resolve on metadata (first message from server)
            if (!connected && msgType === 'metadata') {
                connected = true;
                clearTimeout(timeout);
                resolve();
            }
        };

        ws.onerror = (err) => {
            console.error('[text-chat] WebSocket error:', err);
            clearTimeout(timeout);
            if (!connected) {
                reject(new Error('Could not connect to agent. Please try again.'));
            }
        };

        ws.onclose = (event) => {
            console.log('[text-chat] WebSocket closed:', event.code, event.reason);
            connected = false;
            ws = null;
            conversationId = null;
            if (waitingForAgent) {
                waitingForAgent = false;
                setInputEnabled(true);
            }
        };
    });
}

// ===================================
// Handle incoming WebSocket messages
// ===================================

function handleWSMessage(event) {
    let data;
    try {
        data = JSON.parse(event.data);
    } catch {
        return null; // binary audio frame
    }

    console.log('[text-chat] Received:', data.type, JSON.stringify(data).slice(0, 300));

    switch (data.type) {
        case 'conversation_initiation_metadata': {
            const meta = data.conversation_initiation_metadata_event || data;
            conversationId = meta.conversation_id;
            console.log('[text-chat] Conversation ID:', conversationId);
            return 'metadata';
        }

        case 'agent_response': {
            const resp = data.agent_response_event || data;
            const text = resp.agent_response || '';
            if (text) {
                if (!currentResponseEl) {
                    currentResponseEl = createResponseBubble();
                    currentResponseText = '';
                }
                currentResponseText = text;
                updateResponseBubble(currentResponseEl, currentResponseText);
                scheduleFinalize();
            }
            return 'agent_response';
        }

        case 'agent_response_correction': {
            const resp = data.agent_response_correction_event || data;
            const text = resp.agent_response || resp.agent_response_correction || '';
            if (text && currentResponseEl) {
                currentResponseText = text;
                updateResponseBubble(currentResponseEl, currentResponseText);
                scheduleFinalize();
            }
            return 'correction';
        }

        case 'audio':
            // Ignore audio in text mode — reset finalize timer
            if (currentResponseEl) scheduleFinalize();
            return 'audio';

        case 'ping': {
            const pingEvent = data.ping_event || data;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'pong',
                    event_id: pingEvent.event_id
                }));
            }
            return 'ping';
        }

        case 'client_tool_call':
            handleToolCall(data.client_tool_call || data);
            return 'tool_call';

        case 'user_transcript':
            return 'transcript';

        case 'interruption':
            finalizeResponse();
            return 'interruption';

        case 'internal_tentative_agent_response':
            return 'tentative';

        case 'vad_score':
            return 'vad';

        default:
            console.log('[text-chat] Unhandled:', data.type);
            return data.type;
    }
}

// ===================================
// Response bubble helpers
// ===================================

function createResponseBubble() {
    const div = document.createElement('div');
    div.className = 'message assistant-message';
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return div;
}

function updateResponseBubble(el, text) {
    el.innerHTML = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function scheduleFinalize() {
    clearTimeout(finalizeTimer);
    finalizeTimer = setTimeout(() => {
        if (currentResponseEl) finalizeResponse();
    }, 3000);
}

function finalizeResponse() {
    clearTimeout(finalizeTimer);
    currentResponseEl = null;
    currentResponseText = '';
    waitingForAgent = false;
    setInputEnabled(true);
}

// ===================================
// Send a text message
// ===================================

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (!currentUser) {
        appendMsg('system', '⚠️ Please log in to chat.');
        return;
    }

    appendMsg('user', text);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    setInputEnabled(false);
    waitingForAgent = true;

    try {
        // Connect if needed
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            const connectingMsg = appendMsg('system', '🔄 Connecting to Bit Builder...');
            try {
                await connectToAgent();
                connectingMsg.remove();
            } catch (err) {
                connectingMsg.remove();
                throw err;
            }
        }

        // Send user text (ElevenLabs ConvAI expects just { text })
        ws.send(JSON.stringify({ text }));
        console.log('[text-chat] Sent text input:', text);

        // Safety timeout
        setTimeout(() => {
            if (waitingForAgent && !currentResponseEl) {
                finalizeResponse();
                appendMsg('system', '⚠️ No response from agent. Try sending again.');
            }
        }, 30000);

    } catch (error) {
        console.error('[text-chat] Error:', error);
        waitingForAgent = false;
        setInputEnabled(true);
        appendMsg('system', '❌ ' + (error.message || 'Failed to connect. Please try again.'));
    }
}

// ===================================
// Client tool calls (save_joke)
// ===================================

async function handleToolCall(call) {
    const { tool_name, tool_call_id, parameters } = call;
    console.log('[text-chat] Tool call:', tool_name, parameters);

    let result;
    let isError = false;

    if (tool_name === 'save_joke') {
        result = await saveJoke(parameters);
        if (result.error) isError = true;
    } else {
        result = { error: 'Unknown tool: ' + tool_name };
        isError = true;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'client_tool_result',
            tool_call_id: tool_call_id,
            result: typeof result === 'string' ? result : JSON.stringify(result),
            is_error: isError
        }));
    }

    appendMsg('tool', isError
        ? '❌ ' + (result.error || 'Tool call failed')
        : '✅ Joke saved to Bitbinder!'
    );
}

async function saveJoke(params) {
    if (!currentUser) return { error: 'Not authenticated' };

    const content = params.content || params.joke || '';
    let tags = params.tags || [];
    if (typeof tags === 'string') tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (!content) return { error: 'Joke content is required' };
    if (!Array.isArray(tags) || tags.length === 0) tags = ['untagged'];

    try {
        const jokeRef = await addDoc(collection(db, 'jokes'), {
            userId: currentUser.uid,
            content,
            tags,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log('[text-chat] Joke saved:', jokeRef.id);
        return { success: true, jokeId: jokeRef.id };
    } catch (error) {
        console.error('[text-chat] Error saving joke:', error);
        return { error: 'Failed to save joke: ' + error.message };
    }
}

// ===================================
// UI Helpers
// ===================================

function appendMsg(role, content) {
    const div = document.createElement('div');
    div.className = 'message ' + role + '-message';
    if (role === 'user') {
        div.textContent = content;
    } else {
        div.textContent = content;
    }
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return div;
}

function setInputEnabled(enabled) {
    if (messageInput) messageInput.disabled = !enabled;
    if (sendBtn) {
        sendBtn.disabled = !enabled;
        sendBtn.textContent = enabled ? 'Send' : '...';
    }
}

// ===================================
// Start
// ===================================

init();
