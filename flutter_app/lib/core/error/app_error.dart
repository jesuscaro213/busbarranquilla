import '../l10n/strings.dart';

sealed class AppError {
  final String message;

  const AppError(this.message);
}

final class NetworkError extends AppError {
  const NetworkError() : super(AppStrings.errorNetwork);
}

final class AuthError extends AppError {
  const AuthError(super.message);
}

final class ServerError extends AppError {
  final int statusCode;

  const ServerError(super.message, this.statusCode);
}

final class UnknownError extends AppError {
  const UnknownError() : super(AppStrings.errorUnknown);
}
