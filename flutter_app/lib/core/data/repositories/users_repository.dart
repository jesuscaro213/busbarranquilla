import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../domain/models/bus_route.dart';
import '../../error/app_error.dart';
import '../../error/result.dart';
import '../sources/users_remote_source.dart';
import 'repository_helpers.dart';

class UsersRepository {
  final UsersRemoteSource _source;

  const UsersRepository(this._source);

  Future<Result<List<BusRoute>>> getFavorites() async {
    try {
      final data = await _source.getFavorites();
      final favorites = listAt(data, 'routes').map(BusRoute.fromJson).toList(growable: false);
      return Success<List<BusRoute>>(favorites);
    } on DioException catch (e) {
      return Failure<List<BusRoute>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<BusRoute>>(UnknownError());
    }
  }

  Future<Result<void>> addFavorite(int routeId) async {
    try {
      await _source.addFavorite(routeId);
      return const Success<void>(null);
    } on DioException catch (e) {
      return Failure<void>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<void>(UnknownError());
    }
  }

  Future<Result<void>> removeFavorite(int routeId) async {
    try {
      await _source.removeFavorite(routeId);
      return const Success<void>(null);
    } on DioException catch (e) {
      return Failure<void>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<void>(UnknownError());
    }
  }
}

final usersRepositoryProvider = Provider<UsersRepository>((ref) {
  return UsersRepository(UsersRemoteSource(ref.read(dioProvider)));
});
