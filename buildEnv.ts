/* eslint-disable no-console */
import cssnano from 'cssnano'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import postcss from 'postcss'
import * as sass from 'sass'

const INPUT_SCSS = 'theme.scss'
const OUTPUT_ENV = '.env.theme'
// Must start with INNETJS_ENV_PREFIX from .env, which innetjs uses to select
// the host variables exposed to the client bundle. The DSH plugin namespace
// keeps the variable self-describing and collision-free.
const CSS_KEY = 'DSH_PLUGIN_GITHUB_APP_CSS'

const minifier = postcss([cssnano({ preset: 'default' })])

const readEnv = (path: string): Record<string, string> =>
  fs.existsSync(path) ? dotenv.parse(fs.readFileSync(path, 'utf-8')) : {}

function writeEnv (path: string, vars: Record<string, string>): void {
  const content = Object.entries(vars)
    .map(([key, value]) => `${key}='${value}'`)
    .join('\n')

  fs.writeFileSync(path, content, 'utf-8')
}

async function generateEnvFromScss () {
  console.log('Starting env from scss')

  const css = sass.compile(INPUT_SCSS).css
  const minified = (await minifier.process(css, { from: undefined })).css

  const existing = readEnv(OUTPUT_ENV)
  const added = CSS_KEY in existing ? 0 : 1
  const updated = CSS_KEY in existing && existing[CSS_KEY] !== minified ? 1 : 0

  writeEnv(OUTPUT_ENV, { [CSS_KEY]: minified })

  console.log(`Successfully updated ${OUTPUT_ENV} (Updated: ${updated}, Added: ${added})`)
}

generateEnvFromScss().catch(console.error)
