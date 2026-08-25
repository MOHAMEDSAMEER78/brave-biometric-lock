# Brave Biometric Lock

Lock your Brave browser profile with **Touch ID / Face ID / Windows Hello** biometric authentication. Prevents unauthorized access to your browser session with a sleek lock screen overlay.

Uses the **WebAuthn API** with platform authenticators — the same technology browsers use for biometric-protected saved passwords. No native binaries or extra installation required.

## Features

### Core
- **Biometric Authentication** — Unlock with Touch ID (macOS), Face ID, or Windows Hello. Button label adjusts automatically to your platform.
- **Fallback Password** — Set a backup password when biometrics aren't available (PBKDF2 with random salt, 310,000 iterations)
- **Alarm-Based Auto-Lock** — Configurable idle timeout using `chrome.alarms` (reliable even when the service worker sleeps)
- **Lock on Startup** — Browser locks automatically when opened
- **Lock on Close** — Optional; only lock when the browser is relaunched

### New in v2.0
- **Progressive Lockout** — After repeated wrong passwords: 30s → 5min → permanent lockout (biometric required to reset)
- **Credential Management** — View whether a WebAuthn credential is registered; reset it from the popup if needed (e.g., after switching devices)
- **Unlock Audit Trail** — The popup shows when the browser was last unlocked and how many failed attempts occurred
- **Tab Restore Count** — The lock screen shows how many tabs will be restored after unlock
- **Legacy Password Migration** — Detects old v1 SHA-256 hashes and prompts users to upgrade to PBKDF2
- **Offline-First** — No Google Fonts or external resources; works fully offline
- **Accessibility** — Full ARIA attributes, `aria-live` regions, `prefers-reduced-motion` respected
- **Remove Password** — Users can fully remove a fallback password (not just reset it)

## Architecture

```
Extension (MV3)  →  WebAuthn API  →  Platform Authenticator (Touch ID / Face ID / Windows Hello)
```

| Component | Tech | Role |
|---|---|---|
| Background Service Worker | JavaScript (MV3) | State management, tab control, PBKDF2 hashing, alarms, rate limiting |
| Biometric Module (`biometric.js`) | WebAuthn API | Platform biometric registration & verification |
| Lock Page (`lock/`) | HTML/CSS/JS | Full-page unlock UI (runs in extension context for WebAuthn access) |
| Content Script (`content.js`) | JavaScript | Lock overlay injected on every page |
| Popup (`popup/`) | HTML/CSS/JS | Settings, credential management, audit trail |
| Shared Constants (`shared/constants.js`) | JavaScript | Single source of truth for storage keys and message types |

### Security Model

| Concern | Solution |
|---|---|
| Password storage | PBKDF2-SHA256, random 128-bit salt, 310,000 iterations |
| Brute-force | Progressive lockout: 3 fails → 30s; 5 fails → 5min; 10 fails → biometric-only |
| Message integrity | Background verifies `sender.url` starts with extension origin before accepting `BIOMETRIC_AUTH_SUCCESS` |
| CSP | `script-src 'self'; object-src 'none'` — no inline scripts or eval |
| Credential staleness | `InvalidStateError` triggers credential reset flow |

> **Visual deterrent note:** The lock overlay is a visual deterrent, not a cryptographic barrier. A determined user could disable the extension from `brave://extensions`. For stronger security, combine with OS-level screen locking.

## Quick Start

### 1. Load Extension in Brave

1. Open `brave://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** → select the `extension/` folder

No build step, no native host, no installation.

### 2. Configure

1. Click the extension icon in the Brave toolbar
2. Toggle **Enable Lock** on
3. Set your preferred **Auto-Lock** timeout
4. Optionally set a **Fallback Password** (min 8 characters)

### 3. Test

- Click **Lock Now** in the popup
- The lock screen appears
- Click **Unlock with Touch ID** (or the equivalent for your platform)
- On first use, a WebAuthn credential is registered (requires biometric confirmation)

## Project Structure

```
brave-biometric-lock/
├── extension/                    # Browser extension (MV3)
│   ├── manifest.json             # v2.0.0 — alarms, CSP, web_accessible_resources
│   ├── background.js             # Service worker (lock/unlock, PBKDF2, rate limiting, alarms)
│   ├── biometric.js              # WebAuthn module (register, verify, reset, platform detection)
│   ├── content.js                # Lock overlay injection (with body-null guard + ARIA)
│   ├── shared/
│   │   └── constants.js          # STORAGE_KEYS, MESSAGE_TYPES, ALARM_NAME
│   ├── popup/                    # Settings popup
│   │   ├── popup.html            # Credential mgmt, audit row, remove-password
│   │   ├── popup.css             # System fonts, reduced-motion, danger styles
│   │   └── popup.js              # Full rewrite using shared constants
│   ├── lock/                     # Standalone lock page (WebAuthn context)
│   │   ├── lock.html             # Dynamic button, tab hint, credential reset
│   │   ├── lock.css              # System fonts, reduced-motion
│   │   └── lock.js               # Biometric detect, tab count, credential reset flow
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
└── README.md
```

## Requirements

- **Brave**, **Chrome**, or any Chromium-based browser (MV3 support required)
- A device with a **platform authenticator** (Touch ID, Face ID, Windows Hello, or device passcode)

## Supported Platforms

| Platform | Biometric Method | Button Label |
|---|---|---|
| macOS (Touch ID Mac) | Touch ID fingerprint | "Unlock with Touch ID" |
| macOS (non-Touch ID) | Device passcode fallback | "Unlock with Biometrics" |
| Windows | Windows Hello (fingerprint, face, PIN) | "Unlock with Windows Hello" |
| ChromeOS | Device PIN / fingerprint | "Unlock with Device PIN" |
| Linux | FIDO2 platform authenticator (if available) | "Unlock with Biometrics" |

## Upgrading from v1.0

Users who had a fallback password set in v1.0 will see an **"upgrade needed"** notice in the popup. This is because v1.0 used a fixed-salt SHA-256 hash; v2.0 uses PBKDF2 with a random salt. To upgrade:

1. Open the popup → **Fallback Password** → **Reset**
2. Verify identity via biometrics or the current password
3. Set a new password (min 8 characters)

The old hash is cleared automatically after the new password is saved.

## License

MIT
