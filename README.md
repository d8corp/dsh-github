# dsh-github

DSH plugin for GitHub CLI (`gh`) integration: configure a GitHub App and authenticate `gh` so the agent can use git/GitHub operations.

## Settings

Open **Settings → GitHub**:

- Status: **Требуется установка** / **Ожидает настройки** / **Подключено**
- Install GitHub CLI if missing
- App ID, Installation ID
- Upload private key (.pem); key is stored on host (mode 0600), never returned to browser
- Connect / Disconnect

Parameters are saved automatically on change.
