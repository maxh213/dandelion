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
      comment: 'Domain must not depend on anything outside domain',
      from: { path: '^src/domain' },
      to: { pathNot: '^src/domain' }
    },
    {
      name: 'probes-layer',
      severity: 'error',
      comment: 'Probes depend on domain only',
      from: { path: '^src/probes' },
      to: { pathNot: '^src/(domain|probes)' }
    },
    {
      name: 'render-layer',
      severity: 'error',
      comment: 'Render depends on domain only, never on probes',
      from: { path: '^src/render' },
      to: { pathNot: '^src/(domain|render)' }
    },
    {
      name: 'app-layer',
      severity: 'error',
      comment: 'App depends on probes, render, domain',
      from: { path: '^src/app' },
      to: { pathNot: '^src/(domain|probes|render|app)' }
    },
    {
      name: 'main-entry',
      severity: 'error',
      comment: 'Main depends on app',
      from: { path: '^src/main\\.ts$' },
      to: { pathNot: '^src/app' }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    includeOnly: '^src'
  }
};
