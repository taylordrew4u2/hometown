// ===================================
// Bit Builder - Dashboard Chat Logic
// ===================================

import { 
    collection, 
    addDoc, 
    query, 
    where, 
    orderBy, 
    onSnapshot,
    serverTimestamp,
    doc,
    getDoc
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

const { auth, db, functions } = window.firebaseApp;

let currentConversationId = null;
let messagesUnsubscribe = null;
let speechRecognition = null;
let isListening = false;

// Elements
const messagesArea = document.getElementById('messages-area');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const loadingIndicator = document.getElementById('loading-indicator');
const voiceStatus = document.getElementById('voice-status');
const bitbinderBtn = document.getElementById('bitbinder-btn');
const backBtn = document.getElementById('back-btn');

// ===================================
// Initialize
// ===================================

document.addEventListener('DOMContentLoaded', async () => {
    // Load or create conversation
    await initializeConversation();

    // Set up event listeners
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    voiceBtn.addEventListener('click', toggleVoiceRecording);
    bitbinderBtn.addEventListener('click', () => {
        window.location.href = 'binder.html';
    });

    // Initialize speech recognition if available
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        speechRecognition = new SpeechRecognition();
        speechRecognition.continuous = false;
        speechRecognition.interimResults = false;
        speechRecognition.lang = 'en-US';

        speechRecognition.onstart = () => {
            isListening = true;
            voiceBtn.classList.add('recording');
            voiceStatus.textContent = 'Listening...';
            voiceStatus.classList.remove('hidden');
        };

        speechRecognition.onend = () => {
            isListening = false;
            voiceBtn.classList.remove('recording');
            voiceStatus.classList.add('hidden');
        };

        speechRecognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            if (event.isFinal) {
                messageInput.value = transcript;
                sendMessage();
            }
        };

        speechRecognition.onerror = (event) => {
            console.error('Speech recognition error', event.error);
            voiceStatus.textContent = 'Error: ' + event.error;
        };
    } else {
        voiceBtn.style.display = 'none';
    }
});

// ===================================
// Initialize Conversation
// ===================================

async function initializeConversation() {
    const user = auth.currentUser;
    if (!user) return;

    // Try to get existing conversation from sessionStorage
    currentConversationId = sessionStorage.getItem('conversationId');

    if (!currentConversationId) {
        // Create a new conversation
        try {
            const conversationRef = await addDoc(collection(db, 'conversations'), {
                userId: user.uid,
                startedAt: serverTimestamp()
            });
            currentConversationId = conversationRef.id;
            sessionStorage.setItem('conversationId', currentConversationId);
        } catch (error) {
            console.error('Error creating conversation:', error);
        }
    }

    // Listen to messages in real-time
    setupMessagesListener();
}

// ===================================
// Real-time Messages Listener
// ===================================

function setupMessagesListener() {
    if (!currentConversationId || !auth.currentUser) return;

    // Unsubscribe from previous listener if exists
    if (messagesUnsubscribe) {
        messagesUnsubscribe();
    }

    const messagesQuery = query(
        collection(db, 'conversations', currentConversationId, 'messages'),
        orderBy('timestamp', 'asc')
    );

    messagesUnsubscribe = onSnapshot(messagesQuery, (snapshot) => {
        renderMessages(snapshot.docs);
        // Scroll to bottom
        setTimeout(() => {
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }, 0);
    });
}

// ===================================
// Send Message
// ===================================

async function sendMessage() {
    const message = messageInput.value.trim();
    
    if (!message || !currentConversationId) return;

    messageInput.value = '';
    loadingIndicator.classList.remove('hidden');

    try {
        // Call the Cloud Function
        const chatWithAgent = httpsCallable(functions, 'chatWithAgent');
        const response = await chatWithAgent({
            message: message,
            conversationId: currentConversationId
        });

        console.log('Assistant response:', response.data);
        // Messages will be displayed via the real-time listener
    } catch (error) {
        console.error('Error calling chatWithAgent:', error);
        
        // Show error message in chat
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message error-message';
        errorDiv.textContent = 'Error: ' + (error.message || 'Failed to get response');
        messagesArea.appendChild(errorDiv);
        messagesArea.scrollTop = messagesArea.scrollHeight;
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

// ===================================
// Voice Recording Toggle
// ===================================

function toggleVoiceRecording() {
    if (!speechRecognition) return;

    if (isListening) {
        speechRecognition.stop();
    } else {
        speechRecognition.start();
    }
}

// ===================================
// Render Messages
// ===================================

function renderMessages(docs) {
    messagesArea.innerHTML = '';

    docs.forEach((doc) => {
        const message = doc.data();
        const messageEl = createMessageElement(message);
        messagesArea.appendChild(messageEl);
    });
}

function createMessageElement(message) {
    const div = document.createElement('div');
    const roleClass = message.role === 'user' ? 'user-message' : 'assistant-message';
    div.className = `message ${roleClass}`;

    // For tool messages, use a different style
    if (message.role === 'tool') {
        div.className = 'message tool-message';
        div.innerHTML = `<strong>[System]</strong> ${escapeHtml(message.content)}`;
    } else {
        div.textContent = message.content;
    }

    return div;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
