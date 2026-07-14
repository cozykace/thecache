# Security

THE CACHE holds people's real financial data. Security isn't a feature here — it's the
promise. This document explains how the app protects your data and how to report a
problem.

## The short version

- **Local-first.** Your data lives on your own device, in plain JSON under `data/`. The
  app runs against `127.0.0.1` — the backend binds to loopback only and is not exposed to
  your network.
- **The cloud only ever stores an encrypted blob.** Cloud sync is opt-in. When it's on, your
  data is encrypted **in your browser, before it leaves the device**. The server stores the
  sealed blob and never sees your plaintext data.
- **Two sync modes, and the difference is honest.** The vault is sealed with a data key.
  How that key is handled is the real security tradeoff, so we state it plainly:
  - **Escrow mode (default).** The key rides alongside the vault so a returning device opens
    with no passphrase to type. This is a convenience tradeoff: the protection here is
    **access control on your account**, not cryptography — someone with the key material could
    decrypt the blob. Good against a stolen device or a casual snoop; it is *not* a claim that
    the operator mathematically cannot read it.
  - **Zero-knowledge mode (set a passphrase).** The key is wrapped by a key derived from a
    passphrase we never receive. The server holds only ciphertext and a wrapped key it cannot
    open — this is the mode where "we cannot read your data" is a cryptographic guarantee, not
    a policy. If that guarantee matters to you, **set a passphrase.**
- **Bank credentials stay on your device.** Bank access (the aggregator token) lives only in
  local files that never sync to the cloud.
- **Almost no dependencies.** The app is plain HTML/CSS/JS and the Python standard library —
  no framework, no bundler, no third-party runtime packages. That's a deliberate reduction
  of supply-chain risk.

## The cryptography is public on purpose

The encryption code (`webcache.js`, and the seal/keybox logic it mirrors) is readable by
anyone. That's intentional. Security that depends on the *algorithm* being secret is not
security (Kerckhoffs's principle). The vault is safe because **the key never leaves your
device**, not because the code is hidden — and publishing the crypto is what makes that
claim *checkable*. We would rather you verify the promise than take our word for it.

Envelope, in brief: AES-256-GCM content encryption; keys derived with PBKDF2-SHA256
(210,000 iterations) where a passphrase is involved; a fresh random IV per seal.

## What the server holds

For a cloud-sync user in **zero-knowledge mode**, the server holds an encrypted blob, a
wrapped key it cannot open, and an account record — it cannot decrypt your vault. In
**escrow mode**, it additionally holds the key material, protected by your account rather
than by the passphrase you didn't set. In neither mode does it hold your bank credentials.
"Delete my cloud copy" removes the stored blob.

## Reporting a vulnerability

If you find a security issue, please report it privately — do **not** open a public issue
or post it publicly.

- **Email:** hellocozyace@gmail.com — subject line starting `SECURITY:`.
- Please include enough detail to reproduce, and give us a reasonable window to fix it
  before any public disclosure.

We welcome good-faith security research. If you're testing, test only against your **own**
account and your own local instance — never against another person's data.

## Scope

In scope: the app in this repository — the local backend (`server.py`, `store.py`,
`sync.py`), the web runtime (`webcache.js`), and the client (`app.js`).

Out of scope: third-party services the app can connect to (e.g. the bank-data aggregator,
the cloud host) — report issues in those to the vendor directly — and any deployment you do
not own.
