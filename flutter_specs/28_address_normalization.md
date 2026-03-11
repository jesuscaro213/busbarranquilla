# Spec 28 — Colombian Address Normalization in Planner

## Problem
The web normalizes Colombian addresses before sending them to Nominatim: "Cr 52 N 45" becomes
"Cr 52 #45". This helps Nominatim parse the query correctly. Flutter's `PlannerNotifier.searchAddress()`
sends the raw query without any normalization, so addresses with the "N" separator return zero
results.

## Goal
In `PlannerNotifier.searchAddress()`, apply Colombian address normalization before appending
"Barranquilla Colombia" and calling Nominatim.

---

## Files to modify

### 1. `flutter_app/lib/features/planner/providers/planner_notifier.dart`

#### 1a. Add a private static helper `_normalizeColombianAddress`

```dart
/// Normalizes Colombian addresses:
///   "Cr 52 N 45-12"  → "Cr 52 #45-12"
///   "Calle 30 N 42"  → "Calle 30 #42"
/// The "N" separator (case-insensitive, surrounded by spaces) is replaced with "#".
static String _normalizeColombianAddress(String query) {
  // Replace " N " separator (word boundary, case-insensitive) with " #"
  return query.replaceAllMapped(
    RegExp(r'\s+[Nn]\s+'),
    (match) => ' #',
  );
}
```

#### 1b. Apply normalization inside `searchAddress()`

Replace the line:
```dart
'q': '$cleanQuery Barranquilla Colombia',
```

With:
```dart
'q': '${_normalizeColombianAddress(cleanQuery)} Barranquilla Colombia',
```

---

## Acceptance criteria
- `_normalizeColombianAddress('Cr 52 N 45-12')` returns `'Cr 52 #45-12'`.
- `_normalizeColombianAddress('Calle 30 n 42')` returns `'Calle 30 #42'`.
- `_normalizeColombianAddress('Carrera 43 A')` returns `'Carrera 43 A'` (no change).
- `flutter analyze` reports 0 new issues.
