# Telemetry accuracy implementation plan

Goal: keep 8111 observations, local attribution and every Coopanion-facing projection consistent, then review and publish an immutable tested package.

Baseline: a969181e214f7a66d8e0865758e72889835adf7c, v0.2.10. Preserve pristine and the previous audit. Do not modify installed Coopanion settings or issue game inputs.

1. Add failing endpoint-fixture regressions for exact player identity, verb boundaries, time-aware deduplication, sliding/restarted feeds, chronological kills/deaths and indicator/feed double counting.
2. Apply the smallest changes in battle.ts; keep existing public tooling and full-feed polling. Preserve unknown states, explicit units and source labels rather than guessing.
3. Add failing integration regressions for zero-kill cheer, stale/offline commentary, online/state projection and informational HUD events; fix world.ts/copy.ts and environment guidance.
4. Run the same transaction probe against baseline, modified and a restored copy. Reopen MODIFIED_FILE, DIFF.patch, VERIFICATION.txt and ROLLBACK.sh; verify original hashes and patch reconstruction.
5. Update version, changelog, README and generated describe.json. Run all tests, types, official extension check and final tarball checks.
6. Dispatch an independent fresh-context code reviewer; resolve important feedback. CodeRabbit installer reported unsupported mingw64_nt-10.0-22631; do not claim it ran.
7. Push the reviewed release commit to GitHub without rewriting remote history; publish exactly the verified npm tarball, then verify remote commit and registry integrity. Preserve publication errors and request human OTP only if required.

Acceptance: accurate regression outputs, tests/types/contracts green, clean baseline, working rollback and verified GitHub/npm publication. Live game validation remains separately labeled unavailable while localhost:8111 refuses connections.
