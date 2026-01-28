# Tracking issues

## BIOME-001 Re-enable Biome legacy rules

Status: Open  
Owner: TBD  
Last updated: 2026-01-28

### Summary

- Re-enable Biome rules currently disabled for legacy code:
  `noExplicitAny`, `noNonNullAssertion`, `useNodejsImportProtocol`,
  `useExhaustiveDependencies`, and the accessibility (a11y) rule set.
- Record each rule's enablement date in
  `docs/velocetty-hyper-codebase.md`.

### Exit criteria

- All targeted rules are enabled with no new lint violations.
- Roadmap item 1.4.8 is complete.
