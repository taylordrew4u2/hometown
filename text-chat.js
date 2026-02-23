// ===================================
// Text Chat — type-to-agent via WebSocket
//
// Connects directly to the ElevenLabs Conversational AI
// agent over WebSocket for text-based chat.
// Also handles client tool calls (save_joke → Firestore).
// ===================================

import {
    collection,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const AGENT_ID = 'agent_7401ka31ry6qftr9ab89em3339w9';
const WS_BASE = 'wss://api.elevenlabs.io/v1/convai/conversation';

let auth, db;
let currentUser = null;

// WebSocket state
let ws = null;
let conversationId = null;
let connected = false;

// Tracks whether we're waiting for the agent to finish responding
let agentResponding = false;
let currentResponseEl = null;
let currentResponseText = '';

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
    });

    // Wire up the form
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

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    console.log('[text-chat] Initialized');
}

// ===================================
// WebSocket connection to agent
// ===================================

function connectToAgent() {
    return new Promise((resolve, reject) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }

        const url = `${WS_BASE}?agent_id=${AGENT_ID}`;
        console.log('[text-chat] Connecting to agent...');

        ws = new WebSocket(url);

        ws.onopen = () => {
            console.log('[text-chat] WebSocket connected');
            // Send initial config override with system prompt
            ws.send(JSON.stringify({
                type: 'conversation_initiation_client_data',
                conversation_config_override: {
                    agent: {
                        prompt: {
                            prompt: 'You are Bit Builder, an AI comedy writing assistant. You help users create, develop, and refine comedy material. You\'re witty, supportive, and knowledgeable about comedy writing techniques.\n\nIMPORTANT: You have a tool called save_joke that saves jokes to the user\'s Bitbinder (their personal joke collection). When you and the user agree on a joke that\'s ready to save, call the save_joke tool with:\n- content: the final joke text\n- tags: an array of relevant tags (e.g. ["pun", "short"], ["observational", "relatable"])\n\nAlways offer to save good jokes. If the user asks to save a joke, use the save_joke tool immediately.\n\nYou are in TEXT CHAT mode. Keep responses concise and well-formatted. Use emojis occasionally (😂 🎭 💡).'
                        },
                        first_message: 'Hey! 🎭 I\'m Bit Builder, your comedy writing assistant. What are we working on today?'
                    }
                }
            }));
        };

        ws.onmessage = (event) => {
            handleWSMessage(event);
            // Resolve on first successful metadata
            if (!connected) {
                connected = true;
                resolve();
            }
        };

        ws.onerror = (err) => {
            console.error('[text-chat] WebSocket error:', err);
            if (!connected) {
                reject(new Error('Failed to connect to agent'));
            }
        };

        ws.onclose = (event) => {
            console.log('[text-chat] WebSocket closed:', event.code, event.reason);
            connected = false;
            ws = null;
            conversationId = null;
            if (agentResponding) {
                agentResponding = false;
                setInputEnabled(true);
            }
        };

        // Timeout
        setTimeout(() => {
            if (!connected) {
                ws?.close();
                reject(new Error('Connection timed out'));
            }
        }, 15000);
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
        return; // ignore non-JSON (binary audio)
    }

    console.log('[text-chat] Received:', data.type);

    switch (data.type) {
        case 'conversation_initiation_metadata': {
            const meta = data.conversation_initiation_metadata_event || data;
            conversationId = meta.conversation_id;
            console.log('[text-chat] Conversation ID:', conversationId);
            break;
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
                // Auto-finalize after 2s of no new response chunks
                scheduleFinalize();
            }
            break;
        }

        case 'agent_response_correction': {
            // Agent corrected its previous response
            const resp = data.agent_response_correction_event || data;
            const text = resp.agent_response || resp.agent_response_correction || '';
            if (text && currentResponseEl) {
                currentResponseText = text;
                updateResponseBubble(currentResponseEl, currentResponseText);
            }
            break;
        }

        case 'audio': {
            // Ignore audio — we're in text mode
            // But the presence of audio means agent is still responding
            break;
        }

        case 'ping': {
            const pingEvent = data.ping_event || data;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'pong',
                    event_id: pingEvent.event_id
                }));
            }
            break;
        }

        case 'client_tool_call': {
            const call = data.client_tool_call || data;
            handleToolCall(call);
            break;
        }

        case 'user_transcript': {
            // Server echo of our text — ignore
            break;
        }

        case 'interruption': {
            // Finalize current response
            finalizeResponse();
            break;
        }

        case 'internal_tentative_agent_response': {
            // Tentative — we can show as "thinking" but skip for now
            break;
        }

        default:
            console.log('[text-chat] Unhandled message type:', data.type);
    }
}

