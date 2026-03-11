import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../domain/models/active_trip.dart';
import '../../domain/models/trip_end_result.dart';
import '../../domain/models/trip_history_item.dart';
import '../../error/app_error.dart';
import '../../error/result.dart';
import '../sources/trips_remote_source.dart';
import 'repository_helpers.dart';

class TripsRepository {
  final TripsRemoteSource _source;

  const TripsRepository(this._source);

  Future<Result<ActiveTrip>> start(Map<String, dynamic> body) async {
    try {
      final data = await _source.start(body);
      final trip = ActiveTrip.fromJson(mapAt(data, 'trip'));
      return Success<ActiveTrip>(trip);
    } on DioException catch (e) {
      return Failure<ActiveTrip>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<ActiveTrip>(UnknownError());
    }
  }

  Future<Result<int>> updateLocation(Map<String, dynamic> body) async {
    try {
      final data = await _source.updateLocation(body);
      return Success<int>(intAt(data, 'credits_pending'));
    } on DioException catch (e) {
      return Failure<int>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<int>(UnknownError());
    }
  }

  Future<Result<ActiveTrip?>> getCurrent() async {
    try {
      final data = await _source.getCurrent();
      final tripJson = data['trip'];
      if (tripJson == null) {
        return const Success<ActiveTrip?>(null);
      }

      final trip = ActiveTrip.fromJson(asMap(tripJson));
      return Success<ActiveTrip?>(trip);
    } on DioException catch (e) {
      return Failure<ActiveTrip?>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<ActiveTrip?>(UnknownError());
    }
  }

  Future<Result<List<ActiveTrip>>> getBuses() async {
    try {
      final data = await _source.getBuses();
      final buses = listAt(data, 'buses').map(ActiveTrip.fromJson).toList(growable: false);
      return Success<List<ActiveTrip>>(buses);
    } on DioException catch (e) {
      return Failure<List<ActiveTrip>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<ActiveTrip>>(UnknownError());
    }
  }

  Future<Result<TripEndResult>> end({Map<String, dynamic>? body}) async {
    try {
      final data = await _source.end(body: body);
      return Success<TripEndResult>(TripEndResult.fromJson(data));
    } on DioException catch (e) {
      return Failure<TripEndResult>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<TripEndResult>(UnknownError());
    }
  }
  Future<Result<List<TripHistoryItem>>> getHistory() async {
    try {
      final data = await _source.getHistory();
      final items = listAt(data, 'trips')
          .map(TripHistoryItem.fromJson)
          .toList(growable: false);
      return Success<List<TripHistoryItem>>(items);
    } on DioException catch (e) {
      return Failure<List<TripHistoryItem>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<TripHistoryItem>>(UnknownError());
    }
  }
}

final tripsRepositoryProvider = Provider<TripsRepository>((ref) {
  return TripsRepository(TripsRemoteSource(ref.read(dioProvider)));
});
