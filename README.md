# 🎭 Bit Builder - AI Comedy Assistant

A production-ready Firebase web application featuring an AI-powered comedy assistant named **Bit Builder**. Chat with an intelligent comedy writing partner, save your jokes to a personal **Bitbinder** (joke library), and let the AI help you refine your stand-up material.

## Features

✨ **Core Features:**
- **User Authentication**: Firebase Auth with Email/Password and Google Sign-In
- **Real-time Chat Interface**: Instant messaging with ElevenLabs Conversational AI
- **Voice Input**: Web Speech API for hands-free communication
- **AI Tool Calling**: The assistant can directly save jokes to your Bitbinder via function calls
- **Bitbinder (Joke Library)**: Create, edit, delete, and organize your jokes with tags
- **Search & Filter**: Find jokes by content and filter by tags
- **Context Awareness**: The AI remembers your past jokes and conversation history

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+, Modular SDK v9)
- **Backend**: Firebase (Auth, Firestore, Cloud Functions)
- **AI Integration**: ElevenLabs Conversational AI with function calling
- **Hosting**: Firebase Hosting
- **Build Tool**: Firebase CLI

## Deployment Guide

### Quick Start (5 minutes)

```bash
# 1. Install dependencies
cd functions && npm install && cd ..

# 2. Login to Firebase
firebase login

# 3. Deploy everything
firebase deploy
```

**Your app will be live at**: `https://bit-builder-4c59c.web.app`

## Project Structure

```
bit-builder/
├── index.html                 # Login/Signup page
├── dashboard.html             # Chat interface
├── binder.html                # Bitbinder (joke library)
├── app.js                     # Shared Firebase initialization & auth
├── agent-bridge.js            # Unified voice + text chat bridge
├── binder.js                  # Bitbinder CRUD logic
├── style.css                  # Global styling (mobile-responsive)
├── firestore.rules            # Security rules
├── firestore.indexes.json     # Database indexes
├── firebase.json              # Firebase CLI configuration
├── .firebaserc                # Firebase project config
├── functions/
│   ├── index.js               # Cloud Functions (chatWithAgent)
│   └── package.json           # Cloud Functions dependencies
└── README.md                  # This file
```

## ✨ Features Implemented

✅ User authentication with Firebase Auth (Email/Password)
✅ Real-time chat with ElevenLabs Conversational AI
✅ Voice input via Web Speech API (🎤 button)
✅ AI tool calling to save jokes directly to Bitbinder
✅ Complete Bitbinder (personal joke library) with:
  - Create, read, update, delete jokes
  - Tag-based organization
  - Search and filter functionality
✅ Firestore security rules for data privacy
✅ Responsive, mobile-friendly UI with dark theme
✅ Cloud Functions for secure API handling
✅ Real-time message synchronization

## Core Components

### Frontend Pages
- **index.html**: Login/signup interface with form validation
- **dashboard.html**: Chat interface with real-time messaging
- **binder.html**: Joke library management with search/filter

### JavaScript Modules
- **app.js**: Firebase initialization, authentication, auth state management
- **agent-bridge.js**: Unified voice widget + text chat WebSocket bridge, save-to-Bitbinder
- **binder.js**: Joke CRUD operations, search, filtering, editing

### Styling
- **style.css**: Complete responsive design with dark theme

## Database Schema

### Firestore Collections

**jokes**
```
userId (string) - Owner's Firebase Auth UID
content (string) - The joke text
tags (array) - Categories like ["pun", "short", "dark"]
createdAt (Timestamp) - When joke was created
updatedAt (Timestamp) - Last modification time
```

**conversations**
```
userId (string) - Conversation owner
startedAt (Timestamp) - When conversation started

Subcollection: messages
- role (string) - "user", "assistant", or "tool"
- content (string) - Message text / tool result
- timestamp (Timestamp) - When message was sent
- toolCallId (string, optional) - Reference to tool call
```

## Cloud Functions

