import { DEFAULT_HOSTNAME } from "./constants.mjs";
import { readSettings, writeSettings } from "./settings.mjs";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createPrivateKey, createSign } from "node:crypto";
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
async function getGhInfo() {
	const result = await run("gh", ["--version"]);
	if (result.code !== 0) return {
		installed: false,
		version: null
	};
	const match = result.stdout.match(/gh version (\S+)/) || result.stderr.match(/gh version (\S+)/);
	return {
		installed: true,
		version: match ? match[1] : result.stdout.trim() || result.stderr.trim()
	};
}
async function getGitInfo() {
	const result = await run("git", ["--version"]);
	if (result.code !== 0) return {
		installed: false,
		version: null
	};
	const match = result.stdout.match(/git version (\S+)/) || result.stderr.match(/git version (\S+)/);
	return {
		installed: true,
		version: match ? match[1] : result.stdout.trim() || result.stderr.trim()
	};
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
	const loggedIn = result.code === 0 && isLoggedInOutput(output);
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
async function installGit() {
	const info = await getGitInfo();
	if (info.installed) return {
		ok: true,
		version: info.version,
		skipped: true
	};
	const update = await run("apt-get", ["update"], { timeout: 3e5 });
	if (update.code !== 0) return {
		ok: false,
		error: (update.stderr || update.stdout || "apt-get update failed").trim()
	};
	const install = await run("apt-get", [
		"install",
		"-y",
		"git"
	], { timeout: 3e5 });
	if (install.code !== 0) return {
		ok: false,
		error: (install.stderr || install.stdout || "apt-get install git failed").trim()
	};
	const after = await getGitInfo();
	return {
		ok: after.installed,
		version: after.version,
		error: after.installed ? void 0 : "git still not found after install"
	};
}
async function installGh() {
	const ghBefore = await getGhInfo();
	let ghResult;
	if (ghBefore.installed) ghResult = {
		ok: true,
		version: ghBefore.version,
		skipped: true
	};
	else {
		const update = await run("apt-get", ["update"], { timeout: 3e5 });
		if (update.code !== 0) ghResult = {
			ok: false,
			error: (update.stderr || update.stdout || "apt-get update failed").trim()
		};
		else {
			const install = await run("apt-get", [
				"install",
				"-y",
				"gh"
			], { timeout: 3e5 });
			if (install.code !== 0) ghResult = {
				ok: false,
				error: (install.stderr || install.stdout || "apt-get install gh failed").trim()
			};
			else {
				const after = await getGhInfo();
				ghResult = {
					ok: after.installed,
					version: after.version,
					error: after.installed ? void 0 : "gh still not found after install"
				};
			}
		}
	}
	const gitResult = await installGit();
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
/**
* Parse the GitHub API `expires_at` field (ISO-8601) into epoch milliseconds.
*
* @param value raw `expires_at` field of the access-token response.
* @returns epoch milliseconds, or null when missing or unparsable.
*/
function parseTokenExpiry(value) {
	if (typeof value !== "string" || value.trim() === "") return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
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
	const expiresAt = parseTokenExpiry(data.expires_at);
	return {
		ok: true,
		token: data.token,
		expiresAt
	};
}
async function connect(settings) {
	const { appId, installationId, keyPath } = settings || {};
	if (!appId || !installationId || !keyPath) return {
		ok: false,
		error: "Missing appId, installationId or key file"
	};
	if (!existsSync(keyPath)) return {
		ok: false,
		error: "Private key file not found"
	};
	let pem;
	try {
		pem = readFileSync(keyPath, "utf8");
	} catch (error) {
		return {
			ok: false,
			error: `Cannot read private key: ${error instanceof Error && error.message ? error.message : error}`
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
	if (setup.code !== 0) return {
		ok: false,
		error: (setup.stderr || setup.stdout || "gh auth setup-git failed").trim(),
		partial: true
	};
	process.env.GH_TOKEN = token;
	process.env.GITHUB_TOKEN = token;
	const auth = await getAuthStatus();
	return {
		ok: auth.loggedIn,
		auth,
		error: auth.loggedIn ? void 0 : auth.error
	};
}
async function disconnect() {
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
	return { ok: true };
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
export { connect, disconnect, getAuthStatus, getGhInfo, getGitIdentity, getGitInfo, installGh, installGit, isLoggedInOutput, setGitIdentity };
