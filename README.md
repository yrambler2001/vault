# Secure Vault — Password Manager & Authenticator

A self-hosted, offline-first, zero-knowledge password and TOTP (2FA) manager built with modern web standards. It features advanced biometric unlocking via WebAuthn PRF and physical USB RAID-1 backup syncing.

## Features

- **Password Management:** Securely store, organize, and generate strong passwords.
- **Built-in TOTP Authenticator:** Manage Two-Factor Authentication (2FA) codes directly in your vault via QR code scanning, image imports, or manual entry.
- **Zero-Knowledge Architecture:** All encryption (AES-256-GCM) happens strictly client-side. The server never sees your master password, TOTP secrets, encryption keys or unencrypted vault data.
- **Argon2id Key Derivation:** Utilizes the industry-standard Argon2id algorithm (winner of the Password Hashing Competition) for all key derivation. By being both memory-hard and CPU-hard, Argon2id provides state-of-the-art resistance against GPU and ASIC brute-force attacks, ensuring your master password and API keys are virtually impossible to crack even if the encrypted data is captured.
- **Biometric WebAuthn (PRF):** Unlock your vault and authenticate to the server using device biometrics (TouchID, FaceID, Windows Hello) or hardware security keys via the WebAuthn PRF extension.
- **USB RAID-1 Backup:** Automatic, offline vault replication to multiple configurable USB drives. Keep physical, air-gapped backups of your encrypted vault.
- **Hardened Web Security:** The backend is rigorously protected against common web vulnerabilities:
  - **Granular Rate Limiting:** Endpoint-specific limiters (Global, Auth, Read, Write, Setup) with proxy-trust support actively block brute-force and DoS attacks.
  - **CSRF Protection:** State-changing API endpoints are protected by an HMAC-based Synchronizer Token Pattern bound strictly to the user's session.
  - **XSS & CSP:** Strict Content Security Policy (via Helmet) prevents malicious script execution. Additionally, primary Data Encryption Keys (DEKs) are flagged as `nonExtractable` in the Web Crypto API, severely limiting the impact of any potential XSS attacks.
  - **Strict CORS & Cookies:** Cross-Origin Resource Sharing is locked to the configured frontend URL. Sessions are managed via in-memory, HMAC-signed tokens stored exclusively in `httpOnly`, `secure`, and `SameSite=Strict` cookies.
  - **Concurrency & DoS Defenses:** Mutex-based write locks prevent race conditions during vault updates, while aggressive server timeouts protect against Slowloris connection-exhaustion attacks.

---

## 🛠️ Tech Stack

**Frontend:** React 19, TypeScript, Vite, Tailwind CSS, SimpleWebAuthn, Hash-WASM (Argon2id)

**Backend:** Node.js, Express, TypeScript, Zod, Async-Mutex, Helmet

**Cryptography:** Web Crypto API, Argon2id, AES-256-GCM, HMAC-SHA256

---

## 🏗️ Architecture & Security Model

Secure Vault utilizes two completely independent security layers. Compromising one does not compromise the other.

### Layer 1 — Server Access (API Key OR WebAuthn)

- **Option A (API Key):** Client runs Argon2id → computes Verifier (SHA-256). The server issues a one-time Nonce challenge. The client responds with `HMAC-SHA256(Verifier, Nonce)`. The raw hash never leaves the client, preventing replay attacks.
- **Option B (WebAuthn):** Platform authenticator verifies assertion against server-stored credentials.
- **Sessions:** Stored entirely in-memory using HMAC-signed, `httpOnly`, `secure` cookies with `SameSite=Strict`. Sessions rotate on sensitive operations and are completely wiped on server restart.

### Layer 2 — Vault Encryption (Master Password OR PRF Biometrics)

- **Option A (Master Password):** Argon2id KDF → Key Encryption Key (KEK) → unwrap Data Encryption Key (DEK) → decrypt vault.
- **Option B (WebAuthn PRF):** Hardware PRF output → KEK → unwrap DEK → decrypt vault.
- **Encryption:** All vault contents (passwords, usernames, TOTP secrets, notes) are encrypted using AES-256-GCM before ever leaving the browser.

---

## Known Security Properties & Limitations

### Vault metadata is stored in plaintext

The encrypted vault file (`data/vault.json`) contains necessary plaintext metadata:

- `vaultId`, `passwordSalt`, `kdfParams`, `version`, timestamps

This is by design — the metadata is needed before decryption can occur.
The actual password and TOTP entries are encrypted with AES-256-GCM. An attacker
with access to the vault file can see _when_ the vault was modified and
the KDF parameters, but not the contents.

### USB drives contain full vault replicas

Vault data written to USB drives includes the complete VaultDocument:
metadata, wrapped keys, and encrypted data. This is **by design** — USB
drives serve as complete backup replicas that can restore the vault
independently. The actual password/TOTP entries remain encrypted with AES-256-GCM.

