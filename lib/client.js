// SPDX-License-Identifier: MIT
// dsh-github — browser half: the Settings → GitHub section.

window.__ModuleLoader__.load({
	id: "dsh-github",
	factory: (require) => {
		const React = require("react");
		const h = React.createElement;
		const { useState, useEffect, useRef } = React;

		//#region constants
		const API_URL = "/github/api";
		const SECTION_ID = "github";
		const SECTION_ORDER = 40;
		const SECTION_LABEL = "GitHub";
		//#endregion

		//#region host API
		async function callApi(action, extra) {
			const body = Object.assign({ action }, extra || {});
			const response = await fetch(API_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify(body)
			});
			let payload = null;
			try {
				payload = await response.json();
			} catch (e) {
				payload = null;
			}
			if (payload && typeof payload === "object" && payload.ok === false) {
				const msg = payload.error && typeof payload.error.message === "string"
					? payload.error.message
					: "Request failed";
				throw new Error(msg);
			}
			if (!response.ok) throw new Error("GitHub request failed (HTTP " + response.status + ").");
			if (!payload || typeof payload !== "object") throw new Error("Unreadable response.");
			return Object.prototype.hasOwnProperty.call(payload, "value") ? payload.value : payload;
		}

		function readFileAsBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const result = String(reader.result || "");
					const base64 = result.includes(",") ? result.split(",")[1] : result;
					resolve(base64);
				};
				reader.onerror = () => reject(reader.error || new Error("File read failed"));
				reader.readAsDataURL(file);
			});
		}
		//#endregion

		//#region styles
		const STYLE_ID = "@dsh-github/settings.css";
		const CSS = `
.gh-section{display:flex;flex-direction:column;width:100%;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.gh-row{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;align-items:center;gap:8px;padding:16px 0}
.gh-row:last-of-type{border-bottom:none}
.gh-text{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px}
.gh-titleRow{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.gh-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.gh-badge{display:inline-flex;align-items:center;gap:5px;flex:none;border:.5px solid transparent;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.gh-badge-missing{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.gh-badge-pending{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-label-caption);color:var(--dsw-alias-label-secondary)}
.gh-badge-connected{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.gh-dot{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor}
.gh-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px;white-space:pre-line}
.gh-desc code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.gh-control{display:flex;align-items:center;gap:8px;flex:none;min-width:0}
.gh-input{box-sizing:border-box;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;max-width:320px;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;padding:0 14px}
.gh-input:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gh-input:disabled{cursor:default;opacity:.5}
.gh-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.gh-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;border-radius:var(--dsw-radius-md);border:none;padding:0 14px;font:inherit;font-size:14px;line-height:22px;cursor:pointer;white-space:nowrap}
.gh-button:disabled{opacity:.4;cursor:default}
.gh-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.gh-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.gh-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.gh-secondary{border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary)}
.gh-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gh-fileInput{font-size:12px;color:var(--dsw-alias-label-secondary)}
.gh-fileInput::file-selector-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;margin-right:8px}
.gh-fileInput::file-selector-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gh-fileInput:disabled::file-selector-button{opacity:.4;cursor:default}
.gh-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gh-notice{margin:0;font-size:12px;line-height:18px;padding:8px 12px;border-radius:var(--dsw-radius-md)}
.gh-notice-success{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-success-primary)}
.gh-notice-error{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-error-primary)}
.gh-loading{border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);padding:16px 0;font-size:12px;line-height:18px}
@media (max-width:640px){
.gh-row{flex-wrap:wrap}
.gh-text{padding-right:0;flex-basis:100%}
.gh-control{width:100%;align-items:stretch}
.gh-input{width:100%;max-width:none}
}
`;

		function ensureStyles() {
			if (typeof document === "undefined" || !document.head) return;
			if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-github";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		ensureStyles();
		//#endregion

		//#region component helpers
		function settingsRow({ key, title, description, control, badge }) {
			return h(
				"div",
				{ key, className: "gh-row" },
				h(
					"div",
					{ className: "gh-text" },
					h("div", { className: "gh-titleRow" }, h("span", { className: "gh-title" }, title), badge || null),
					description ? h("div", { className: "gh-desc" }, description) : null
				),
				h("div", { className: "gh-control" }, control)
			);
		}

		function statusBadge(state, label) {
			return h(
				"span",
				{ className: "gh-badge gh-badge-" + state },
				h("span", { className: "gh-dot" }),
				label
			);
		}
		//#endregion

		//#region main component
		function GitHubSection() {
			const [loading, setLoading] = useState(true);
			const [busy, setBusy] = useState(false);
			const [message, setMessage] = useState(null);
			const [status, setStatus] = useState(null);
			const [appId, setAppId] = useState("");
			const [installationId, setInstallationId] = useState("");
			const [gitUserName, setGitUserName] = useState("");
			const [gitUserEmail, setGitUserEmail] = useState("");
			const loadedRef = useRef(false);

			async function refresh() {
				try {
					const value = await callApi("status");
					setStatus(value);
					setAppId((value && value.config && value.config.appId) || "");
					setInstallationId((value && value.config && value.config.installationId) || "");
					setGitUserName((value && value.config && value.config.gitUserName) || (value && value.gitIdentity && value.gitIdentity.name) || "");
					setGitUserEmail((value && value.config && value.config.gitUserEmail) || (value && value.gitIdentity && value.gitIdentity.email) || "");
					loadedRef.current = true;
				} catch (error) {
					setMessage({ kind: "error", text: error && error.message ? error.message : "Failed to load status." });
				} finally {
					setLoading(false);
				}
			}

			useEffect(() => {
				void refresh();
			}, []);

			// auto-save text fields
			useEffect(() => {
				if (!loadedRef.current) return;
				const timer = setTimeout(async () => {
					try {
						await callApi("saveConfig", { appId, installationId, gitUserName, gitUserEmail });
					} catch (error) {
						setMessage({ kind: "error", text: error && error.message ? error.message : "Save failed." });
					}
				}, 600);
				return () => clearTimeout(timer);
			}, [appId, installationId, gitUserName, gitUserEmail]);

			async function withBusy(fn) {
				setBusy(true);
				setMessage(null);
				try {
					await fn();
					await refresh();
				} catch (error) {
					setMessage({ kind: "error", text: error && error.message ? error.message : "Action failed." });
				} finally {
					setBusy(false);
				}
			}

			async function handleInstall() {
				await withBusy(async () => {
					const result = await callApi("installGh");
					if (result && result.install && result.install.ok === false) {
						throw new Error(result.install.error || "Install failed.");
					}
					setMessage({ kind: "success", text: "Недостающие компоненты установлены." });
				});
			}

			async function handleUpload(event) {
				const file = event && event.target && event.target.files && event.target.files[0];
				if (!file) return;
				await withBusy(async () => {
					const base64 = await readFileAsBase64(file);
					await callApi("saveConfig", {
						appId,
						installationId,
						pemBase64: base64,
						pemFileName: file.name
					});
					setMessage({ kind: "success", text: "Private key uploaded." });
				});
				if (event.target) event.target.value = "";
			}

			async function handleConnect() {
				await withBusy(async () => {
					const result = await callApi("connect");
					if (result && result.connect && result.connect.ok === false) {
						throw new Error(result.connect.error || "Connect failed.");
					}
					setMessage({ kind: "success", text: "Connected." });
				});
			}

			async function handleDisconnect() {
				await withBusy(async () => {
					await callApi("disconnect");
					setMessage({ kind: "success", text: "Disconnected." });
				});
			}

			if (loading) {
				return h("div", { className: "gh-section" }, h("div", { className: "gh-loading" }, "Loading…"));
			}

			const gh = (status && status.gh) || { installed: false, version: null };
			const git = (status && (status.git || status.gitInfo)) || { installed: false, version: null };
			const config = (status && status.config) || { hasKey: false, keyFileName: null, appId: "", installationId: "", gitUserName: "", gitUserEmail: "" };
			const auth = (status && status.auth) || { loggedIn: false, gitConfigured: false };

			// CLI status
			let cliStateLabel = "Готово";
			let cliStateClass = "connected";
			if (!gh.installed || !git.installed) {
				cliStateLabel = "Требуется установка";
				cliStateClass = "missing";
			}

			// Connection status
			let connStateLabel = "Ожидает настройки";
			let connStateClass = "pending";
			if (config.hasKey && auth.loggedIn) {
				connStateLabel = "Подключено";
				connStateClass = "connected";
			}

			const rows = [];

			// Status row
			rows.push(
				settingsRow({
					key: "status",
					title: "Статус CLI",
					description: (gh.installed ? "GitHub версия " + (gh.version || "unknown") : "GitHub CLI не установлен") + "\n" + (git.installed ? "Git версия " + (git.version || "unknown") : "Git не установлен"),
					badge: statusBadge(cliStateClass, cliStateLabel),
					control: (!gh.installed || !git.installed)
						? h(
								"button",
								{ className: "gh-button gh-primary", disabled: busy, onClick: handleInstall },
								busy ? "Установка…" : "Установить недостающее"
							)
						: null
				})
			);

			// App ID
			rows.push(
				settingsRow({
					key: "appId",
					title: "App ID",
					description: "Идентификатор вашего GitHub App",
					control: h("input", {
						className: "gh-input",
						type: "text",
						value: appId,
						disabled: busy || !gh.installed || !git.installed,
						onChange: (e) => setAppId(e.target.value),
						placeholder: "123456"
					})
				})
			);

			// Installation ID
			rows.push(
				settingsRow({
					key: "installationId",
					title: "Installation ID",
					description: "Идентификатор установки GitHub App",
					control: h("input", {
						className: "gh-input",
						type: "text",
						value: installationId,
						disabled: busy || !gh.installed || !git.installed,
						onChange: (e) => setInstallationId(e.target.value),
						placeholder: "12345678"
					})
				})
			);

			// Git user name
			rows.push(
				settingsRow({
					key: "gitUserName",
					title: "Git user name",
					description: "Имя автора коммитов (git config --global user.name)",
					control: h("input", {
						className: "gh-input",
						type: "text",
						value: gitUserName,
						disabled: busy || !git.installed,
						onChange: (e) => setGitUserName(e.target.value),
						placeholder: "Your Name"
					})
				})
			);

			// Git user email
			rows.push(
				settingsRow({
					key: "gitUserEmail",
					title: "Git user email",
					description: "Email автора коммитов (git config --global user.email)",
					control: h("input", {
						className: "gh-input",
						type: "email",
						value: gitUserEmail,
						disabled: busy || !git.installed,
						onChange: (e) => setGitUserEmail(e.target.value),
						placeholder: "you@example.com"
					})
				})
			);

			// Private key
			rows.push(
				settingsRow({
					key: "key",
					title: "Private key (.pem)",
					description: config.hasKey
						? "Ключ загружен" + (config.keyFileName ? " (" + config.keyFileName + ")" : "")
						: "Загрузите приватный ключ GitHub App",
					control: h("input", {
						className: "gh-fileInput",
						type: "file",
						accept: ".pem",
						disabled: busy || !gh.installed || !git.installed,
						onChange: handleUpload
					})
				})
			);

			// Actions row
			rows.push(
				h(
					"div",
					{ key: "actions", className: "gh-row" },
					h(
						"div",
						{ className: "gh-text" },
						h("div", { className: "gh-titleRow" },
							h("span", { className: "gh-title" }, "Подключение"),
							statusBadge(connStateClass, connStateLabel)
						),
						h("div", { className: "gh-desc" }, "Авторизация GitHub CLI с помощью GitHub App")
					),
					h(
						"div",
						{ className: "gh-control" },
						h(
							"div",
							{ className: "gh-actions" },
									auth.loggedIn
										? h(
												"button",
												{
													className: "gh-button gh-secondary",
													disabled: busy || !gh.installed,
													onClick: handleDisconnect
												},
												busy ? "Отключение…" : "Отключить"
											)
										: h(
												"button",
												{
													className: "gh-button gh-primary",
													disabled: busy || !gh.installed || !git.installed || !config.hasKey || !appId || !installationId,
													onClick: handleConnect
												},
												busy ? "Подключение…" : "Подключить"
											)
						)
					)
				)
			);

			return h(
				"div",
				{ className: "gh-section" },
				rows,
				message
					? h(
							"div",
							{ className: "gh-notice gh-notice-" + message.kind, style: { marginTop: "16px" } },
							message.text
						)
					: null
			);
		}
		//#endregion

		//#region plugin registration
		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: SECTION_ID,
						order: SECTION_ORDER,
						label: SECTION_LABEL
					},
					GitHubSection
				)
			);
		}

		return {
			apply,
			inject: ["slots"]
		};
		//#endregion
	}
});
