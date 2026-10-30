# dsh-github-app

`dsh-github-app` connects the DSH agent to GitHub through a **GitHub App** instead of a personal access token or an interactive `gh auth login`.

You create a GitHub App once, install it on your account or organization, and give the plugin three things: the App ID, the installation ID, and the App's private key.
The plugin exchanges that key for a short-lived **installation access token**, signs `gh` in with it, configures git's credential helper, and exports the token to the environment of the agent's child processes. 
The private key is encrypted on disk with a passphrase that is never stored anywhere.

Why a GitHub App:

- The token lives for about one hour and is limited to the repositories and permissions you granted to the installation.
- Access is revoked by uninstalling or suspending the App, or by deleting the private key in GitHub — no password or PAT to hunt down.
- No browser OAuth flow is needed inside the harness: the agent gets a token by itself.

## How it works

```
DSH Settings → GitHub                Plugin host                         GitHub
─────────────────────                ───────────                         ──────
App ID + Installation ID  ─────────▶  sign a JWT with the App key  ───▶  POST /app/installations/{id}/access_tokens
Passphrase + private key  ─────────▶  encrypt key at rest                       │
                                                                          ◀──────┘  installation token (~1 h)
                                     gh auth login --with-token
                                     gh auth setup-git
                                     GH_TOKEN / GITHUB_TOKEN → agent env
```

The decrypted key exists only for the duration of a Connect call. The installation token is stored by `gh` in its own credential store and exported to the agent's environment; it is never sent back to the browser.

## What the settings section looks like

```
Settings → GitHub

CLI status        [ Ready ]                                  GitHub 2.62.0
                                                             Git 2.43.0
App ID            [ 123456                                  ]
Installation ID   [ 12345678                                ]
Git user name     [ Your Name                               ]
Git user email    [ you@example.com                         ]
Key passphrase    [ ••••••••                                ]
Private key (.pem)[ Choose file ]  Key uploaded and encrypted (app.pem)
Connection        [ Connected ]  59:42                       [ Disconnect ]
```

Badges:

- **CLI status**: `Install required` when `gh` or `git` is missing, `Ready` otherwise. The button installs both when needed.
- **Connection**: `Pending setup` before a key is uploaded, `Disconnected` when a key exists but the login is not active, `Connected` when `gh` has a working account.
- The `59:42` next to the connection is the remaining lifetime of the installation token. It turns yellow under five minutes and red at zero.

## Setup

### 1. Create a GitHub App

Open **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** (for an organization: **Organization settings → Developer settings → GitHub Apps**). GitHub's direct link is <https://github.com/settings/apps/new>.

- **Webhook**: uncheck *Active* — the plugin does not receive webhooks.
- **Repository permissions**: set **Contents: Read and write** if the agent should clone and push. **Metadata: Read-only** is granted automatically. Add *Issues*, *Pull requests*, *Actions* and other permissions only if the agent should use the matching `gh` commands; the App cannot do more than you grant here.
- **Where can this GitHub App be installed**: choose the narrowest option that fits your case.
- Click **Create GitHub App**.

### 2. Find the App ID

The App's settings page shows **App ID** near the top. It is a number such as `123456`. Do not use the *Client ID* — it is a different value.

### 3. Install the App and get the Installation ID

- On the App page click **Install App** and choose the account or organization, then the repositories it may access.
- After installing, the browser lands on `https://github.com/settings/installations/<installation-id>` (for an organization: `https://github.com/organizations/<org>/settings/installations/<installation-id>`). The number at the end is the **Installation ID**, for example `12345678`.
- You can return to this page later via **Settings → Applications → Configure**.

### 4. Generate the private key

On the App settings page open **Private keys** and click **Generate a private key**. A file named like `your-app.2026-01-02.private-key.pem` is downloaded. GitHub does not let you download that key again, so keep it somewhere safe; if it is lost, generate a new one. Deleting the key in GitHub immediately stops tokens issued with it.

### 5. Fill in the plugin

Open **Settings → GitHub** in DSH and fill in the fields:

| Field | What to enter | Where it comes from |
| --- | --- | --- |
| **App ID** | The numeric App ID | App settings page, *App ID* |
| **Installation ID** | The numeric installation ID | URL of the installation page, `/installations/<id>` |
| **Git user name** | Author name for commits | Your choice; written to `git config --global user.name` |
| **Git user email** | Author email for commits | Your choice; written to `git config --global user.email` |
| **Key passphrase** | Any passphrase of 8+ characters | Invented by you. It encrypts the key at rest and is **not stored** |
| **Private key (.pem)** | The file from step 4 | GitHub App → *Private keys* |

Text fields are saved automatically a moment after you stop typing, and only the field you changed is written. Git identity is applied to the global git config only when it actually changes; clearing a field removes that global setting.

