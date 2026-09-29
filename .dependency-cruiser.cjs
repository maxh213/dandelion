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
      comment: 'Probes that own an IO port (kimi launcher/fetcher, grok and junie file readers, cursor and hermes fetcher/reader) are not CLI probes; they know domain only, not the cli skeleton',
      from: { path: '^src/probes/(kimi|grok|junie|cursor|hermes)\\.ts$' },
      to: { path: '^src/probes/' }
    },
    {
      name: 'domain-ports-behind-index',
      severity: 'error',
      comment: 'The shared Fetcher and FileReader ports, request-failure reasons, and unknown-payload reading (parseJson, fieldOf, newestLineMatch) live in domain/ports.ts; everything, tests included, reaches them only through domain/index.ts',
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
      name: 'domain-entry-lists-its-files',
      severity: 'error',
      comment: 'domain/index.ts fronts exactly four leaves, each hiding one piece of knowledge: ports (IO contracts and unknown-payload reading), route (both route policies, the one shared trip, and the routes.json shape that names their lines, validated into lines or a fault), midnight (local calendar search), eligibility (the state file toggle); a new domain file is a deliberate contract change',
      from: { path: '^src/domain/index\\.ts$' },
      to: { path: '^src/domain/', pathNot: '^src/domain/(index|ports|route|midnight|eligibility)\\.ts$' }
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
      name: 'kilo-is-a-cli-declaration',
      severity: 'error',
      comment: 'kilo.ts is CliProbe data (balance from CLI stdout); it takes only types from domain, so it cannot run JSON or IO checks itself',
      from: { path: '^src/probes/kilo\\.ts$' },
      to: { path: '^src/domain/', dependencyTypesNot: ['type-only'] }
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
      name: 'live-session-gets-eligibility-injected',
      severity: 'error',
      comment: 'The live session sees only the render entry and probe types; the Eligibility it toggles and the Routes its boxes show are opened by app/index.ts over the real state and routes files, never by a sibling module',
      from: { path: '^src/app/live\\.ts$' },
      to: { pathNot: '^src/(render|probes)/index\\.ts$' }
    },
    {
      name: 'route-lines-are-read-not-bundled',
      severity: 'error',
      comment: 'Route lines are data: app/index.ts reads routes.json (or DANDELION_ROUTES_FILE) at run time through the RoutesFile port, so a missing or bad file is the exit-2 error; no module bundles a JSON file, the shipped routes.json or a fixture, as an import',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { path: '\\.json$' }
    },
    {
      name: 'main-is-the-entry',
      severity: 'error',
      comment: 'main.ts is the process entry; nothing but its own test imports it',
      from: { path: '^src/', pathNot: '^src/main\\.test\\.ts$' },
      to: { path: '^src/main\\.ts$' }
    },
    {
      name: 'route-output-is-plain',
      severity: 'error',
      comment: 'render/route.ts turns the domain route decision into one scriptable line and its exit code, and a routes file fault into the one dandelion: stderr line with exit 2; it never reaches the ANSI dashboard renderer, and the dashboard renderer never reaches it. live-frame.ts draws the route boxes from domain lines, never from this renderer',
      from: { path: '^src/render/(route|terminal)\\.ts$' },
      to: { path: '^src/render/' }
    },
    {
      name: 'route-renderer-knows-domain-entry-only',
      comment: 'render/route.ts picks the route policy (010 headroom or the --high chain) from one RouteRequest; it reaches the domain policies through domain/index.ts and nothing else, no Node built-ins, no probes, no render siblings',
      severity: 'error',
      from: { path: '^src/render/route\\.ts$' },
      to: { pathNot: '^src/domain/index\\.ts$' }
    },
    {
      name: 'dashboard-renderer-knows-domain-entry-only',
      severity: 'error',
      comment: 'render/terminal.ts is the --once dashboard (72-cell panels, gauges, banner); it is a leaf like route.ts, reaching domain only through domain/index.ts, no Node built-ins, no render siblings',
      from: { path: '^src/render/terminal\\.ts$' },
      to: { pathNot: '^src/domain/index\\.ts$' }
    },
    {
      name: 'live-frame-uses-dashboard-drawing',
      severity: 'error',
      comment: 'The live TUI (chrome, route boxes, panel-region scroll) reuses the --once dashboard drawing from terminal.ts; it never reaches the scriptable route renderer, whose answers it already gets from domain',
      from: { path: '^src/render/live-frame\\.ts$' },
      to: { path: '^src/render/', pathNot: '^src/render/terminal\\.ts$' }
    },
    {
      name: 'live-frame-knows-domain-and-dashboard-only',
      severity: 'error',
      comment: 'live-frame.ts reaches domain policies and midnight through domain/index.ts and dashboard drawing through terminal.ts; no Node built-ins, no probes, no other render files',
      from: { path: '^src/render/live-frame\\.ts$' },
      to: { pathNot: ['^src/domain/index\\.ts$', '^src/render/terminal\\.ts$'] }
    },
    {
      name: 'render-entry-lists-its-files',
      severity: 'error',
      comment: 'render/index.ts fronts exactly three files, each hiding one piece of knowledge: route (the scriptable one-line), terminal (the --once dashboard), live-frame (the live TUI: chrome, boxes, panel-region scroll); a new render file is a deliberate contract change',
      from: { path: '^src/render/index\\.ts$' },
      to: { path: '^src/render/', pathNot: '^src/render/(index|route|terminal|live-frame)\\.ts$' }
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
      name: 'main-entry-no-node-modules',
      severity: 'error',
      comment: 'main.ts only dispatches; entry detection (real paths, file URLs) and all other Node APIs stay behind app/index.ts',
      from: { path: '^src/main\\.ts$' },
      to: { path: `^(node:)?(${builtinModules.join('|')})(/|$)` }
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
    includeOnly: ['^src', '^routes\\.json$', '^node:', ...builtinModules.map((name) => `^${name}$`)]
  }
};
