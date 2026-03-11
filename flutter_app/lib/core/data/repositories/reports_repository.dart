import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../domain/models/report.dart';
import '../../error/app_error.dart';
import '../../error/result.dart';
import '../sources/reports_remote_source.dart';
import 'repository_helpers.dart';

class ReportsRepository {
  final ReportsRemoteSource _source;

  const ReportsRepository(this._source);

  Future<Result<List<Report>>> getNearby({
    required double lat,
    required double lng,
    double radius = 1,
  }) async {
    try {
      final data = await _source.getNearby(lat: lat, lng: lng, radius: radius);
      final reports = listAt(data, 'reports').map(Report.fromJson).toList(growable: false);
      return Success<List<Report>>(reports);
    } on DioException catch (e) {
      return Failure<List<Report>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<Report>>(UnknownError());
    }
  }

  Future<Result<List<Report>>> getRouteReports(int routeId) async {
    try {
      final data = await _source.getRouteReports(routeId);
      final reports = listAt(data, 'reports').map(Report.fromJson).toList(growable: false);
      return Success<List<Report>>(reports);
    } on DioException catch (e) {
      return Failure<List<Report>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<Report>>(UnknownError());
    }
  }

  Future<Result<Report>> create(Map<String, dynamic> body) async {
    try {
      final data = await _source.create(body);
      final report = Report.fromJson(mapAt(data, 'report'));
      return Success<Report>(report);
    } on DioException catch (e) {
      return Failure<Report>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<Report>(UnknownError());
    }
  }

  Future<Result<void>> confirm(int reportId) async {
    try {
      await _source.confirm(reportId);
      return const Success<void>(null);
    } on DioException catch (e) {
      return Failure<void>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<void>(UnknownError());
    }
  }

  Future<Result<void>> resolve(int reportId) async {
    try {
      await _source.resolve(reportId);
      return const Success<void>(null);
    } on DioException catch (e) {
      return Failure<void>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<void>(UnknownError());
    }
  }

  Future<Result<String?>> getOccupancy(int routeId) async {
    try {
      final data = await _source.getOccupancy(routeId);
      final occupancyState = data['state'] as String?;
      return Success<String?>(occupancyState);
    } on DioException catch (e) {
      return Failure<String?>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<String?>(UnknownError());
    }
  }
}

final reportsRepositoryProvider = Provider<ReportsRepository>((ref) {
  return ReportsRepository(ReportsRemoteSource(ref.read(dioProvider)));
});
