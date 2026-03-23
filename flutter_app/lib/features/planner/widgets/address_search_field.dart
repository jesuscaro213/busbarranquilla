import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../models/nominatim_result.dart';

class AddressSearchField extends StatefulWidget {
  final String label;
  final String? initialValue;
  final Future<List<NominatimResult>> Function(String query) onSearch;
  final ValueChanged<NominatimResult> onSelect;
  final VoidCallback? onPickFromMap;

  const AddressSearchField({
    required this.label,
    required this.onSearch,
    required this.onSelect,
    this.initialValue,
    this.onPickFromMap,
    super.key,
  });

  @override
  State<AddressSearchField> createState() => _AddressSearchFieldState();
}

class _AddressSearchFieldState extends State<AddressSearchField> {
  late final TextEditingController _controller;
  Timer? _debounce;
  bool _isSearching = false;
  List<NominatimResult> _suggestions = const <NominatimResult>[];
  String _lastQuery = '';

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialValue ?? '');
  }

  @override
  void didUpdateWidget(covariant AddressSearchField oldWidget) {
    super.didUpdateWidget(oldWidget);
    final newText = widget.initialValue ?? '';
    if (oldWidget.initialValue != widget.initialValue && _controller.text != newText) {
      _controller.text = newText;
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onChanged(String value) async {
    _debounce?.cancel();
    _lastQuery = value;

    if (value.trim().length < 3) {
      setState(() {
        _isSearching = false;
        _suggestions = const <NominatimResult>[];
      });
      return;
    }

    _debounce = Timer(const Duration(milliseconds: 300), () async {
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
    setState(() {
      _suggestions = const <NominatimResult>[];
    });
    widget.onSelect(result);
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

  Map<String, int> _ambiguityCounts(List<NominatimResult> items) {
    final counts = <String, int>{};
    for (final item in items) {
      final key = _baseName(item.displayName).toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  @override
  Widget build(BuildContext context) {
    final ambiguityCounts = _ambiguityCounts(_suggestions);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TextField(
          controller: _controller,
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
        if (_isSearching)
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.surface,
              border: Border.all(color: AppColors.divider),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Row(
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
        else if (_suggestions.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 6),
            decoration: BoxDecoration(
              color: AppColors.surface,
              border: Border.all(color: AppColors.divider),
              borderRadius: BorderRadius.circular(10),
            ),
            constraints: const BoxConstraints(maxHeight: 220),
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: _suggestions.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final item = _suggestions[index];
                final location = _metroCityLabel(item.displayName);
                final key = _baseName(item.displayName).toLowerCase();
                final isAmbiguous = (ambiguityCounts[key] ?? 0) > 1;
                return ListTile(
                  dense: true,
                  title: Text(
                    item.displayName,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: !isAmbiguous || location == null
                      ? null
                      : Text(
                          location,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.primary,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                  onTap: () => _select(item),
                );
              },
            ),
          )
        else if (_lastQuery.trim().length >= 3)
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.surface,
              border: Border.all(color: AppColors.divider),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(Icons.search_off, color: AppColors.textSecondary, size: 18),
                SizedBox(width: 10),
                Expanded(
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
              ],
            ),
          ),
      ],
    );
  }
}
