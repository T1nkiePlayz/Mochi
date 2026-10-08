## Summary
<!-- What does this change and why? Link issues: Closes #123 -->

## Type
- [ ] Bug fix
- [ ] Feature
- [ ] Theme
- [ ] Refactor / performance
- [ ] Docs / CI / tooling

## Platforms tested
- [ ] Linux
- [ ] Steam Deck / gamepad
- [ ] macOS (Apple silicon / Intel)
- [ ] Browser dev mode only

## Checklist
- [ ] `npm run build` passes (theme validation, type-check, bundle)
- [ ] `cargo fmt`, `cargo clippy -D warnings` and `cargo test` pass (if Rust changed)
- [ ] Works offline / degrades gracefully without network
- [ ] No hard-coded colours; themes can restyle new UI (`docs/theme-hooks.md` regenerated)
- [ ] OS-specific code lives in the platform adapters; macOS considered
- [ ] Docs / README updated for user-facing changes
- [ ] No secrets or personal data committed
- [ ] I have read the [Code of Conduct](../CODE_OF_CONDUCT.md)

## Screenshots / recordings
<!-- Required for UI changes; show more than one theme if relevant. -->

## Notes for reviewers
