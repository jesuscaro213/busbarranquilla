import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../domain/models/stop.dart';
import '../../error/app_error.dart';
import '../../error/result.dart';
import '../sources/stops_remote_source.dart';
import 'repository_helpers.dart';

class StopsRepository {
  final StopsRemoteSource _source;

  const StopsRepository(this._source);

  Future<Result<List<Stop>>> listByRoute(int routeId) async {
    try {
      final data = await _source.listByRoute(routeId);
      final stops = listAt(data, 'stops').map(Stop.fromJson).toList(growable: false);
      return Success<List<Stop>>(stops);
    } on DioException catch (e) {
      return Failure<List<Stop>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<Stop>>(UnknownError());
    }
  }
}

final stopsRepositoryProvider = Provider<StopsRepository>((ref) {
  return StopsRepository(StopsRemoteSource(ref.read(dioProvider)));
});
