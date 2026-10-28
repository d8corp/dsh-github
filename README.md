# @d8corp/dsh-github

DSH plugin for GitHub CLI (`gh`) integration: configure a GitHub App and authenticate `gh` so the agent can use git/GitHub operations.

## Settings

Open **Settings → GitHub**:

- CLI Status: **Install required** / **Ready**
- Connection: **Pending setup** / **Connected**
- Install GitHub CLI if missing
- App ID, Installation ID
- Key passphrase and private key upload (.pem); the key is encrypted at rest with scrypt + AES-256-GCM (mode 0600) and never returned to the browser
- Connect / Disconnect

The passphrase is not stored anywhere and is required for upload, for encrypting a legacy key, and for every Connect. Losing it means uploading the key again. Keys saved by older versions as plaintext are rejected until you set a passphrase and click **Encrypt key**.

Parameters are saved automatically on change.

## Security

- The plugin API accepts loopback requests directly. Any other authority must also present a live DSH browser session; `--trusted-host` alone is not enough.
- The decrypted private key exists only for the duration of a Connect call. The installation token is short-lived and stored by `gh` in its own credential store.

