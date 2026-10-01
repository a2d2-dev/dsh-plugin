/**
 * tsdown build for dsh-a2d2: the node halves of the plugin plus the browser
 * bundle that draws the floating handoff indicator.
 *
 * - `lib/index.js` is the plugin and its `ctx.a2d2` service.
 * - `lib/command.js` is the `/handoff` command plugin (its own mount row,
 *   because cordis loads a plugin only once its declared services exist).
 * - `lib/tools.js` is the model tools plugin (its own mount row, for the same
 *   reason: it declares `tools`).
 * - `lib/invariant.js` is the package invariant companion the harness probes.
 * - `lib/client.js` is the browser half: a classic script registering a CJS
 *   closure factory with `window.__ModuleLoader__`, whose id equals the package
 *   name because the shell addresses bundles by the Loader entry name.
 *
 * Declarations ship from lib/types, emitted by `tsc -p tsconfig.build.json`, so
 * tsdown leaves them alone (`dts: false`, `clean: false`).
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const require = createRequire(import.meta.url)

/** The bundle id: the shell's row id is the Loader entry name, which is the package name. */
export const CLIENT_BUNDLE_ID = 'dsh-a2d2'

/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map(id => `node:${id}`),
])

/**
 * Module specifiers the web shell shares into its frozen module table.
 *
 * The seed words the shell installs (React, cordis, the slot and primitive
 * packages) plus the runtime's client entry, whose factory is preloaded before
 * the shell starts. An out-of-tree bundle copies this list rather than inventing
 * one: anything not here is inlined, and a value import of another
 * `@deepseek-ai` package is rejected by the purity gate below, because
 * cross-plugin collaboration goes through cordis services.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

/**
 * Wire and type layers a client bundle may inline: browser-safe declaration-only
 * surfaces with no runtime identity to share. `dsh-session-projection` is here
 * because this bundle imports only its declaration merges, which the compiler
 * erases before the gate sees them.
 */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand|session-projection)(\/|$)/

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

type BuildPlugin = NonNullable<UserConfig['plugins']>

/** One `<style data-plugin>` injector per CSS file, run when the factory executes. */
function injectTag(fileId: string, cssText: string): string {
  const tagId = `${CLIENT_BUNDLE_ID}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(cssText)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(CLIENT_BUNDLE_ID)};`,
    `  tag.dataset.pluginCss = tagId;`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    '}',
  ].join('\n')
}

/** Reject anything that cannot run in the browser module table. */
function purityGatePlugin(): BuildPlugin {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
          + 'select the dependency browser export or add an explicit browser implementation',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      if (INLINE_SAFE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module and not an inline-safe wire layer — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
  }
}

/** Compile `*.module.css` to a hashed class map and inject the stylesheet. */
function cssPlugin(): BuildPlugin {
  return {
    name: 'dsh-css-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css')) return null
      const abs = source.startsWith('.') || source.startsWith('/')
        ? (importer === undefined ? source : resolvePath(dirname(importer), source))
        : require.resolve(source)
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      if (fileId.endsWith('.module.css')) {
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        return [
          injectTag(fileId, code.toString()),
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      }
      return [injectTag(fileId, source.toString('utf8')), 'export default "";'].join('\n')
    },
  }
}

export default [
  {
    entry: { index: 'src/index.ts', command: 'src/command.ts', tools: 'src/tools.ts', invariant: 'src/invariant.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      'import.meta.resolve': 'undefined',
    },
    inputOptions: {
      resolve: { conditionNames: ['browser', 'import', 'require', 'default'] },
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGatePlugin(), cssPlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_BUNDLE_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      // The factory's `require` resolves module-table words only; it cannot load
      // a relative chunk URL in the browser, so the bundle stays one script.
      codeSplitting: false,
    },
  },
] satisfies UserConfig[]