// ===================================
// Agent response bubble helpers
// ===================================

function createResponseBubble() {
    const div = document.createElement('div');
    div.className = 'message assistant-message';
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return div;
}

function updateResponseBubble(el, text) {
    const formatted = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    el.innerHTML = formatted;
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function finalizeResponse() {
    // Finish the current response bubble
    currentResponseEl = null;
    currentResponseText = '';
    agentResponding = false;
    setInputEnabled(true);
}

// ===================================
// Send a text message
// ===================================

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (!currentUser) {
        appendSystemMessage('⚠️ Please log in to chat.');
        return;
    }

    // Show user message
    appendUserMessage(text);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    setInputEnabled(false);
    agentResponding = true;

    try {
        // Connect if not already connected
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            appendSystemMessage('Connecting to agent...');
            await connectToAgent();
            // Remove the "connecting" message
            const msgs = messagesArea.querySelectorAll('.system-message');
            const last = msgs[msgs.length - 1];
            if (last && last.textContent.includes('Connecting')) {
                last.remove();
            }
        }

        // Send the text message
        ws.send(JSON.stringify({
            type: 'user_message',
            text: text
        }));

        // Agent will respond via handleWSMessage → agent_response events
        // Set a timeout in case agent never responds
        setTimeout(() => {
            if (agentResponding && !currentResponseEl) {
                // No response started after 30s
                finalizeResponse();
                appendSystemMessage('⚠️ Agent didn\'t respond. Try again.');
            }
        }, 30000);

    } catch (error) {
        console.error('[text-chat] Error:', error);
        agentResponding = false;
        setInputEnabled(true);
        appendSystemMessage(`❌ ${error.message || 'Failed to connect. Please try again.'}`);
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
        result = { error: `Unknown tool: ${tool_name}` };
        isError = true;
    }

    // Send result back to agent
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'client_tool_result',
            tool_call_id: tool_call_id,
            result: typeof result === 'string' ? result : JSON.stringify(result),
            is_error: isError
        }));
    }

    // Show tool result in chat
    if (!isError) {
        appendToolMessage(`✅ Joke saved to Bitbinder!`);
    } else {
        appendToolMessage(`❌ ${result.error || 'Tool call failed'}`);
    }
}

async function saveJoke(params) {
    if (!currentUser) {
        return { error: 'Not authenticated' };
    }

    const content = params.content || params.joke || '';
    let tags = params.tags || [];

    if (typeof tags === 'string') {
        tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    if (!content) {
        return { error: 'Joke content is required' };
    }
    if (!Array.isArray(tags) || tags.length === 0) {
        tags = ['untagged'];
    }

    try {
        const jokeRef = await addDoc(collection(db, 'jokes'), {
            userId: currentUser.uid,
            content: content,
            tags: tags,
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

function appendUserMessage(content) {
    const div = document.createElement('div');
    div.className = 'message user-message';
    div.textContent = content;
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function appendSystemMessage(content) {
    const div = document.createElement('div');
    div.className = 'message system-message';
    div.textContent = content;
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function appendToolMessage(content) {
    const div = document.createElement('div');
    div.className = 'message tool-message';
    div.textContent = content;
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function setInputEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    sendBtn.textContent = enabled ? 'Send' : '...';
}

// ===================================
// Allow manual finalize when user sends next message
// (in case the agent finished but we didn't detect it)
// ===================================

// If user starts typing, finalize any stale response
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('message-input');
    if (input) {
        input.addEventListener('focus', () => {
            if (currentResponseEl && !agentResponding) {
                finalizeResponse();
            }
        });
    }
});

// ===================================
// Auto-finalize: if no new agent_response for 2s, consider done
// ===================================

let finalizeTimer = null;

function scheduleFinalize() {
    clearTimeout(finalizeTimer);
    finalizeTimer = setTimeout(() => {
        if (currentResponseEl) {
            finalizeResponse();
        }
    }, 2000);
}

// ===================================
// Start
// ===================================

init();