### chatWithAgent (Callable Function)
Handles conversation with ElevenLabs AI:
- Receives user message and conversation ID
- Fetches conversation history (last 10 messages)
- Retrieves user's saved jokes for context
- Calls ElevenLabs Conversational AI endpoint
- Handles AI tool calls (e.g., `save_joke`)
- Persists all messages to Firestore
- Returns assistant's response

## API Integration: ElevenLabs

Uses **ElevenLabs Conversational AI** with function calling:

**Endpoint**: `POST https://api.elevenlabs.io/v1/convai/chat`

**Agent ID**: `agent_7401ka31ry6qftr9ab89em3339w9`

**API Key**: Used securely server-side in Cloud Functions

**Tool Support**: `save_joke` function for direct joke saving

## Security

### Firestore Rules
- Users can only read/write their own jokes
- Users can only access their own conversations and messages
- All operations require authentication

### Backend Security
- ElevenLabs API key stored securely in Cloud Functions only
- API key never exposed to frontend
- Authentication verified on every Cloud Function call
- Tool calls validated server-side

## Usage Guide

### 1. Sign Up
```
1. Go to https://bit-builder-4c59c.web.app
2. Click "Sign Up"
3. Enter name, email, and password
4. Redirects to dashboard automatically
```

### 2. Chat with Bit Builder
```
1. Type a message in the input field
2. (Optional) Use 🎤 button to record voice input
3. Bit Builder responds with comedy advice
4. Messages saved automatically
```

### 3. Save Jokes
```
When AI suggests a joke:
1. AI calls save_joke function
2. Joke automatically saved to Bitbinder
3. Confirmation shown in chat
```

### 4. Manage Bitbinder
```
Click "📚 Bitbinder" to:
- View all saved jokes
- Search by content
- Filter by tags
- Edit joke content/tags
- Delete unwanted jokes
```

## Troubleshooting

### "Firebase project not found"
```bash
firebase use bit-builder-4c59c
```

### Cloud Functions deployment fails
```bash
node --version  # Should be v20+
cd functions && rm -rf node_modules && npm install
firebase deploy --debug  # See detailed errors
```

### "Permission denied" on Firestore
```bash
firebase login  # Re-authenticate
# Check Firebase Console > Firestore > Rules
```

### ElevenLabs API returns 401
- Verify API key in `functions/index.js`
- Check API key hasn't expired in ElevenLabs dashboard

### Web Speech API not working
- Must use HTTPS (Firebase Hosting provides this)
- Check browser supports Web Speech API (Chrome, Edge, Safari)
- Allow microphone permissions in browser

## Local Development

### Using Firebase Emulator

```bash
# Start emulator
firebase emulators:start

# In app.js, uncomment:
# connectAuthEmulator(auth, 'http://localhost:9099');
# connectFirestoreEmulator(db, 'localhost', 8080);
# connectFunctionsEmulator(functions, 'localhost', 5001);
```

### View Logs
```bash
firebase functions:log
```

## Performance Features

✅ Real-time listeners (no polling)
✅ Lazy loading of messages and jokes
✅ Firestore batched writes
✅ Efficient Firestore queries with indexes
✅ CSS optimization

## Deployment Checklist

- [ ] Node.js v20+ installed
- [ ] Firebase CLI installed
- [ ] Logged in with `firebase login`
- [ ] Installed Cloud Functions dependencies
- [ ] Deployed with `firebase deploy`
- [ ] Accessed app at https://bit-builder-4c59c.web.app
- [ ] Created test account
- [ ] Tested chat functionality
- [ ] Tested voice input
- [ ] Tested joke saving via AI
- [ ] Tested Bitbinder CRUD operations

## Support Resources

- **Firebase**: https://firebase.google.com/docs
- **ElevenLabs**: https://elevenlabs.io/docs
- **Web Speech API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API

## Next Steps

To add more features:
1. User profiles and preferences
2. Joke sharing with other users
3. Comedy tips and tutorials
4. Performance analytics
5. Export jokes to PDF
6. Collaboration features

---

**Happy Comedy Writing! 🎭**

For issues, check Firebase Console logs and verify all credentials.