These USB drives are intended to be used as **fixed backup storage**
(like internal hard drives), not as removable media carried in pockets.

### USB version history is not automatically pruned

Version history on USB drives is never automatically deleted. With 64GB
capacity and typical vault sizes of a few KB per version, this provides
decades of history. This is **by design** — long-term archival preserves
recovery options that pruning would eliminate.

### USB sync does not cross-verify existing versions

When syncing, if two drives have the same version number, sync assumes
they are identical and skips. This is **by design** for simplicity — the
integrity verification endpoint (`/drives/verify/:label`) can be used
to detect corruption on individual drives.

### Version history does not chain hashes

Version files do not include a `previousVersionHash` field for tamper
detection. Each version is independently integrity-checked via SHA-256
sidecar files. This is **by design** — the current integrity model is
sufficient for the threat model (fixed USB drives, not removable media).

### JavaScript Memory Constraints

The `clearArrayBuffer` function zeros buffers after use, but this is
NOT cryptographically guaranteed due to:

- V8 JIT compilation may retain copies in optimized code
- The garbage collector may move buffers, leaving copies
- JavaScript strings are immutable and cannot be zeroed
- Intermediate values from encoding functions create copies

This is a **fundamental limitation of all JavaScript runtimes** and is
documented as defense-in-depth only.

### No dedicated health check endpoint

A lightweight `/api/health` endpoint is not provided because `/api/status`
already serves this purpose with minimal overhead. If a load balancer needs
a health check, `/api/status` should be used. This is **by design** — the
app is intended for single-user self-hosted deployment, not clustered.

### Confirmation dialogs use window.confirm()

Delete operations use the browser's native `confirm()` dialog, which blocks
the UI thread. This is acceptable because deletes are infrequent destructive
operations, and the blocking nature prevents accidental double-clicks.

## Setup

### 1. Generate TLS Certificates (Development)

```bash
mkdir -p backend/certs
openssl req -x509 -newkey rsa:2048 -keyout backend/certs/key.pem \
  -out backend/certs/cert.pem -days 365 -nodes \
  -subj "/CN=localhost"

```

### 2. Configure Environment

```bash
cd backend
cp .env.example .env
# Edit .env — set TLS_CERT_PATH, TLS_KEY_PATH, and VAULT_DRIVES

```

### 3. USB Drive Configuration

Set `VAULT_DRIVES` in your `.env` file:

```env
# Windows example:
VAULT_DRIVES=USB1:E:\secure-vault,USB2:F:\secure-vault,USB3:G:\secure-vault,USB4:H:\secure-vault

# Linux example:
VAULT_DRIVES=USB1:/mnt/usb1/secure-vault,USB2:/mnt/usb2/secure-vault

```

The specified directories will be created automatically when you initialize
each drive through the UI.

**Path restrictions:**

- Paths must NOT be filesystem roots (e.g., `E:\` or `/`)
- Paths containing `..` are rejected
- Duplicate paths are rejected at startup

### 4. Reverse Proxy Configuration (if applicable)

If behind a reverse proxy (nginx, Cloudflare, Tailscale), set `TRUST_PROXY`
in `.env` so rate limiting uses real client IPs:

```env
# One proxy (e.g., nginx on same host):
TRUST_PROXY=1

# Two proxies (e.g., Cloudflare → nginx):
TRUST_PROXY=2

```

**WARNING:** If behind a proxy and `TRUST_PROXY` is not set, all rate limiting
will use the proxy's IP, making limits ineffective.

### 5. Install & Run

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev

```

### 6. Access

Open `https://localhost:5173` in your browser.
Accept the self-signed certificate warning (development only).

## ⚠️ Security Requirements

**This application MUST be run over HTTPS at all times**, including during
development. **Plain HTTP is NOT supported and will NOT work.**

The following features require a secure context (HTTPS):

- Session cookies (`secure: true` — browsers refuse to send these over HTTP)
- WebAuthn API (completely unavailable over HTTP)
- Web Crypto API / SubtleCrypto (unavailable over HTTP)
- CSRF protection (depends on secure cookies)

The backend will **refuse to start** without valid TLS certificates configured
via `TLS_CERT_PATH` and `TLS_KEY_PATH` environment variables. There is no
HTTP fallback mode and there never will be.

For development, self-signed certificates are generated automatically by Vite
for the frontend, and can be created manually for the backend (see Setup below).

For production, use proper TLS certificates (e.g., Let's Encrypt).

## ⚠️ Sessions Are In-Memory Only

All sessions are stored in server memory. **A server restart will terminate
ALL active sessions.** Users must re-authenticate after a restart. This is
**by design** — it ensures no stale session data persists on disk, reduces
attack surface, and the HMAC secret regeneration on restart automatically
invalidates any stolen session tokens.
