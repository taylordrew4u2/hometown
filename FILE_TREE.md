# Bit Builder - Project File Structure

```
bit-builder/
├── index.html                 # Login/Signup page
├── dashboard.html             # Chat interface
├── binder.html                # Bitbinder (joke library)
├── app.js                     # Shared Firebase initialization & auth
├── agent-bridge.js            # Unified voice + text chat bridge
├── binder.js                  # Bitbinder logic
├── style.css                  # Global styling
├── firestore.rules            # Firestore security rules
├── firestore.indexes.json     # Firestore indexes
├── firebase.json              # Firebase CLI config
├── .firebaserc                # Firebase project config
├── README.md                  # Deployment instructions
└── functions/
    ├── index.js               # Cloud Functions (chatWithAgent)
    └── package.json           # Cloud Functions dependencies
```
