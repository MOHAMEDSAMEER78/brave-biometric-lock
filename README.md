# Brave Biometric Lock

Lock your Brave browser profile with **Touch ID / Face ID / Windows Hello** biometric authentication. Prevents unauthorized access to your browser session with a sleek lock screen overlay.

Uses the **WebAuthn API** with platform authenticators — the same technology browsers use for biometric-protected saved passwords. No native binaries or extra installation required.

![Lock Screen Preview](extension/icons/icon128.png)

## Features

- **Biometric Authentication** — Unlock with Touch ID, Face ID, or Windows Hello
- **Fallback Password** — Set a backup password when biometrics aren't available
- **Auto-Lock on Idle** — Configurable timeout (1, 5, 15, 30 min)
- **Lock on Startup** — Browser locks automatically when opened
- **Premium Lock Screen** — Glassmorphism UI with smooth animations
- **Per-Profile Settings** — Configure independently for each browser profile
- **Zero Installation** — No native host, no build tools, just load the extension

## Architecture

```
Extension (MV3)  →  WebAuthn API  →  Platform Authenticator (Touch ID / Face ID / Windows Hello)
```

| Component | Tech | Role |
|---|---|---|
| Browser Extension | JavaScript (MV3) | UI, state management, tab control |
| Biometric Module | WebAuthn API | Triggers platform biometrics directly in the browser |

The extension uses the **Web Authentication API** (`navigator.credentials`) with `authenticatorAttachment: "platform"` and `userVerification: "required"` — the same mechanism browsers use internally when prompting for biometrics before autofilling saved passwords.

## Quick Start

### 1. Load Extension in Brave

1. Open `brave://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** → select the `extension/` folder

That's it — no build step, no native host installation.

### 2. Configure

1. Click the extension icon in Brave toolbar
2. Toggle **Enable Lock** on
3. Set your preferred **Auto-Lock** timeout
4. Optionally set a **Fallback Password**

### 3. Test

- Click **Lock Now** in the popup
- The lock screen overlay will appear
- Click **Unlock with Touch ID**
- Authenticate with your fingerprint (first use will register a WebAuthn credential)

## Project Structure

```
brave-biometric-lock/
├── extension/                    # Browser extension (MV3)
│   ├── manifest.json             # Extension configuration
│   ├── background.js             # Service worker
│   ├── biometric.js              # WebAuthn biometric module
│   ├── content.js                # Lock overlay injection
│   ├── popup/                    # Settings popup
│   │   ├── popup.html/css/js
│   ├── lock/                     # Standalone lock page
│   │   ├── lock.html/css/js
│   └── icons/                    # Extension icons
└── README.md
```

## Requirements

- **Brave**, **Chrome**, or any Chromium-based browser with WebAuthn support
- A device with a **platform authenticator** (Touch ID, Face ID, Windows Hello, or device passcode)

## Supported Platforms

| Platform | Biometric Method |
|---|---|
| macOS (Touch ID Mac) | Touch ID fingerprint |
| macOS (non-Touch ID) | Device passcode fallback |
| Windows | Windows Hello (fingerprint, face, PIN) |
| ChromeOS | Device PIN / fingerprint |

## Security Notes

> The lock overlay is a **visual deterrent**, not a cryptographic barrier. A determined user could disable the extension from `brave://extensions`. For stronger security, combine with OS-level screen locking.

## Uninstall

Remove the extension from `brave://extensions` — no other cleanup needed.

## License

MIT
