import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../models/nominatim_result.dart';

class AddressSearchField extends StatefulWidget {
  final String label;
  final String? initialValue;
  final Future<List<NominatimResult>> Function(String query) onSearch;
  final ValueChanged<NominatimResult> onSelect;

  const AddressSearchField({
    required this.label,
    required this.onSearch,
    required this.onSelect,
    this.initialValue,
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

  @override
  Widget build(BuildContext context) {
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
                : const Icon(Icons.search),
          ),
          onChanged: _onChanged,
        ),
        if (_suggestions.isNotEmpty)
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
                return ListTile(
                  dense: true,
                  title: Text(
                    item.displayName,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  onTap: () => _select(item),
                );
              },
            ),
          ),
      ],
    );
  }
}