Then:

1. If **CLI status** says `Install required`, click **Install missing components**. On Linux the package manager usually needs root; if the host lacks those privileges the manager's error is shown and you can install `gh`/`git` manually. On Debian/Ubuntu `gh` is not in the default repositories and the plugin shows a link to GitHub's installation instructions.
2. Enter the passphrase and upload the `.pem` file. The key is encrypted and written to disk; the original file is not needed afterwards.
3. Click **Connect**.

### What happens on Connect

1. The plugin decrypts the key with your passphrase and signs a short-lived JWT as the GitHub App.
2. It asks GitHub for an installation access token.
3. It runs `gh auth login --with-token` and `gh auth setup-git`, so both `gh` and `git` can use the token.
4. It exports `GH_TOKEN` and `GITHUB_TOKEN` into the plugin host's environment, which the agent's child processes inherit.
5. It reads the token expiry from GitHub and starts the countdown.

If any step after the login fails, the plugin logs `gh` out again instead of leaving a half-connected state. A wrong passphrase or a corrupted key file is reported without touching the stored key.

## Everyday use

- **The token expires after about one hour.** GitHub App installation tokens are not refreshable, so when the countdown reaches zero the connection becomes unavailable and you click **Connect** again with the passphrase.
- **Disconnect** runs `gh auth logout --hostname github.com`, removes `GH_TOKEN`/`GITHUB_TOKEN` from the host environment, and clears the recorded lifetime. Note that this logs out the active `github.com` account in gh's shared credential store, which may be a personal account if you changed accounts outside DSH.
- **The passphrase is required for upload and for every Connect.** It is not stored, not sent anywhere except the plugin's own host, and cannot be recovered. If it is lost, upload the key again with a new passphrase.
- **`gh` and `git` are shared tools.** The plugin drives their global settings (`gh` credential store, `git config --global`), so changes are visible outside DSH. Disconnecting or uninstalling does not remove the git identity.

## Security

- The private key is encrypted at rest with scrypt + AES-256-GCM (unique salt and IV, authenticated payload) in a `0600` file under `$DSH_HOME/dsh-github-app/`.
- The passphrase is never persisted and never returned to the browser. The decrypted key exists in memory only during a Connect call.
- Every request to the plugin API is checked by the DSH connection service: a live browser session or API credential is required even for loopback requests, so a spoofed `Host` header cannot bypass it. Only a profile without the connection service (headless) falls back to accepting loopback requests directly.
- The installation token is never exposed to the browser. It is written to `gh`'s credential store and exported to the host environment for the agent; any process started by the agent can read it for as long as it is valid.
- Revoke access at any time by uninstalling the App, deleting its private key in GitHub, or clicking **Disconnect** in DSH.

## Files

The plugin keeps its data in `$DSH_HOME/dsh-github-app/` (`$DSH_HOME` defaults to `~/.dsh`):

| File | Contents |
| --- | --- |
| `github.json` | App ID, installation ID, git identity, key file name, token timestamps (mode `0600`) |
| `github-app.pem.enc` | The encrypted GitHub App private key (mode `0600`) |

## Uninstall

Removing the bundle deletes the plugin-owned `$DSH_HOME/dsh-github-app/` directory — settings and the encrypted key — about 15 seconds after the profile stops listing the package in `dependencies` and `dsh.profile.bundles`. DSH has no uninstall hook, so the running host watches its own profile and performs the cleanup; disabling the plugin, an HMR reload, or a host restart keeps the data because the profile still declares the package.

- Removing the package while no DSH host is running (`dsh plugin remove` from a shell) leaves the watcher without a process to run in; delete `$DSH_HOME/dsh-github-app/` manually.
- A DSH update is a removal followed by an installation, so the cleanup also runs on update. Reinstall within the 15-second window, or back up the directory first, to keep the current settings.
- Uninstalling does **not** log `gh` out. Click **Disconnect** first if you want to drop the token immediately.
- The `gh` token store and the git identity are shared user settings and are left untouched.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Install required` does not go away | `gh`/`git` are not on `PATH` for the DSH host; install them manually and restart the host. |
| `Cannot decrypt private key` | Wrong passphrase, or the key file was replaced/corrupted. Upload the `.pem` again. |
| `GitHub API 401` | The App ID and the private key belong to different Apps, or the key was deleted in GitHub. |
| `GitHub API 404` | Wrong installation ID, or the App is not installed on that account/repository. |
| `GitHub API 403` / `gh` commands fail with 403 | The App lacks the permission for that operation (for example *Contents: Read and write* for pushing). |
| Connected, but pushes fail | `gh auth setup-git` did not configure the credential helper; run Connect again and check `git config --global --get credential.https://github.com.helper`. |
