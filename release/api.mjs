import { writeSecretFile } from "./atomicFile.mjs";
import { MAX_BODY_BYTES, TOKEN_TTL_SECONDS } from "./constants.mjs";
import { PAYLOAD_TOO_LARGE, isLoopbackRequest, isTrustedApiRequest, readJsonBody, writeJson } from "./fence.mjs";
import { passphraseError } from "./passphrase.mjs";
import { encryptPrivateKey } from "./keyCrypto.mjs";
import { parseTimestamp } from "./time.mjs";
import { encryptedKeyPath, keyFileExists, readSettings, writeSettings } from "./settings.mjs";
import { connect, disconnect, getAuthStatus, getGhInfo, getGitIdentity, getGitInfo, installGh, installGit, setGitIdentity } from "./github.mjs";
import { isInsideDshHome, removeSecretFile } from "./secureFile.mjs";
import { errorMessage } from "./utils/errorMessage.mjs";
import { existsSync, readFileSync } from "node:fs";
// src/api.ts
/**
* Resolve the connection service for browser-session verification.
*
* @param ctx plugin context.
* @returns the service, or undefined when this profile has none.
*/
function resolveConnection(ctx) {
	if (ctx === null || typeof ctx !== "object") return void 0;
	const candidate = ctx;
	let direct;
	try {
		direct = candidate.connection;
	} catch {}
	if (direct && typeof direct.requestRejection === "function") return direct;
	if (typeof candidate.get === "function") try {
		const service = candidate.get("connection");
		if (service && typeof service.requestRejection === "function") return service;
	} catch {}
}
/**
* Require a live DSH browser session for a non-loopback request.
*
* @param ctx plugin context.
* @param req incoming request.
* @returns undefined when admitted, otherwise the HTTP status to return.
*/
function sessionRejection(ctx, req) {
	const connection = resolveConnection(ctx);
	if (!connection || typeof connection.requestRejection !== "function") return 403;
	let rejection;
	try {
		rejection = connection.requestRejection(req);
	} catch {
		return 403;
	}
	if (rejection === void 0) return void 0;
	return rejection === 401 ? 401 : 403;
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
const PEM_MARKER = /PRIVATE KEY-----/;
/**
* Validate browser-supplied key material, encrypt it and store it at the
* fixed encrypted-key path.
*
* @param pem PEM text.
* @param passphrase user passphrase; never persisted.
* @returns the stored path, or an HTTP status and message for the failure.
*/
async function storeEncryptedKey(pem, passphrase) {
	const invalid = passphraseError(passphrase);
	if (invalid !== null) return {
		ok: false,
		status: 400,
		message: invalid
	};
	if (!PEM_MARKER.test(pem)) return {
		ok: false,
		status: 400,
		message: "Invalid private key format"
	};
	try {
		const envelope = await encryptPrivateKey(pem, passphrase);
		const keyPath = encryptedKeyPath();
		writeSecretFile(keyPath, envelope);
		return {
			ok: true,
			keyPath
		};
	} catch (error) {
		return {
			ok: false,
			status: 500,
			message: errorMessage(error, "Cannot store encrypted private key")
		};
	}
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
		config: {
			appId: settings.appId,
			installationId: settings.installationId,
			gitUserName: settings.gitUserName,
			gitUserEmail: settings.gitUserEmail,
			keyFileName: settings.keyFileName,
			hasKey: keyFileExists(settings),
			keyEncrypted: settings.keyEncrypted
		},
		auth,
		token: {
			issuedAt: parseTimestamp(settings.tokenIssuedAt),
			expiresAt: parseTimestamp(settings.tokenExpiresAt),
			ttlSeconds: TOKEN_TTL_SECONDS,
			active: auth.loggedIn
		},
		gitIdentity
	};
}
function createApiHandler(ctx, { trustedHosts }) {
	return async (req, res) => {
		if (!isTrustedApiRequest(req, trustedHosts)) {
			fail(res, 403, "Untrusted request");
			return;
		}
		if (!isLoopbackRequest(req)) {
			const rejection = sessionRejection(ctx, req);
			if (rejection !== void 0) {
				fail(res, rejection, rejection === 401 ? "Authentication required: open the DSH Web UI from its printed URL." : "Untrusted request");
				return;
			}
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
					ok(res, {
						install: await installGh(),
						status: await statusPayload()
					});
					break;
				case "installGit":
					ok(res, {
						install: await installGit(),
						status: await statusPayload()
					});
					break;
				case "saveConfig": {
					const patch = {};
					if (typeof payload.appId === "string") patch.appId = payload.appId;
					if (typeof payload.installationId === "string") patch.installationId = payload.installationId;
					if (typeof payload.gitUserName === "string") patch.gitUserName = payload.gitUserName;
					if (typeof payload.gitUserEmail === "string") patch.gitUserEmail = payload.gitUserEmail;
					let uploadedName = null;
					if (typeof payload.pemBase64 === "string" && payload.pemBase64.trim() !== "") {
						const pemBuffer = Buffer.from(payload.pemBase64, "base64");
						let pemText = pemBuffer.toString("utf8");
						const stored = await storeEncryptedKey(pemText, payload.passphrase).finally(() => {
							pemText = "";
							pemBuffer.fill(0);
						});
						if (!stored.ok) {
							fail(res, stored.status, stored.message);
							return;
						}
						patch.keyPath = stored.keyPath;
						patch.keyEncrypted = true;
						uploadedName = typeof payload.pemFileName === "string" ? payload.pemFileName.trim() : "";
					}
					const latest = readSettings();
					if (uploadedName !== null) patch.keyFileName = uploadedName || latest.keyFileName || "github-app.pem.enc";
					const replacedKeyPath = patch.keyPath && latest.keyPath && latest.keyPath !== patch.keyPath && isInsideDshHome(latest.keyPath) ? latest.keyPath : null;
					const next = writeSettings({
						...latest,
						...patch
					});
					if (replacedKeyPath !== null) removeSecretFile(replacedKeyPath);
					if ("gitUserName" in patch || "gitUserEmail" in patch) await setGitIdentity(next.gitUserName, next.gitUserEmail);
					ok(res, {
						settings: next,
						status: await statusPayload()
					});
					break;
				}
				case "encryptKey": {
					const current = readSettings();
					if (!current.keyPath || !existsSync(current.keyPath)) {
						fail(res, 400, "No private key to encrypt");
						break;
					}
					if (current.keyEncrypted) {
						ok(res, {
							settings: current,
							status: await statusPayload()
						});
						break;
					}
					if (!isInsideDshHome(current.keyPath)) {
						fail(res, 400, "Private key is outside the DSH home; upload it again to encrypt.");
						break;
					}
					let pemText;
					try {
						pemText = readFileSync(current.keyPath, "utf8");
					} catch {
						fail(res, 400, "Cannot read private key");
						break;
					}
					const stored = await storeEncryptedKey(pemText, payload.passphrase).finally(() => {
						pemText = "";
					});
					if (!stored.ok) {
						fail(res, stored.status, stored.message);
						break;
					}
					const next = writeSettings({
						...readSettings(),
						keyPath: stored.keyPath,
						keyEncrypted: true
					});
					removeSecretFile(current.keyPath);
					ok(res, {
						settings: next,
						status: await statusPayload()
					});
					break;
				}
				case "clearConfig": {
					const current = readSettings();
					removeSecretFile(current.keyPath);
					removeSecretFile(encryptedKeyPath());
					writeSettings({
						appId: "",
						installationId: "",
						keyPath: null,
						keyFileName: null,
						keyEncrypted: false
					});
					ok(res, await statusPayload());
					break;
				}
				case "connect": {
					const settings = readSettings();
					ok(res, {
						connect: await connect(settings, payload.passphrase),
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
