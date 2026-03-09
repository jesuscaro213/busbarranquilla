import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories/users_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/error/result.dart';

class FavoritesNotifier extends AsyncNotifier<List<BusRoute>> {
  @override
  Future<List<BusRoute>> build() => load();

  Future<List<BusRoute>> load() async {
    final result = await ref.read(usersRepositoryProvider).getFavorites();
    return switch (result) {
      Success<List<BusRoute>>(data: final routes) => routes,
      Failure<List<BusRoute>>() => const <BusRoute>[],
    };
  }

  Future<void> addFavorite(int routeId) async {
    final result = await ref.read(usersRepositoryProvider).addFavorite(routeId);
    if (result is Success<void>) {
      state = const AsyncLoading();
      state = AsyncData(await load());
    }
  }

  Future<void> removeFavorite(int routeId) async {
    final result = await ref.read(usersRepositoryProvider).removeFavorite(routeId);
    if (result is Success<void>) {
      state = const AsyncLoading();
      state = AsyncData(await load());
    }
  }

  bool isFavorite(int routeId) {
    final routes = state.valueOrNull ?? const <BusRoute>[];
    for (final route in routes) {
      if (route.id == routeId) {
        return true;
      }
    }
    return false;
  }
}

final favoritesProvider = AsyncNotifierProvider<FavoritesNotifier, List<BusRoute>>(
  FavoritesNotifier.new,
);
