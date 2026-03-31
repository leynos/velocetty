Validate required config fields and add debug logging for unknown keys

Add validation in `mergeLayers` to ensure `defaultProfile` and `profiles`
fields are present after merging configuration layers. This is a defensive
assertion for direct callers of `mergeLayers`; `resolveConfigLayers` always
supplies a complete defaults layer.

Add debug-level logging in `requiresRestart` and `isLiveReloadable` when
`getReloadability` returns `undefined`. This provides visibility into when
an unknown config key defaults to restart-required classification.

Update tests to include required fields in test data and verify that
`mergeLayers` throws when required fields are missing.
