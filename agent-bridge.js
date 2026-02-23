// ===================================
// Agent Bridge — connects ElevenLabs widget to Firebase
//
// Listens for tool-call events from the widget and
// executes them against Firestore using the logged-in user's auth.
// Also captures live transcripts from the voice conversation.
// ===================================

import {
    collection,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let auth, db;
let currentUser = null;

// Transcript state
let transcriptArea = null;
let currentAgentBubble = null;
let currentAgentText = '';
let currentUserBubble = null;

// ===================================
// Wait for Firebase to be ready, then wire up the widget
// ===================================

function init() {
    if (!window.firebaseApp) {
        setTimeout(init, 100);
        return;
    }

    auth = window.firebaseApp.auth;
    db = window.firebaseApp.db;

    transcriptArea = document.getElementById('voice-transcript');

    // Clear transcript button
    const clearBtn = document.getElementById('clear-transcript-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (transcriptArea) transcriptArea.innerHTML = '';
        });
    }

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            console.log('[agent-bridge] User authenticated:', user.uid);
            wireWidget();
        }
    });
}

// ===================================
// Connect to the ElevenLabs widget
// ===================================

function wireWidget() {
    // The widget may load after this script — poll until it exists
    const widget = document.querySelector('elevenlabs-convai');
    if (!widget) {
        setTimeout(wireWidget, 200);
        return;
    }

    // Register the save_joke tool so the agent can call it
    function registerTools() {
        if (typeof widget.registerClientTool === 'function') {
            widget.registerClientTool('save_joke', async (params) => {
                console.log('[agent-bridge] save_joke called:', params);
                const result = await handleToolCall('save_joke', params);
                // Show save confirmation in the transcript
                if (result.success) {
                    appendTranscript('tool', '✅ Joke saved to Bitbinder!');
                } else {
                    appendTranscript('tool', '❌ ' + (result.error || 'Failed to save joke'));
                }
                return result;
            });
            console.log('[agent-bridge] Registered save_joke client tool');
            return true;
        }
        return false;
    }

    // Try immediately
    if (!registerTools()) {
        // Widget not ready yet — listen for ready event and also poll
        widget.addEventListener('elevenlabs-convai:ready', () => {
            registerTools();
        });

        // Fallback poll in case the event doesn't fire
        let attempts = 0;
        const pollRegister = setInterval(() => {
            attempts++;
            if (registerTools() || attempts > 50) {
                clearInterval(pollRegister);
            }
        }, 300);
    }

    // Also listen for generic tool-call events as a catch-all
    widget.addEventListener('elevenlabs-convai:call', async (e) => {
        const { tool_name, parameters, callback } = e.detail || {};
        console.log('[agent-bridge] Tool call event:', tool_name, parameters);

        try {
            const result = await handleToolCall(tool_name, parameters);
            if (result.success) {
                appendTranscript('tool', '✅ Joke saved to Bitbinder!');
            }
            if (typeof callback === 'function') {
                callback(result);
            }
        } catch (err) {
            console.error('[agent-bridge] Tool call error:', err);
            appendTranscript('tool', '❌ ' + err.message);
            if (typeof callback === 'function') {
                callback({ error: err.message });
            }
        }
    });

    // ===================================
    // Intercept WebSocket for live transcript
    // ===================================
    interceptWidgetWebSocket(widget);

    console.log('[agent-bridge] Widget wired up, waiting for tool registration...');
}

// ===================================
// Intercept the widget's WebSocket to capture transcripts
// ===================================

