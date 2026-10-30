import { DEFAULT_HOSTNAME } from "./constants.mjs";
import { passphraseError } from "./passphrase.mjs";
import { decryptPrivateKey } from "./keyCrypto.mjs";
import { parseTimestamp } from "./time.mjs";
import { readSettings, writeSettings } from "./settings.mjs";
import { createPrivateKey, createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
// src/github.ts
function run(command, args, options = {}) {
	return new Promise((resolve) => {
		const env = {
			...process.env,
			...options.env || {}
		};
		for (const key of options.unset || []) delete env[key];
		const child = spawn(command, args, {
			cwd: options.cwd,
			env,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			windowsHide: true
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		let settled = false;
		let timedOut = false;
		let timer = null;
		const finish = (code, error) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			resolve({
				code: typeof code === "number" ? code : error ? 1 : 0,
				stdout,
				stderr,
				error: error || (timedOut ? /* @__PURE__ */ new Error("Command timed out") : code !== 0 ? new Error(stderr || stdout || "Command failed") : null)
			});
		};
		if (options.timeout && options.timeout > 0) timer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill("SIGTERM");
			} catch {}
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {}
			}, 5e3);
		}, options.timeout);
		child.on("error", (error) => finish(1, error));
		child.on("close", (code) => finish(code, null));
		child.stdin.on("error", () => {});
		try {
			if (options.input != null) child.stdin.write(options.input);
			child.stdin.end();
		} catch {}
	});
}
/**
* Environment variables `gh` accepts as a token source.
*
* When any of them is set, `gh auth login` and `gh auth logout` refuse to
* touch gh's own credential store ("…first clear the value from the
* environment"), and `gh auth status` reports the environment token instead
* of the stored credentials. The plugin exports the installation token into
* its own process environment for the agent, so every auth-management command
* has to run without them — otherwise the second Connect in one server
* lifetime always fails, and Disconnect never removes the stored credentials.
*/
const GH_TOKEN_ENV_KEYS = [
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"GH_ENTERPRISE_TOKEN",
	"GITHUB_ENTERPRISE_TOKEN"
];
/**
* Run a `gh auth` subcommand with the token environment removed, so it reads
* and writes gh's credential store rather than the ambient token.
*
* @param args `gh` arguments, starting after the binary name.
* @param options spawn options; `unset` entries are added, never replaced.
* @returns the command result.
*/
function runGhAuth(args, options = {}) {
	return run("gh", args, {
		...options,
		unset: [...options.unset || [], ...GH_TOKEN_ENV_KEYS]
	});
}
async function getToolInfo(command) {
	const result = await run(command, ["--version"]);
	if (result.code !== 0) return {
		installed: false,
		version: null
	};
	const pattern = new RegExp(`${command} version (\\S+)`);
	const match = result.stdout.match(pattern) || result.stderr.match(pattern);
	return {
		installed: true,
		version: match ? match[1] : result.stdout.trim() || result.stderr.trim()
	};
}
function getGhInfo() {
	return getToolInfo("gh");
}
function getGitInfo() {
	return getToolInfo("git");
}
const AUTH_FAILURE_TEXT = /failed to log in|not logged in(to)?|is invalid|has expired|authentication failed|bad credentials|re-?authenticate/i;
const AUTH_SUCCESS_TEXT = /logged in to|logged in as/i;
const AUTH_FAILURE_MARKER = /^\s*[✗✘×]\s+/u;
const AUTH_FAILURE_MARKER_TEXT = /^\s*X\s+(failed|not logged|invalid|expired|bad credentials)/i;
const AUTH_SUCCESS_MARKER = /^\s*[✓✔]\s+.*logged in/iu;
const AUTH_ACTIVE_ACCOUNT = /^(?:[-*]\s*)?active account:\s*true$/i;
/**
* Classify a single `gh auth status` line as `'failed'`, `'ok'`, or `null` when
* the line carries no verdict of its own (host header, `- Token:` metadata...).
*
* @param line one line of `gh auth status` output.
* @returns the verdict carried by that line, if any.
*/
function classifyAuthLine(line) {
	if (AUTH_FAILURE_TEXT.test(line) || AUTH_FAILURE_MARKER.test(line) || AUTH_FAILURE_MARKER_TEXT.test(line)) return "failed";
	if (AUTH_SUCCESS_TEXT.test(line) || AUTH_SUCCESS_MARKER.test(line)) return "ok";
	return null;
}
/**
* Decide whether `gh auth status` output describes a usable authentication.
*
* `gh` exits 0 as soon as *one* configured account is usable, so judging the
* merged output as a whole reports a false "disconnected" whenever an unusable
* entry sits next to a working one. The entry marked `Active account: true` —
* the credential `gh` and git operations actually use — decides the verdict.
* Other entries are only consulted when no such marker is present; when the
* marker is present but its status line is unrecognisable (a future `gh`
* re-wording), the verdict stays `false` instead of falling back to another
* account, so an unknown format can never claim "Connected".
*
* @param output merged stdout+stderr of `gh auth status`.
* @returns true when the active (or only) account is authenticated.
*/
function isLoggedInOutput(output) {
	let pendingStatus = null;
	let activeStatus = null;
	let activeAccountSeen = false;
	let sawOk = false;
	let sawFailed = false;
	for (const line of String(output).split(/\r?\n/)) {
		const status = classifyAuthLine(line);
		if (status === "ok") {
			pendingStatus = "ok";
			sawOk = true;
		} else if (status === "failed") {
			pendingStatus = "failed";
			sawFailed = true;
		}
		if (AUTH_ACTIVE_ACCOUNT.test(line.trim())) {
			activeAccountSeen = true;
			activeStatus = pendingStatus;
		}
	}
	if (activeAccountSeen) return activeStatus === "ok";
	if (sawOk) return true;
	if (sawFailed) return false;
	return false;
}
async function getAuthStatus(hostname = DEFAULT_HOSTNAME) {
	const result = await runGhAuth([
		"auth",
		"status",
		"--hostname",
		hostname
	]);
	const output = `${result.stdout}\n${result.stderr}`.trim();
	const loggedIn = isLoggedInOutput(output);
	const gitCfg = await run("git", [
		"config",
		"--global",
		"--get",
		`credential.https://${hostname}.helper`
	]);
	return {
		loggedIn,
		gitConfigured: gitCfg.code === 0 && /gh auth git-credential|gh/.test(gitCfg.stdout),
		hostname,
		output: loggedIn ? output : void 0,
		error: loggedIn ? void 0 : output || "gh auth status failed"
	};
}
/**
* Package managers tried in order, per platform.
*
* `winget` is preferred on Windows and Chocolatey is the fallback; on Linux the
* order covers Debian/Ubuntu, Fedora/RHEL, Arch and Alpine/openSUSE.
*/
const PACKAGE_MANAGERS = {
	darwin: [{
		command: "brew",
		probe: ["--version"],
		update: null,
		install: ["install"]
	}],
	win32: [{
		command: "winget",
		probe: ["--version"],
		update: null,
		install: [
			"install",
			"--source",
			"winget",
			"--accept-source-agreements",
			"--accept-package-agreements",
			"--silent",
			"--id"
		],
		packageName: {
			gh: "GitHub.cli",
			git: "Git.Git"
		}
	}, {
		command: "choco",
		probe: ["--version"],
		update: null,
		install: ["install", "-y"]
	}],
	linux: [
		{
			command: "apt-get",
			probe: ["--version"],
			update: ["update"],
			install: ["install", "-y"]
		},
		{
			command: "dnf",
			probe: ["--version"],
			update: null,
			install: ["install", "-y"]
		},
		{
			command: "yum",
			probe: ["--version"],
			update: null,
			install: ["install", "-y"]
		},
		{
			command: "pacman",
			probe: ["--version"],
			update: null,
			install: ["-S", "--noconfirm"],
			packageName: { gh: "github-cli" }
		},
		{
			command: "zypper",
			probe: ["--version"],
			update: null,
			install: ["--non-interactive", "install"]
		},
		{
			command: "apk",
			probe: ["--version"],
			update: null,
			install: ["add", "--no-cache"],
			packageName: { gh: "github-cli" }
		}
	]
};
/**
* Package managers available for a platform, in probe order.
*
* @param platform target platform; defaults to the host.
* @returns the manager list, empty when the platform has no installer.
*/
function packageManagers(platform = process.platform) {
	return PACKAGE_MANAGERS[platform] ?? [];
}
/**
* Commands needed to install one tool with a known package manager.
*
* @param manager manager to use.
* @param tool tool to install.
* @returns ordered commands; an install failure aborts the sequence.
*/
function installCommands(manager, tool) {
	const steps = [];
	if (manager.update !== null) steps.push({
		command: manager.command,
		args: manager.update
	});
	steps.push({
		command: manager.command,
		args: [...manager.install, manager.packageName?.[tool] ?? tool]
	});
	return steps;
}
/**
* Probe the platform's managers in order and return the first usable one.
*
* @param platform target platform.
* @returns the manager, or null when none answers.
*/
async function findPackageManager(platform = process.platform) {
	for (const manager of packageManagers(platform)) if ((await run(manager.command, manager.probe, { timeout: 15e3 })).code === 0) return manager;
	return null;
}
/**
* Human-readable fallback hint for a platform without an automatic installer.
*
* @param tool tool the user wanted to install.
* @returns a short instruction.
*/
function installHint(tool) {
	if (process.platform === "darwin") return `Install Homebrew (https://brew.sh) and retry, or download ${tool} from https://cli.github.com`;
	if (process.platform === "win32") return `Install winget or Chocolatey and retry, or download ${tool} from https://cli.github.com`;
	return `Install a supported package manager (apt, dnf, yum, pacman, zypper or apk), or see https://github.com/cli/cli#installation for ${tool}`;
}
/**
* Install one missing tool with the first available platform manager.
*
* @param tool `gh` or `git`.
* @returns the install outcome; `skipped` when the tool was already present.
*/
async function installTool(tool) {
	const before = tool === "gh" ? await getGhInfo() : await getGitInfo();
	if (before.installed) return {
		ok: true,
		version: before.version,
		skipped: true
	};
	const managers = packageManagers();
	const manager = await findPackageManager();
	if (manager === null) return {
		ok: false,
		error: managers.length === 0 ? `Automatic install is not supported on ${process.platform}. ${installHint(tool)}` : `No supported package manager found. ${installHint(tool)}`
	};
	for (const step of installCommands(manager, tool)) {
		const result = await run(step.command, step.args, { timeout: 3e5 });
		if (result.code !== 0) {
			const output = (result.stderr || result.stdout || `${step.command} ${step.args.join(" ")} failed`).trim();
			return {
				ok: false,
				error: `${output}\n${manager.command === "apt-get" && tool === "gh" && /unable to locate|has no installation candidate/i.test(output) ? "On Debian/Ubuntu, gh needs the GitHub CLI repository: https://github.com/cli/cli/blob/trunk/docs/install_linux.md" : installHint(tool)}`
			};
		}
	}
	const after = tool === "gh" ? await getGhInfo() : await getGitInfo();
	return {
		ok: after.installed,
		version: after.version,
		error: after.installed ? void 0 : `${tool} still not found after install`
	};
}
async function installGit() {
	return installTool("git");
}
async function installGh() {
	const ghResult = await installTool("gh");
	const gitResult = await installTool("git");
	const ok = ghResult.ok && gitResult.ok;
	return {
		ok,
		version: ghResult.version,
		gh: ghResult,
		git: gitResult,
		error: ok ? void 0 : ghResult.error || gitResult.error
	};
}
function base64UrlEncode(value) {
	return (Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function createAppJwt(appId, privateKeyPem) {
	const now = Math.floor(Date.now() / 1e3);
	const header = {
		alg: "RS256",
		typ: "JWT"
	};
	const payload = {
		iat: now - 60,
		exp: now + 600,
		iss: String(appId)
	};
	const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
	let key;
	try {
		key = createPrivateKey(privateKeyPem);
	} catch (error) {
		throw new Error(`Invalid private key: ${error instanceof Error && error.message ? error.message : error}`);
	}
	const signer = createSign("RSA-SHA256");
	signer.update(signingInput);
	return `${signingInput}.${base64UrlEncode(signer.sign(key))}`;
}
function apiBaseFor(hostname) {
	return hostname === "github.com" ? "https://api.github.com" : `https://${hostname}/api/v3`;
}
async function fetchInstallationToken(jwt, installationId, hostname) {
	const url = `${apiBaseFor(hostname)}/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`;
	let response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json"
			},
			body: "{}"
		});
	} catch (error) {
		return {
			ok: false,
			error: `Network error: ${error instanceof Error && error.message ? error.message : error}`
		};
	}
	const text = await response.text();
	if (!response.ok) return {
		ok: false,
		error: `GitHub API ${response.status}: ${text.trim()}`
	};
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return {
			ok: false,
			error: "Invalid JSON response from GitHub API"
		};
	}
	if (data === null || typeof data !== "object" || !("token" in data) || typeof data.token !== "string" || data.token === "") return {
		ok: false,
		error: "No installation token in GitHub API response"
	};
	const rawExpiresAt = data.expires_at;
	const expiresAt = typeof rawExpiresAt === "string" ? parseTimestamp(rawExpiresAt) : null;
	return {
		ok: true,
		token: data.token,
		expiresAt
	};
}
/**
* Exchange the GitHub App private key for an installation token.
*
* The key file is encrypted at rest, so the passphrase is required on every
* call: the decrypted PEM lives only for the duration of this operation and is
* never cached in the server process.
*
* @param settings persisted App ID, installation ID and key location.
* @param passphrase passphrase protecting the key file.
* @returns the connection outcome and refreshed auth status.
*/
async function connect(settings, passphrase) {
	const { appId, installationId, keyPath } = settings || {};
	if (!appId || !installationId || !keyPath) return {
		ok: false,
		error: "Missing appId, installationId or key file"
	};
	const invalidPassphrase = passphraseError(passphrase);
	if (invalidPassphrase !== null) return {
		ok: false,
		error: invalidPassphrase
	};
	if (!existsSync(keyPath)) return {
		ok: false,
		error: "Private key file not found"
	};
	let envelope;
	try {
		envelope = readFileSync(keyPath, "utf8");
	} catch (error) {
		return {
			ok: false,
			error: `Cannot read private key: ${error instanceof Error && error.message ? error.message : error}`
		};
	}
	let pem;
	try {
		pem = await decryptPrivateKey(envelope, passphrase);
	} catch {
		return {
			ok: false,
			error: "Cannot decrypt private key: wrong passphrase or corrupted key file."
		};
	}
	let jwt;
	try {
		jwt = createAppJwt(appId, pem);
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error && error.message ? error.message : "Failed to create JWT"
		};
	} finally {
		pem = "";
	}
	const tokenResult = await fetchInstallationToken(jwt, installationId, DEFAULT_HOSTNAME);
	if (!tokenResult.ok) return {
		ok: false,
		error: tokenResult.error
	};
	const token = tokenResult.token;
	const login = await runGhAuth([
		"auth",
		"login",
		"--hostname",
		DEFAULT_HOSTNAME,
		"--with-token",
		"--git-protocol",
		"https"
	], {
		timeout: 12e4,
		input: `${token}\n`
	});
	if (login.code !== 0) return {
		ok: false,
		error: (login.stderr || login.stdout || "gh auth login failed").trim()
	};
	const issuedAt = Date.now();
	const expiresAt = tokenResult.expiresAt ?? issuedAt + 36e5;
	try {
		writeSettings({
			...readSettings(),
			tokenIssuedAt: new Date(issuedAt).toISOString(),
			tokenExpiresAt: new Date(expiresAt).toISOString()
		});
	} catch {}
	const setup = await runGhAuth(["auth", "setup-git"], { timeout: 12e4 });
	if (setup.code !== 0) {
		const msg = (setup.stderr || setup.stdout || "gh auth setup-git failed").trim();
		await rollbackLogin();
		return {
			ok: false,
			error: msg
		};
	}
	process.env.GH_TOKEN = token;
	process.env.GITHUB_TOKEN = token;
	const auth = await getAuthStatus();
	if (!auth.loggedIn) {
		const msg = auth.error || "gh auth status did not confirm the login";
		await rollbackLogin();
		return {
			ok: false,
			error: msg
		};
	}
	return {
		ok: true,
		auth
	};
}
/**
* Undo a login that was written to gh's credential store when a later step of
* {@link connect} failed, so the reported state matches the store.
*
* @returns nothing; failures are best-effort.
*/
async function rollbackLogin() {
	await runGhAuth([
		"auth",
		"logout",
		"--hostname",
		DEFAULT_HOSTNAME
	], {
		timeout: 6e4,
		input: "y\n"
	});
	delete process.env.GH_TOKEN;
	delete process.env.GITHUB_TOKEN;
	try {
		writeSettings({
			...readSettings(),
			tokenIssuedAt: null,
			tokenExpiresAt: null
		});
	} catch {}
}
async function disconnect() {
	const result = await runGhAuth([
		"auth",
		"logout",
		"--hostname",
		DEFAULT_HOSTNAME
	], {
		timeout: 6e4,
		input: "y\n"
	});
	const output = `${result.stdout}\n${result.stderr}`.trim();
	const loggedOut = result.code === 0 || /not logged in/i.test(output);
	delete process.env.GH_TOKEN;
	delete process.env.GITHUB_TOKEN;
	try {
		writeSettings({
			...readSettings(),
			tokenIssuedAt: null,
			tokenExpiresAt: null
		});
	} catch {}
	return loggedOut ? { ok: true } : {
		ok: false,
		error: output || "gh auth logout failed"
	};
}
async function getGitIdentity() {
	const nameResult = await run("git", [
		"config",
		"--global",
		"--get",
		"user.name"
	]);
	const emailResult = await run("git", [
		"config",
		"--global",
		"--get",
		"user.email"
	]);
	return {
		name: nameResult.code === 0 ? nameResult.stdout.trim() : "",
		email: emailResult.code === 0 ? emailResult.stdout.trim() : ""
	};
}
async function setGitIdentity(name, email) {
	if (typeof name === "string" && name.trim() !== "") await run("git", [
		"config",
		"--global",
		"user.name",
		name.trim()
	]);
	else await run("git", [
		"config",
		"--global",
		"--unset",
		"user.name"
	]);
	if (typeof email === "string" && email.trim() !== "") await run("git", [
		"config",
		"--global",
		"user.email",
		email.trim()
	]);
	else await run("git", [
		"config",
		"--global",
		"--unset",
		"user.email"
	]);
	return getGitIdentity();
}
export { connect, disconnect, getAuthStatus, getGhInfo, getGitIdentity, getGitInfo, installCommands, installGh, installGit, isLoggedInOutput, packageManagers, setGitIdentity };
