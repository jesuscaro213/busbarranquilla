import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../domain/models/bus_route.dart';
import '../../domain/models/plan_result.dart';
import '../../domain/models/route_activity.dart';
import '../../error/app_error.dart';
import '../../error/result.dart';
import '../sources/routes_remote_source.dart';
import 'repository_helpers.dart';

class RoutesRepository {
  final RoutesRemoteSource _source;

  const RoutesRepository(this._source);

  Future<Result<List<BusRoute>>> list({String? type}) async {
    try {
      final data = await _source.list(type: type);
      final routes = listAt(data, 'routes').map(BusRoute.fromJson).toList(growable: false);
      return Success<List<BusRoute>>(routes);
    } on DioException catch (e) {
      return Failure<List<BusRoute>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<BusRoute>>(UnknownError());
    }
  }

  Future<Result<BusRoute>> getById(int id) async {
    try {
      final data = await _source.getById(id);
      final route = BusRoute.fromJson(mapAt(data, 'route'));
      return Success<BusRoute>(route);
    } on DioException catch (e) {
      return Failure<BusRoute>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<BusRoute>(UnknownError());
    }
  }

  Future<Result<List<BusRoute>>> nearby({
    required double lat,
    required double lng,
    double radius = 0.5,
  }) async {
    try {
      final data = await _source.nearby(lat: lat, lng: lng, radius: radius);
      final routes = listAt(data, 'routes').map(BusRoute.fromJson).toList(growable: false);
      return Success<List<BusRoute>>(routes);
    } on DioException catch (e) {
      return Failure<List<BusRoute>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<BusRoute>>(UnknownError());
    }
  }

  Future<Result<List<BusRoute>>> activeFeed() async {
    try {
      final data = await _source.activeFeed();
      final routes = listAt(data, 'routes').map(BusRoute.fromJson).toList(growable: false);
      return Success<List<BusRoute>>(routes);
    } on DioException catch (e) {
      return Failure<List<BusRoute>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<BusRoute>>(UnknownError());
    }
  }

  Future<Result<List<PlanResult>>> plan({
    required double destLat,
    required double destLng,
    double? originLat,
    double? originLng,
  }) async {
    try {
      final data = await _source.plan(
        destLat: destLat,
        destLng: destLng,
        originLat: originLat,
        originLng: originLng,
      );
      final routes = listAt(data, 'routes').map(PlanResult.fromJson).toList(growable: false);
      return Success<List<PlanResult>>(routes);
    } on DioException catch (e) {
      return Failure<List<PlanResult>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<PlanResult>>(UnknownError());
    }
  }
  Future<Result<RouteActivity>> getActivity(int id) async {
    try {
      final data = await _source.getActivity(id);
      return Success<RouteActivity>(RouteActivity.fromJson(data));
    } on DioException catch (e) {
      return Failure<RouteActivity>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<RouteActivity>(UnknownError());
    }
  }

  /// Returns `(onRoute: true)` when the backend rejects because user is on the route.
  Future<({bool onRoute, bool ok})> reportRouteUpdate(
    int routeId,
    String tipo, {
    double? lat,
    double? lng,
  }) async {
    try {
      final data = await _source.reportRouteUpdate(routeId, tipo, lat: lat, lng: lng);
      return (onRoute: false, ok: data['ok'] == true);
    } on DioException catch (e) {
      // Backend returns 400 with on_route:true when GPS is on the registered route.
      final body = e.response?.data;
      if (e.response?.statusCode == 400 &&
          body is Map &&
          body['on_route'] == true) {
        return (onRoute: true, ok: false);
      }
      return (onRoute: false, ok: false);
    } catch (_) {
      return (onRoute: false, ok: false);
    }
  }

  Future<void> updateDeviationReEntry(int routeId, double lat, double lng) async {
    try {
      await _source.updateDeviationReEntry(routeId, lat, lng);
    } catch (_) {
      // Best-effort — silent failure, the start point is already saved.
    }
  }
}

final routesRepositoryProvider = Provider<RoutesRepository>((ref) {
  return RoutesRepository(RoutesRemoteSource(ref.read(dioProvider)));
});
