const { builtinModules } = require('node:module');

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No circular dependencies allowed',
      from: {},
      to: { circular: true }
    },
    {
      name: 'domain-layer',
      severity: 'error',
      comment: 'Domain must not depend on anything outside domain, Node built-ins included',
      from: { path: '^src/domain' },
      to: { pathNot: '^src/domain' }
    },
    {
      name: 'probes-layer',
      severity: 'error',
      comment: 'Probes depend on domain only and do no IO themselves',
      from: { path: '^src/probes' },
      to: { pathNot: '^src/(domain|probes)' }
    },
    {
      name: 'probe-definitions-independent',
      severity: 'error',
      comment: 'Each CLI probe knows only the cli skeleton and domain; only probes/index.ts composes them',
      from: { path: '^src/probes/', pathNot: ['^src/probes/index\\.ts$', '\\.test\\.ts$'] },
      to: { path: '^src/probes/', pathNot: '^src/probes/cli\\.ts$' }
    },
    {
      name: 'port-probes-stand-alone',
      severity: 'error',
      comment: 'Probes that own an IO port (kimi launcher/fetcher, grok file reader, cursor fetcher/reader) are not CLI probes; they know domain only, not the cli skeleton',
      from: { path: '^src/probes/(kimi|grok|cursor)\\.ts$' },
      to: { path: '^src/probes/' }
    },
    {
      name: 'domain-ports-behind-index',
      severity: 'error',
      comment: 'The shared Fetcher and FileReader ports and the request-failure reasons live in domain/ports.ts; everything, tests included, reaches them only through domain/index.ts',
      from: { path: '^src/', pathNot: '^src/domain/index\\.ts$' },
      to: { path: '^src/domain/', pathNot: '^src/domain/index\\.ts$' }
    },
    {
      name: 'domain-leaf-files',
      severity: 'error',
      comment: 'Files behind domain/index.ts are leaves: they import nothing, not even each other',
      from: { path: '^src/domain/', pathNot: '^src/domain/index(\\.test)?\\.ts$' },
      to: {}
    },
    {
      name: 'cli-skeleton-run-only-by-index',
      severity: 'error',
      comment: 'Probe definitions and codex take only types from cli.ts (CliProbe, the CommandRunner port); only probes/index.ts runs probeCli',
      from: { path: '^src/probes/', pathNot: ['^src/probes/index\\.ts$', '\\.test\\.ts$'] },
      to: { path: '^src/probes/cli\\.ts$', dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'probe-composition-only-wires',
      severity: 'error',
      comment: 'probes/index.ts lists the probes in panel order; it takes only types from domain and holds no probe rules of its own',
      from: { path: '^src/probes/index\\.ts$' },
      to: { path: '^src/domain/', dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'claude-accounts-are-declarations',
      severity: 'error',
      comment: 'claude.ts declares both accounts as CliProbe data (the work config dir is a requiresDirectory the cli skeleton checks); it reaches nothing in domain, so it cannot run IO checks itself',
      from: { path: '^src/probes/claude\\.ts$' },
      to: { path: '^src/domain/' }
    },
    {
      name: 'app-imported-only-by-main',
      severity: 'error',
      comment: 'The app composes probes, render and the real IO; only the main entry and tests reach it',
      from: { path: '^src/', pathNot: ['^src/app/', '^src/main\\.ts$', '\\.test\\.ts$'] },
      to: { path: '^src/app/' }
    },
    {
      name: 'spawn-only-in-app',
      severity: 'error',
      comment: 'Only the app edge spawns processes; everything else goes through the injected CommandRunner or Launcher',
      from: { path: '^src/', pathNot: ['^src/app/index\\.ts$', '\\.test\\.ts$'] },
      to: { path: '^(node:)?child_process$' }
    },
    {
      name: 'io-only-in-app',
      severity: 'error',
      comment: 'Filesystem, OS, network and stream modules live only at the app edge, behind the injected Launcher, Fetcher, FileReader and RpcSpawner; probes see child stdout only as lines',
      from: { path: '^src/', pathNot: ['^src/app/index\\.ts$', '\\.test\\.ts$'] },
      to: { path: '^(node:)?(fs|fs/promises|os|net|http|https|http2|dgram|dns|tls|readline|readline/promises|stream|stream/promises)$' }
    },
    {
      name: 'live-session-no-io',
      severity: 'error',
      comment: 'The live session controller (rounds, ticks, keys, quit) owns no IO; the screen, keyboard and child stopping are injected by app/index.ts',
      from: { path: '^src/app/live\\.ts$' },
      to: { path: `^(node:)?(${builtinModules.join('|')})(/|$)` }
    },
    {
      name: 'live-session-takes-probe-types-only',
      severity: 'error',
      comment: 'The live session receives its ProviderProbe list from app/index.ts; it never builds or runs probes from the probes layer itself',
      from: { path: '^src/app/live\\.ts$' },
      to: { path: '^src/probes/', dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'main-is-the-entry',
      severity: 'error',
      comment: 'main.ts is the process entry; nothing but its own test imports it',
      from: { path: '^src/', pathNot: '^src/main\\.test\\.ts$' },
      to: { path: '^src/main\\.ts$' }
    },
    {
      name: 'render-layer',
      severity: 'error',
      comment: 'Render depends on domain only, never on probes, and does no IO',
      from: { path: '^src/render' },
      to: { pathNot: '^src/(domain|render)' }
    },
    {
      name: 'app-layer',
      severity: 'error',
      comment: 'App depends on probes and render; the port types it implements come through probes/index.ts, never straight from domain',
      from: { path: '^src/app' },
      to: { path: '^src/', pathNot: '^src/(probes|render|app)/' }
    },
    {
      name: 'main-entry',
      severity: 'error',
      comment: 'Main depends on app',
      from: { path: '^src/main\\.ts$' },
      to: { path: '^src/', pathNot: '^src/app/' }
    },
    {
      name: 'module-entry-only',
      severity: 'error',
      comment: 'Another layer is reached only through its index.ts; files behind it are private',
      from: { path: '^src/([^/]+)/' },
      to: { path: '^src/[^/]+/', pathNot: ['^src/$1/', '^src/[^/]+/index\\.ts$'] }
    },
    {
      name: 'entry-reaches-modules-through-index',
      severity: 'error',
      comment: 'Top-level entry files reach layers only through their index.ts',
      from: { path: '^src/[^/]+\\.ts$' },
      to: { path: '^src/[^/]+/', pathNot: '^src/[^/]+/index\\.ts$' }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    includeOnly: ['^src', '^node:', ...builtinModules.map((name) => `^${name}$`)]
  }
};
