/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-cannot-import-outer-layers',
      comment: 'Domain layer in core contexts may only import shared-kernel',
      severity: 'error',
      from: { path: '^src/contexts/(payments|dispensing)/domain' },
      to: {
        path: [
          '^src/contexts/(payments|dispensing)/(application|infrastructure|interface)',
          '^src/platform',
          '^src/contexts/(fleet|monitoring|identity|reporting)',
        ],
      },
    },
    {
      name: 'application-cannot-import-infra-or-interface',
      comment: 'Application layer may import domain, shared-kernel, and platform ports, but never infrastructure or interface',
      severity: 'error',
      from: { path: '^src/contexts/(payments|dispensing)/application' },
      to: {
        path: [
          '^src/contexts/(payments|dispensing)/(infrastructure|interface)',
        ],
      },
    },
    {
      name: 'infrastructure-cannot-import-interface',
      comment: 'Infrastructure layer must never import interface',
      severity: 'error',
      from: { path: '^src/contexts/(payments|dispensing)/infrastructure' },
      to: {
        path: [
          '^src/contexts/(payments|dispensing)/interface',
        ],
      },
    },
    {
      name: 'interface-cannot-import-domain-or-infra',
      comment: 'Interface layer must call application use cases, never directly importing domain internals or infrastructure',
      severity: 'error',
      from: { path: '^src/contexts/(payments|dispensing)/interface' },
      to: {
        path: [
          '^src/contexts/(payments|dispensing)/domain',
          '^src/contexts/(payments|dispensing)/infrastructure',
        ],
      },
    },
    {
      name: 'no-cross-context-internal-imports',
      comment: 'Contexts must never import internal layers of other contexts directly',
      severity: 'error',
      from: { path: '^src/contexts/([^/]+)/.+' },
      to: {
        path: '^src/contexts/([^/]+)/.+',
        pathNot: [
          '^src/contexts/$1/.+',
          '^src/contexts/[^/]+/application/public/.+',
        ],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
  },
};
