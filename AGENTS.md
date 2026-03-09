# AGENTS.md

You are building the Flutter mobile app for **MiBus** — a real-time collaborative public transport app for Barranquilla, Colombia.

## Before writing any code

1. Read `FLUTTER_SPEC.md` in full. It is the single source of truth for architecture, folder structure, API endpoints, models, business rules, and design system.
2. Read the "Clean code rules" section of `FLUTTER_SPEC.md`. Every rule is non-negotiable.
3. Do not start writing screens or features until the entire `core/` layer is complete.

## How to work

- Follow the **Implementation order** section of `FLUTTER_SPEC.md` exactly. Complete each step fully before moving to the next.
- Every file you create must fit into the folder structure defined in `FLUTTER_SPEC.md`. Do not create files outside that structure.
- After completing each step, stop and summarize what was built before continuing.

## Rules — enforced on every file

1. **No copy-paste.** If you write the same logic twice, stop and extract it to a shared abstraction.
2. **No business logic in widgets.** Widgets render state and call notifiers. Nothing else.
3. **No hardcoded strings in widgets.** All user-facing text → `AppStrings`. All API paths → `ApiPaths`. All colors → `AppColors`.
4. **No `Dio` calls outside repositories.** The only place that calls the network is a `*Repository` via its `*RemoteSource`.
5. **No `dynamic` returns.** Every function has a typed return value. Errors use `Result<T>` / `AppError`.
6. **No JSON parsing outside models.** Every model has `fromJson` / `toJson`. Parse only there.
7. **No new patterns.** Use the exact same `RemoteSource → Repository → Notifier → Screen` pattern for every feature. Do not invent alternatives.
8. **No `setState` for shared state.** Only for local UI state (e.g., focus, toggle visibility). Everything else goes through Riverpod.
9. **One responsibility per file.** If you need "and" to describe what a file does, split it.
10. **Shared widgets first.** Before building any screen, check if a shared widget in `lib/shared/widgets/` already covers the need. If yes, use it. If no, create it there — not inside the feature folder.

## If you are unsure

- Default to the pattern shown in `FLUTTER_SPEC.md` for that layer.
- If the spec does not cover a case, apply the closest existing pattern and note the decision.
- Never guess API response shapes — all shapes are documented in `FLUTTER_SPEC.md`.
