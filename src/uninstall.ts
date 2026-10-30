/**
 * Removes plugin-owned artifacts after the bundle is uninstalled.
 *
 * DSH has no uninstall lifecycle: removing a bundle disposes the plugin fiber
 * exactly like disabling it, an HMR reload, or a host restart. Disposal alone
 * therefore proves nothing. The watcher keeps reading the profile manifest
 * after disposal and deletes plugin data only after the package has stayed
 * absent from both `dependencies` and `dsh.profile.bundles` for a quiet
 * period. Until the package is gone, the manifest still declares it, so a
 * disable, reload, or restart leaves the data alone.
 *
 * The watcher lives in the host process, so this covers removals performed
 * while a DSH host is running. Removing the package with no host running
 * (`dsh plugin remove`) leaves the data directory for manual cleanup.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { PACKAGE_NAME, PLUGIN_DIR_NAME } from './constants'
import { dshHomeDir, pluginDir } from './settings'

/** How often the watcher re-reads the profile manifest. */
const WATCH_INTERVAL_MS = 1000

/** Consecutive absent readings required before deleting anything. */
const WATCH_CONFIRMATIONS = 15

/** Upper bound on one watcher's lifetime. */
const WATCH_TIMEOUT_MS = 5 * 60 * 1000

const activeWatchers = new Set<() => void>()

function isRecord (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Whether a profile manifest still claims this package.
 *
 * @param profileDir profile root holding `package.json`.
 * @param packageName bundle package name.
 * @returns true when declared, false when absent, null when the manifest
 * cannot be read — callers must treat null as "still installed".
 */
export function profileDeclaresPackage (
  profileDir: string,
  packageName: string = PACKAGE_NAME,
): boolean | null {
  let manifest: unknown

  try {
    manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }

  if (!isRecord(manifest)) return null

  if (isRecord(manifest.dependencies) && Object.hasOwn(manifest.dependencies, packageName)) return true
  if (isRecord(manifest.devDependencies) && Object.hasOwn(manifest.devDependencies, packageName)) return true

  const dsh = isRecord(manifest.dsh) ? manifest.dsh : {}
  const profile = isRecord(dsh.profile) ? dsh.profile : {}
  const bundles = Array.isArray(profile.bundles) ? profile.bundles : []

  return bundles.includes(packageName)
}

/**
 * Delete the plugin data directory. Paths are derived from `DSH_HOME`, never
 * from user input.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns true when the directory was removed.
 */
export function removePluginArtifacts (env: NodeJS.ProcessEnv = process.env): boolean {
  const home = resolve(dshHomeDir(env))
  const dir = resolve(pluginDir(env))

  // A defensive invariant: the removable directory is always the fixed child
  // of the harness home, so a bad environment cannot widen the blast radius.
  if (dir !== join(home, PLUGIN_DIR_NAME)) return false

  if (!existsSync(dir)) return false

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      '[dsh-github-app] cannot remove plugin data:',
      error instanceof Error && error.message ? error.message : error,
    )

    return false
  }

  return true
}

export interface UninstallCleanupOptions {
  /** Profile root captured while the plugin was mounted. */
  profileDir: string
  packageName?: string
  env?: NodeJS.ProcessEnv
  /** Manifest re-read interval; tests shorten this. */
  intervalMs?: number
  /** Consecutive absent readings required before cleanup. */
  confirmations?: number
  /** Upper bound on the watcher's lifetime. */
  timeoutMs?: number
}

/**
 * Watch the profile for this package's removal and delete plugin artifacts.
 *
 * @param options profile location and timing knobs.
 * @returns a function that stops the watcher before it acts.
 */
export function watchForUninstallCleanup (options: UninstallCleanupOptions): () => void {
  const {
    profileDir,
    packageName = PACKAGE_NAME,
    env = process.env,
  } = options

  const intervalMs = Math.max(1, options.intervalMs ?? WATCH_INTERVAL_MS)
  const confirmations = Math.max(1, options.confirmations ?? WATCH_CONFIRMATIONS)
  const deadline = Date.now() + Math.max(intervalMs, options.timeoutMs ?? WATCH_TIMEOUT_MS)

  let absentReadings = 0
  let timer: NodeJS.Timeout | undefined
  let stopped = false

  const stop = (): void => {
    if (stopped) return

    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    activeWatchers.delete(stop)
  }

  const tick = (): void => {
    if (stopped) return

    if (profileDeclaresPackage(profileDir, packageName) === false) absentReadings += 1
    else absentReadings = 0

    if (absentReadings >= confirmations) {
      stop()
      removePluginArtifacts(env)

      return
    }

    if (Date.now() >= deadline) {
      stop()

      return
    }

    timer = setTimeout(tick, intervalMs)
    timer.unref()
  }

  activeWatchers.add(stop)
  timer = setTimeout(tick, intervalMs)
  timer.unref()

  return stop
}

/**
 * Cancel watchers started by this module instance, for example when the
 * plugin mounts again after an HMR reload or a reinstall.
 */
export function cancelUninstallCleanup (): void {
  for (const stop of [...activeWatchers]) stop()
}
