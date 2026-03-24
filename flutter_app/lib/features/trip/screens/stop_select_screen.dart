import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/data/repositories/stops_repository.dart';
import '../../../core/domain/models/stop.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/empty_view.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../providers/trip_notifier.dart';
import '../providers/trip_state.dart';

class StopSelectScreen extends ConsumerStatefulWidget {
  final int routeId;

  /// When true, the trip is already active — selecting a stop sets the
  /// destination and activates dropoff alerts instead of starting a new trip.
  final bool setDestination;

  const StopSelectScreen({
    required this.routeId,
    this.setDestination = false,
    super.key,
  });

  @override
  ConsumerState<StopSelectScreen> createState() => _StopSelectScreenState();
}

class _StopSelectScreenState extends ConsumerState<StopSelectScreen> {
  bool _loading = true;
  String? _error;
  List<Stop> _stops = <Stop>[];
  int? _selectedStopId;

  @override
  void initState() {
    super.initState();
    Future<void>(() => _loadStops());
  }

  Future<void> _loadStops() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final result = await ref.read(stopsRepositoryProvider).listByRoute(widget.routeId);
    switch (result) {
      case Success<List<Stop>>(data: final stops):
        setState(() {
          _stops = stops;
          _loading = false;
        });
      case Failure(error: final error):
        setState(() {
          _error = error.message;
          _loading = false;
        });
    }
  }

  Future<void> _confirm() async {
    if (widget.setDestination) {
      // Trip is already active — find the selected stop and set it as destination.
      if (_selectedStopId == null) return;
      final stop = _stops.firstWhere((s) => s.id == _selectedStopId);
      await ref.read(tripNotifierProvider.notifier).setDestinationStop(stop);
      if (mounted) context.pop();
    } else {
      await ref.read(tripNotifierProvider.notifier).startTrip(
            widget.routeId,
            destinationStopId: _selectedStopId,
          );
      final current = ref.read(tripNotifierProvider);
      if (current is TripActive) {
        if (mounted) context.go('/trip');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLoadingTrip = !widget.setDestination &&
        ref.watch(tripNotifierProvider.select((s) => s is TripLoading));

    if (_loading) {
      return const Scaffold(body: LoadingIndicator());
    }

    if (_error != null) {
      return ErrorView(message: _error!, onRetry: _loadStops);
    }

    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.stopSelectTitle)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(AppStrings.tripSelectStopOptional),
              const SizedBox(height: 8),
              Expanded(
                child: _stops.isEmpty
                    ? const EmptyView(
                        icon: Icons.pin_drop_outlined,
                        message: AppStrings.tripNoStops,
                      )
                    : ListView.builder(
                        itemCount: _stops.length,
                        itemBuilder: (context, index) {
                          final stop = _stops[index];
                          final selected = stop.id == _selectedStopId;
                          return ListTile(
                            onTap: () => setState(() => _selectedStopId = stop.id),
                            title: Text(stop.name),
                            subtitle: Text('${stop.stopOrder}'),
                            trailing: selected ? const Icon(Icons.check_circle) : null,
                          );
                        },
                      ),
              ),
              const SizedBox(height: 8),
              AppButton.primary(
                label: widget.setDestination
                    ? AppStrings.confirmButton
                    : AppStrings.tripStartButton,
                isLoading: isLoadingTrip,
                onPressed: isLoadingTrip ? null : _confirm,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
