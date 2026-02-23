// ===================================
// Agent Bridge — connects ElevenLabs widget to Firebase
//
// Listens for tool-call events from the widget and
// executes them against Firestore using the logged-in user's auth.
// ===================================

import {
    collection,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let auth, db;
let currentUser = null;

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

    // Listen for client-tool-call events dispatched by the widget.
    // ElevenLabs Convai widget fires "elevenlabs-convai:call"
    // with detail { tool_name, parameters, callback }.
    widget.addEventListener('elevenlabs-convai:call', async (e) => {
        const { tool_name, parameters, callback } = e.detail || {};
        console.log('[agent-bridge] Tool call received:', tool_name, parameters);

        try {
            const result = await handleToolCall(tool_name, parameters);
            if (typeof callback === 'function') {
                callback(result);
            }
        } catch (err) {
            console.error('[agent-bridge] Tool call error:', err);
            if (typeof callback === 'function') {
                callback({ error: err.message });
            }
        }
    });

    // Also register via the widget's JS API if available
    if (typeof widget.registerClientTool === 'function') {
        widget.registerClientTool('save_joke', async (params) => {
            console.log('[agent-bridge] save_joke called via registerClientTool:', params);
            return await handleToolCall('save_joke', params);
        });
        console.log('[agent-bridge] Registered save_joke client tool on widget');
    } else {
        // Widget API may not be ready yet — retry after it loads
        widget.addEventListener('elevenlabs-convai:ready', () => {
            if (typeof widget.registerClientTool === 'function') {
                widget.registerClientTool('save_joke', async (params) => {
                    console.log('[agent-bridge] save_joke called via registerClientTool:', params);
                    return await handleToolCall('save_joke', params);
                });
                console.log('[agent-bridge] Registered save_joke client tool on widget (after ready)');
            }
        });
    }

    console.log('[agent-bridge] Widget wired up');
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
