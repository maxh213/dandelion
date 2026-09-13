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
      name: 'spawn-only-in-app',
      severity: 'error',
      comment: 'Only the app edge spawns processes; everything else goes through the injected CommandRunner',
      from: { path: '^src/', pathNot: ['^src/app/index\\.ts$', '\\.test\\.ts$'] },
      to: { path: '^(node:)?child_process$' }
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
      comment: 'App depends on probes, render, domain',
      from: { path: '^src/app' },
      to: { path: '^src/', pathNot: '^src/(domain|probes|render|app)/' }
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
