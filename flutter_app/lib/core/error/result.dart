import 'app_error.dart';

sealed class Result<T> {
  const Result();
}

final class Success<T> extends Result<T> {
  final T data;

  const Success(this.data);
}

final class Failure<T> extends Result<T> {
  final AppError error;

  const Failure(this.error);
}

extension ResultExtension<T> on Result<T> {
  bool get isSuccess => this is Success<T>;

  T get data => (this as Success<T>).data;

  AppError get error => (this as Failure<T>).error;

  R fold<R>({
    required R Function(T) onSuccess,
    required R Function(AppError) onFailure,
  }) => switch (this) {
    Success<T> s => onSuccess(s.data),
    Failure<T> f => onFailure(f.error),
  };
}
