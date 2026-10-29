import { KEY_FILENAME, MAX_BODY_BYTES, TOKEN_TTL_SECONDS } from "./constants.mjs";
import { PAYLOAD_TOO_LARGE, isTrustedApiRequest, readJsonBody, writeJson } from "./fence.mjs";
import { dshHomeDir, keyFileExists, readSettings, writeSettings } from "./settings.mjs";
import { connect, disconnect, getAuthStatus, getGhInfo, getGitIdentity, getGitInfo, installGh, installGit, setGitIdentity } from "./github.mjs";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
// src/api.ts
/**
* Parse a persisted ISO-8601 token timestamp into epoch milliseconds.
*
* @param value ISO string stored in settings, or null.
* @returns epoch milliseconds, or null when missing or unparsable.
*/
function tokenTime(value) {
	if (typeof value !== "string" || value.trim() === "") return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}
function errorMessage(error, fallback) {
	return error instanceof Error && error.message ? error.message : fallback;
}
function ok(res, value) {
	writeJson(res, 200, {
		ok: true,
		value
	});
}
function fail(res, status, message) {
	writeJson(res, status, {
		ok: false,
		error: { message }
	});
}
async function statusPayload() {
	const settings = readSettings();
	const gh = await getGhInfo();
	const git = await getGitInfo();
	let auth = {
		loggedIn: false,
		gitConfigured: false
	};
	if (gh.installed) auth = await getAuthStatus();
	const gitIdentity = git.installed ? await getGitIdentity() : {
		name: "",
		email: ""
	};
	return {
		gh,
		git,
		gitInfo: git,
		gitVersion: git,
		gitCli: git,
		gitCliInfo: git,
		config: {
			appId: settings.appId,
			installationId: settings.installationId,
			gitUserName: settings.gitUserName,
			gitUserEmail: settings.gitUserEmail,
			keyFileName: settings.keyFileName,
			hasKey: keyFileExists(settings)
		},
		auth,
		token: {
			issuedAt: tokenTime(settings.tokenIssuedAt),
			expiresAt: tokenTime(settings.tokenExpiresAt),
			ttlSeconds: TOKEN_TTL_SECONDS,
			active: auth.loggedIn
		},
		gitIdentity
	};
}
function createApiHandler(_ctx, { trustedHosts }) {
	return async (req, res) => {
		if (!isTrustedApiRequest(req, trustedHosts)) {
			fail(res, 403, "Untrusted request");
			return;
		}
		if ((req.method || "GET").toUpperCase() !== "POST") {
			fail(res, 405, "Method not allowed");
			return;
		}
		const body = await readJsonBody(req, MAX_BODY_BYTES);
		if (body === PAYLOAD_TOO_LARGE) {
			fail(res, 413, "Payload too large");
			return;
		}
		const payload = body !== null && typeof body === "object" ? body : {};
		const action = payload.action;
		if (typeof action !== "string" || action.trim() === "") {
			fail(res, 400, "Missing action");
			return;
		}
		try {
			switch (action) {
				case "status":
					ok(res, await statusPayload());
					break;
				case "installGh":
				case "install":
				case "installMissing":
				case "installCli":
				case "installTools":
					ok(res, {
						install: await installGh(),
						status: await statusPayload()
					});
					break;
				case "installGit":
				case "installGitCli":
					ok(res, {
						install: await installGit(),
						status: await statusPayload()
					});
					break;
				case "saveConfig": {
					const current = readSettings();
					const patch = {};
					if (typeof payload.appId === "string") patch.appId = payload.appId;
					if (typeof payload.installationId === "string") patch.installationId = payload.installationId;
					if (typeof payload.gitUserName === "string") patch.gitUserName = payload.gitUserName;
					if (typeof payload.gitUserEmail === "string") patch.gitUserEmail = payload.gitUserEmail;
					if (typeof payload.pemBase64 === "string" && payload.pemBase64.trim() !== "") {
						let pemText;
						try {
							pemText = Buffer.from(payload.pemBase64, "base64").toString("utf8");
						} catch {
							fail(res, 400, "Invalid key encoding");
							return;
						}
						if (!/PRIVATE KEY-----/.test(pemText)) {
							fail(res, 400, "Invalid private key format");
							return;
						}
						const keyPath = join(dshHomeDir(), KEY_FILENAME);
						mkdirSync(dirname(keyPath), { recursive: true });
						writeFileSync(keyPath, pemText, { mode: 384 });
						patch.keyPath = keyPath;
						patch.keyFileName = typeof payload.pemFileName === "string" && payload.pemFileName.trim() !== "" ? payload.pemFileName.trim() : KEY_FILENAME;
					}
					const next = writeSettings({
						...current,
						...patch
					});
					if (Object.prototype.hasOwnProperty.call(patch, "gitUserName") || Object.prototype.hasOwnProperty.call(patch, "gitUserEmail")) await setGitIdentity(next.gitUserName, next.gitUserEmail);
					ok(res, {
						settings: next,
						status: await statusPayload()
					});
					break;
				}
				case "clearConfig": {
					const current = readSettings();
					if (current.keyPath && existsSync(current.keyPath)) try {
						unlinkSync(current.keyPath);
					} catch {}
					writeSettings({
						appId: "",
						installationId: "",
						keyPath: null,
						keyFileName: null
					});
					ok(res, await statusPayload());
					break;
				}
				case "connect": {
					const settings = readSettings();
					ok(res, {
						connect: await connect(settings),
						status: await statusPayload()
					});
					break;
				}
				case "disconnect":
					await disconnect();
					ok(res, await statusPayload());
					break;
				case "test":
					ok(res, {
						auth: await getAuthStatus(),
						status: await statusPayload()
					});
					break;
				default: fail(res, 400, `Unknown action: ${action}`);
			}
		} catch (error) {
			fail(res, 500, errorMessage(error, "Internal error"));
		}
	};
}
export { createApiHandler };
