# Transport Migration Map

- Added: 2026-02-12
- Scope: roadmap item 1.1.2 — command invocation and event stream
  transport abstraction.
- Goal: keep command behaviour unchanged while allowing host transport
  swap later.

## Migration checklist

- [x] Define `RendererCommandTransport` in
  `shared/src/types/transport.ts`.
- [x] Implement Electron IPC adapter in
  `lib/transport/electron-ipc-transport.ts`.
- [x] Migrate command-layer emit paths in `lib/actions/*` from direct
  `rpc` usage to `transport`.
- [x] Migrate bootstrap event-stream subscriptions in `lib/index.tsx`
  to transport `on(...)`.
- [ ] Replace remaining `window.rpc` direct event hooks outside the
  command layer (notably `lib/containers/hyper.tsx` and
  `lib/components/term.tsx`).
- [x] Introduce a backend-agnostic transport factory (barrel module
  `lib/transport/index.ts` now encapsulates the Electron adapter).
- [ ] Remove direct Electron IPC coupling from the command layer in
  main-process and privileged-window code paths as they are added.

## Risk and follow-up checklist

- [ ] High-frequency event throughput verification should include the
  full bootstrap path (`ready -> init -> session add`) in automated
  coverage.
- [ ] `window.rpc` contract consumers should be migrated once transport
  consumer APIs are stabilized for all UI entry points.
- [ ] Keep `removeAllListeners()` return chaining semantics tested when
  transport lifecycles are added for teardown paths.

## Current owners

- `lib/command-registry.ts` and command emitters in `lib/actions/*`:
  migrated — import from `lib/transport` (barrel).
- `lib/transport/index.ts`: barrel module, single composition boundary
  for swapping the host adapter.
- `lib/transport/electron-ipc-transport.ts`: contract adapter source of
  truth.
- `lib/index.tsx`: transport-backed bootstrap wiring currently complete.
