# Experimental features

Experimental features let us ship unfinished work to people who opt in, without a separate build.
Everything is driven by one registry; there is no other wiring.

## How it works

- `src/lib/experimental.ts` holds the registry (`experimentalFeatures`). With **no entries**, Settings has no
  Experimental section and the Settings nav item shows no dot.
- With one or more entries, **Settings > Experimental** lists each feature with a toggle, its description and the
  Mochi version that added it. Features the user has not seen yet get a **New** badge, and the Settings item in the
  navigation shows a small dot until the section has been opened once.
- The user's choices live in `Behavior.experimental` (enabled ids) and `Behavior.experimentalSeen` (ids already shown)
  in `src/state/settings.ts`. Ids that are no longer in the registry are dropped when settings are loaded, so
  removing a feature never leaves stale flags behind.

## Adding a feature

1. Add an entry to `experimentalFeatures`:

   ```ts
   { id: "library-timeline", name: "Library timeline", description: "A chronological view of what you played.", since: "0.4.0" }
   ```

   Ids are stable, lowercase, dash-separated, and never reused for a different feature.
2. Gate the UI (or behaviour) in a component:

   ```tsx
   const timeline = useExperimental("library-timeline");
   return timeline ? <Timeline /> : null;
   ```

   `useExperimental` is `false` for unknown ids and when the user has not switched the feature on.
3. Keep the gated code self-contained so removing the gate later is a small change.
4. Gate Rust commands only when they are unsafe to expose; otherwise leave them in place and gate the UI.

## Graduating a feature

When the feature is ready:

1. Remove the `useExperimental(...)` checks so the code always runs.
2. Delete its entry from `experimentalFeatures`. Saved flags are cleaned up automatically on the next load.
3. If it was the last entry, the Experimental section and nav dot disappear by themselves.

Already part of the main app (not experimental): the Mods & Content tab and Nexus Mods search.

## Dropping a feature

Delete the entry and the gated code. Nothing else needs to change.