function interceptWidgetWebSocket(widget) {
    // Monkey-patch WebSocket to capture the widget's connection
    const OriginalWebSocket = window.WebSocket;
    let intercepted = false;

    window.WebSocket = function(url, protocols) {
        const ws = protocols
            ? new OriginalWebSocket(url, protocols)
            : new OriginalWebSocket(url);

        // Only intercept ElevenLabs WebSocket connections
        if (typeof url === 'string' && url.includes('elevenlabs.io')) {
            console.log('[agent-bridge] Intercepted ElevenLabs WebSocket');
            intercepted = true;

            const origOnMessage = ws.onmessage;

            // Use addEventListener so we don't overwrite the widget's handler
            ws.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleTranscriptMessage(data);
                } catch {
                    // Binary audio frame, ignore
                }
            });

            // Restore original WebSocket after interception
            ws.addEventListener('open', () => {
                appendTranscript('system', '🎤 Voice session connected');
            });

            ws.addEventListener('close', () => {
                appendTranscript('system', '🔇 Voice session ended');
                currentAgentBubble = null;
                currentAgentText = '';
                currentUserBubble = null;
            });
        }

        return ws;
    };

    // Copy static properties
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
}

// ===================================
// Handle transcript messages from the WebSocket
// ===================================

function handleTranscriptMessage(data) {
    switch (data.type) {
        case 'user_transcript': {
            const evt = data.user_transcription_event || data;
            const text = evt.user_transcript || '';
            if (!text) break;

            if (evt.is_final) {
                // Final transcript — replace or create a finalized bubble
                if (currentUserBubble) {
                    currentUserBubble.textContent = text;
                    currentUserBubble.classList.remove('interim');
                    currentUserBubble = null;
                } else {
                    appendTranscript('user', text);
                }
            } else {
                // Interim — create or update a tentative bubble
                if (!currentUserBubble) {
                    currentUserBubble = appendTranscript('user', text, true);
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
                currentAgentBubble = appendTranscript('assistant', text, true);
                currentAgentText = text;
            } else {
                currentAgentText = text;
                updateBubbleHTML(currentAgentBubble, currentAgentText);
            }
            break;
        }

        case 'agent_response_correction': {
            const evt = data.agent_response_correction_event || data;
            const text = evt.agent_response || evt.agent_response_correction || '';
            if (text && currentAgentBubble) {
                currentAgentText = text;
                updateBubbleHTML(currentAgentBubble, currentAgentText);
            }
            break;
        }

        case 'interruption':
            // Agent was interrupted — finalize current bubble
            if (currentAgentBubble) {
                currentAgentBubble = null;
                currentAgentText = '';
            }
            break;

        case 'turn_end':
        case 'end_of_turn':
            // Finalize any open bubbles
            currentAgentBubble = null;
            currentAgentText = '';
            currentUserBubble = null;
            break;
    }
}

// ===================================
// Transcript DOM helpers
// ===================================

function appendTranscript(role, content, returnEl = false) {
    if (!transcriptArea) {
        transcriptArea = document.getElementById('voice-transcript');
    }
    if (!transcriptArea) return null;

    const div = document.createElement('div');
    div.className = 'message ' + role + '-message';

    if (role === 'assistant') {
        updateBubbleHTML(div, content);
    } else {
        div.textContent = content;
    }

    transcriptArea.appendChild(div);
    transcriptArea.scrollTop = transcriptArea.scrollHeight;

    if (returnEl) return div;
    return div;
}

function updateBubbleHTML(el, text) {
    el.innerHTML = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    if (transcriptArea) {
        transcriptArea.scrollTop = transcriptArea.scrollHeight;
    }
}

// ===================================
// Handle tool calls
// ===================================

async function handleToolCall(toolName, params) {
    if (toolName === 'save_joke') {
        return await saveJoke(params);
    }
    return { error: `Unknown tool: ${toolName}` };
}

// ===================================
// save_joke — write directly to Firestore
// ===================================

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

        console.log('[agent-bridge] Joke saved:', jokeRef.id);
        return {
            success: true,
            message: `Joke saved to Bitbinder! (${jokeRef.id})`,
            jokeId: jokeRef.id
        };
    } catch (error) {
        console.error('[agent-bridge] Error saving joke:', error);
        return { error: 'Failed to save joke: ' + error.message };
    }
}

// ===================================
// Start
// ===================================

init();
