abstract final class ApiPaths {
  static const baseUrl = 'https://api.mibus.co';

  static const login = '/api/auth/login';
  static const register = '/api/auth/register';
  static const profile = '/api/auth/profile';
  static const authGoogle = '/api/auth/google';
  static const authFcmToken = '/api/auth/fcm-token';

  static const routes = '/api/routes';
  static const routesNearby = '/api/routes/nearby';
  static const routesActiveFeed = '/api/routes/active-feed';
  static const routesPlan = '/api/routes/plan';
  static String routeById(int id) => '/api/routes/$id';
  static String routeUpdateReport(int id) => '/api/routes/$id/update-report';
  static String routeUpdateReEntry(int id) => '/api/routes/$id/update-report/reentry';
  static String routeStops(int id) => '/api/stops/route/$id';

  static const reportsNearby = '/api/reports/nearby';
  static const reports = '/api/reports';
  static String reportConfirm(int id) => '/api/reports/$id/confirm';
  static String reportResolve(int id) => '/api/reports/$id/resolve';
  static String routeReports(int routeId) => '/api/reports/route/$routeId';

  static const tripStart = '/api/trips/start';
  static const tripLocation = '/api/trips/location';
  static const tripEnd = '/api/trips/end';
  static const tripCurrent = '/api/trips/current';
  static const tripDestination = '/api/trips/destination';
  static const tripBuses = '/api/trips/buses';
  static const tripHistory = '/api/trips/history';

  static String routeActivity(int id) => '/api/routes/$id/activity';
  static String reportsOccupancy(int routeId) => '/api/reports/occupancy/$routeId';

  static const creditsBalance = '/api/credits/balance';
  static const creditsHistory = '/api/credits/history';
  static const creditsSpend = '/api/credits/spend';
  static const creditsStats = '/api/credits/stats';

  static const paymentPlans = '/api/payments/plans';
  static const paymentCheckout = '/api/payments/checkout';

  static const favorites = '/api/users/favorites';
  static String favoriteById(int routeId) => '/api/users/favorites/$routeId';
}
