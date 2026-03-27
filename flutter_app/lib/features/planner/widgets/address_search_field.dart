import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../models/nominatim_result.dart';
import '../models/search_history_entry.dart';

class AddressSearchField extends StatefulWidget {
  final String label;
  final String? initialValue;
  final Future<List<NominatimResult>> Function(String query) onSearch;
  final ValueChanged<NominatimResult> onSelect;
  final VoidCallback? onPickFromMap;
  final VoidCallback? onUseCurrentLocation;
  final List<SearchHistoryEntry> history;

  const AddressSearchField({
    required this.label,
    required this.onSearch,
    required this.onSelect,
    this.initialValue,
    this.onPickFromMap,
    this.onUseCurrentLocation,
    this.history = const <SearchHistoryEntry>[],
    super.key,
  });

  @override
  State<AddressSearchField> createState() => _AddressSearchFieldState();
}

class _AddressSearchFieldState extends State<AddressSearchField> {
  late final TextEditingController _controller;
  late final FocusNode _focusNode;
  Timer? _debounce;
  bool _isSearching = false;
  bool _hasFocus = false;
  bool _hasUserTyped = false;
  List<NominatimResult> _suggestions = const <NominatimResult>[];
  String _lastQuery = '';

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialValue ?? '');
    _focusNode = FocusNode()
      ..addListener(() {
        setState(() {
          _hasFocus = _focusNode.hasFocus;
          if (!_focusNode.hasFocus) _hasUserTyped = false;
        });
      });
  }

  @override
  void didUpdateWidget(covariant AddressSearchField oldWidget) {
    super.didUpdateWidget(oldWidget);
    final newText = widget.initialValue ?? '';
    if (oldWidget.initialValue != widget.initialValue && _controller.text != newText) {
      _controller.text = newText;
      _lastQuery = '';
      _suggestions = const <NominatimResult>[];
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _onChanged(String value) async {
    _debounce?.cancel();
    _lastQuery = value;
    if (value.isNotEmpty) _hasUserTyped = true;

    if (value.trim().length < 3) {
      setState(() {
        _isSearching = false;
        _suggestions = const <NominatimResult>[];
      });
      return;
    }

    _debounce = Timer(const Duration(milliseconds: 1100), () async {
      if (!mounted) return;

      setState(() {
        _isSearching = true;
      });

      final results = await widget.onSearch(value);
      if (!mounted) return;

      setState(() {
        _isSearching = false;
        _suggestions = results;
        _lastQuery = value;
      });
    });
  }

  void _select(NominatimResult result) {
    _controller.text = result.displayName;
    _focusNode.unfocus();
    setState(() {
      _suggestions = const <NominatimResult>[];
      _lastQuery = '';
    });
    widget.onSelect(result);
  }

  void _selectFromHistory(SearchHistoryEntry entry) {
    _select(NominatimResult(
      displayName: entry.displayName,
      lat: entry.lat,
      lng: entry.lng,
    ));
  }

  String _relativeTime(DateTime lastUsed) {
    final diff = DateTime.now().difference(lastUsed);
    if (diff.inDays == 0) return 'hoy';
    if (diff.inDays == 1) return 'ayer';
    if (diff.inDays < 7) return 'hace ${diff.inDays} días';
    final weeks = (diff.inDays / 7).floor();
    return 'hace $weeks semana${weeks > 1 ? 's' : ''}';
  }

  String? _metroCityLabel(String displayName) {
    final lower = displayName.toLowerCase();
    if (lower.contains('barranquilla')) return 'Barranquilla';
    if (lower.contains('soledad')) return 'Soledad';
    if (lower.contains('malambo')) return 'Malambo';
    if (lower.contains('puerto colombia')) return 'Puerto Colombia';
    if (lower.contains('galapa')) return 'Galapa';
    return null;
  }

  String _baseName(String displayName) {
    final parts = displayName.split(',').map((p) => p.trim()).where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? displayName.trim() : parts.first;
  }

  /// Returns a short secondary label (barrio + city) to disambiguate addresses
  /// with the same base name, e.g. "El Bosque, Barranquilla".
  String? _secondaryName(String displayName) {
    final parts = displayName.split(',').map((p) => p.trim()).where((p) => p.isNotEmpty).toList();
    if (parts.length < 2) return null;

    // Find the city among the AMB municipalities
    const cities = <String>['Barranquilla', 'Soledad', 'Malambo', 'Puerto Colombia', 'Galapa'];
    String? city;
    for (final c in cities) {
      if (displayName.toLowerCase().contains(c.toLowerCase())) {
        city = c;
        break;
      }
    }

    // Second part is typically the barrio/neighborhood
    final barrio = parts[1];
    if (city != null && barrio.toLowerCase() != city.toLowerCase()) {
      return '$barrio, $city';
    }
    return barrio;
  }


  SearchHistoryEntry? _historyMatchFor(String displayName) {
    final lower = displayName.toLowerCase();
    for (final h in widget.history) {
      if (h.displayName.toLowerCase() == lower) return h;
    }
    return null;
  }

  bool get _showEmptyDropdown =>
      _hasFocus &&
      _controller.text.isEmpty &&
      !_hasUserTyped &&
      (widget.onUseCurrentLocation != null || widget.history.isNotEmpty);

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TextField(
          controller: _controller,
          focusNode: _focusNode,
          decoration: InputDecoration(
            labelText: widget.label,
            suffixIcon: _isSearching
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : widget.onPickFromMap != null
                    ? IconButton(
                        icon: const Icon(Icons.map_outlined),
                        tooltip: AppStrings.mapPickTitle,
                        onPressed: widget.onPickFromMap,
                      )
                    : const Icon(Icons.search),
          ),
          onChanged: _onChanged,
        ),

        // ── Empty + focused dropdown: GPS option + history ───────────────────
        if (_showEmptyDropdown) ...<Widget>[
          if (widget.onUseCurrentLocation != null)
            _ResultCard(
              onTap: () {
                _controller.text = AppStrings.currentLocationLabel;
                _focusNode.unfocus();
                setState(() {
                  _suggestions = const <NominatimResult>[];
                  _lastQuery = '';
                });
                widget.onUseCurrentLocation!();
              },
              leading: const Icon(Icons.my_location, size: 18, color: AppColors.primary),
              title: AppStrings.useCurrentLocation,
            ),
          ...widget.history.map((entry) {
            final secondary = _secondaryName(entry.displayName);
            return _ResultCard(
              onTap: () => _selectFromHistory(entry),
              leading: const Icon(Icons.history, size: 18, color: AppColors.textSecondary),
              title: _baseName(entry.displayName),
              subtitle: secondary,
              trailing: _relativeTime(entry.lastUsed),
            );
          }),
        ]

        // ── Searching indicator ──────────────────────────────────────────────
        else if (_isSearching)
          const _DropdownContainer(
            child: Row(
              children: <Widget>[
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: 10),
                Text(
                  AppStrings.plannerSearching,
                  style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
                ),
              ],
            ),
          )

        // ── Nominatim suggestions ────────────────────────────────────────────
        else if (_suggestions.isNotEmpty)
          ..._suggestions.map((item) {
            final location = _metroCityLabel(item.displayName);
            final historyMatch = _historyMatchFor(item.displayName);

            String? subtitleText;
            Color subtitleColor = AppColors.primary;

            if (historyMatch != null) {
              subtitleText = _relativeTime(historyMatch.lastUsed);
              subtitleColor = AppColors.accent;
            } else {
              subtitleText = _secondaryName(item.displayName) ?? location;
              subtitleColor = AppColors.textSecondary;
            }

            return _ResultCard(
              onTap: () => _select(item),
              leading: historyMatch != null
                  ? const Icon(Icons.history, size: 16, color: AppColors.accent)
                  : const Icon(Icons.location_on_outlined, size: 16, color: AppColors.textSecondary),
              title: _baseName(item.displayName),
              subtitle: subtitleText,
              subtitleColor: subtitleColor,
            );
          })

        // ── No results ───────────────────────────────────────────────────────
        else if (_lastQuery.trim().length >= 3)
          _DropdownContainer(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: <Widget>[
                const Icon(Icons.search_off, color: AppColors.textSecondary, size: 18),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        AppStrings.plannerNoResults,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        AppStrings.plannerNoResultsHint,
                        style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                ),
                if (widget.onPickFromMap != null)
                  TextButton.icon(
                    onPressed: widget.onPickFromMap,
                    icon: const Icon(Icons.map_outlined, size: 16),
                    label: const Text('Mapa', style: TextStyle(fontSize: 12)),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _ResultCard extends StatelessWidget {
  final VoidCallback onTap;
  final Widget leading;
  final String title;
  final String? subtitle;
  final Color subtitleColor;
  final String? trailing;

  const _ResultCard({
    required this.onTap,
    required this.leading,
    required this.title,
    this.subtitle,
    this.subtitleColor = AppColors.textSecondary,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: <Widget>[
                leading,
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      if (subtitle != null) ...<Widget>[
                        const SizedBox(height: 2),
                        Text(
                          subtitle!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            color: subtitleColor,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (trailing != null) ...<Widget>[
                  const SizedBox(width: 8),
                  Text(
                    trailing!,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DropdownContainer extends StatelessWidget {
  final Widget child;

  const _DropdownContainer({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: child,
    );
  }
}
