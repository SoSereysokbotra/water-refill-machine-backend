module.exports = {
  forbidden: [
    {
      name: 'domain-cannot-import-infrastructure',
      severity: 'error',
      from: { path: '^test/fixtures/illegal-boundary/domain' },
      to: { path: '^test/fixtures/illegal-boundary/infrastructure' },
    },
  ],
};
