# dsh-github-app

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

## Uninstall

Removing the bundle deletes the plugin-owned `$DSH_HOME/dsh-github-app/` directory — settings and the encrypted key — about 15 seconds after the profile stops listing the package in `dependencies` and `dsh.profile.bundles`. DSH has no uninstall hook, so the running host watches its own profile and performs the cleanup; disabling the plugin, an HMR reload, or a host restart keeps the data because the profile still declares the package.

- Removing the package while no DSH host is running (`dsh plugin remove` from a shell) leaves the watcher without a process to run in; delete `$DSH_HOME/dsh-github-app/` manually.
- A DSH update is a removal followed by an installation, so the cleanup also runs on update. Reinstall within the 15-second window, or back up the directory first, to keep the current settings.
- The `gh` token store and the git identity are shared user settings and are left untouched.

## Security

- The plugin API accepts loopback requests directly. Any other authority must also present a live DSH browser session; `--trusted-host` alone is not enough.
- The decrypted private key exists only for the duration of a Connect call. The installation token is short-lived and stored by `gh` in its own credential store.

