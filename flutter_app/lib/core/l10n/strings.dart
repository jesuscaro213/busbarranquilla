abstract final class AppStrings {
  static const appName = 'MiBus';
  static const errorNetwork = 'Sin conexión. Verifica tu internet.';
  static const errorUnknown = 'Algo salió mal. Intenta de nuevo.';
  static const errorServer = 'Error del servidor. Intenta de nuevo.';

  static const loginTitle = 'Iniciar sesión';
  static const registerTitle = 'Crear cuenta';
  static const loginSubmit = 'Entrar';
  static const registerSubmit = 'Crear cuenta';
  static const emailLabel = 'Correo electrónico';
  static const passwordLabel = 'Contraseña';
  static const nameLabel = 'Nombre completo';
  static const phoneLabel = 'Teléfono (opcional)';
  static const noAccount = '¿No tienes cuenta?';
  static const goToRegister = 'Regístrate';
  static const haveAccount = '¿Ya tienes cuenta?';
  static const goToLogin = 'Inicia sesión';
  static const validationNameRequired = 'El nombre es obligatorio';
  static const validationEmailInvalid = 'Correo inválido';
  static const validationPasswordMin = 'La contraseña debe tener al menos 6 caracteres';
  static const confirmButton = 'Confirmar';
  static const routeInProgress = 'Ruta en curso';
  static const passengersLabel = 'pasajero(s)';
  static const nowAgo = 'Hace 0 min';
  static const osmTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  static const osmUserAgent = 'co.mibus.app';
  static const locationRequired = 'Activa tu ubicación para usar el mapa.';
  static const boardingTitle = 'Abordaje';
  static const stopSelectTitle = 'Seleccionar parada';
  static const tripReportsTitle = 'Reportes de la ruta';
  static const tripSummaryTitle = 'Resumen del viaje';
  static const tripEndButton = 'Me bajé';
  static const tripReportFab = 'Reportar';
  static const tripNoRoute = 'Sin ruta activa';
  static const tripStartError = 'No se pudo iniciar el viaje';
  static const tripSelectRoute = 'Selecciona una ruta';
  static const tripSearchRouteHint = 'Buscar ruta';
  static const tripSelectStopOptional = 'Selecciona una parada de destino (opcional)';
  static const tripStartButton = 'Iniciar viaje';
  static const tripNoStops = 'Esta ruta no tiene paradas registradas';
  static const tripDurationLabel = 'Duración';
  static const tripCreditsLabel = 'Créditos';
  static const tripClose = 'Cerrar';
  static const tripNoReports = 'No hay reportes activos';
  static const tripConfirm = 'Confirmar';
  static const tripStartFirst = 'Primero inicia un viaje';

  static const tabMap = 'Mapa';
  static const tabRoutes = 'Mis Rutas';
  static const tabTrip = 'Viaje';
  static const tabProfile = 'Perfil';

  static const boardedButton = 'Me subí';
  static const alightedButton = 'Me bajé';
  static const planButton = 'Buscar rutas';
  static const originLabel = 'Origen';
  static const destLabel = 'Destino';
  static const currentLocationLabel = 'Mi ubicación';
  static const plannerPickPointsError = 'Selecciona origen y destino para continuar.';
  static const favoritesTitle = 'Favoritos';
  static const noFavorites = 'Aún no tienes rutas favoritas';
  static const distanceOriginLabel = 'origen';
  static const distanceDestLabel = 'destino';
  static const frequencyLabel = 'Frecuencia';

  static const reportTypes = {
    'trancon': '🚗 Trancón',
    'lleno': '🔴 Bus lleno',
    'bus_disponible': '🟢 Hay sillas',
    'sin_parar': '⚠️ Sin parar en parada',
    'desvio': '🔀 Desvío',
  };

  static const prepareToAlight = 'Prepárate para bajar';
  static const alightNow = '¡Bájate ya!';
  static const missedStop = 'Pasaste tu parada';
  static const stillOnBus = '¿Sigues en el bus?';

  static const premiumTitle = 'MiBus Premium';
  static const premiumAlready = '✓ Ya eres Premium';
  static const premiumExpiresLabel = 'Vence';
  static const premiumViewBenefits = 'Ver beneficios';
  static const premiumSubscribe = 'Suscribirse \$4.900 COP';
  static const premiumMonthlyPlanId = 'monthly';
  static const premiumFeatures = <String>[
    'Alertas de bajada automáticas (sin costo)',
    'Ver ocupación del bus gratis',
    'Todas las funciones sin gastar créditos',
    '+50 créditos de bono al activar',
  ];
  static const trialUntilLabel = 'Trial hasta';
  static const creditsLabel = 'créditos';
  static const viewHistory = 'Ver historial';
  static const loadMore = 'Cargar más';
  static const logoutLabel = 'Cerrar sesión';
  static const premiumChipActive = '✓ Premium';
  static const distanceUnitMeters = 'm';
  static const timeUnitMinutes = 'min';
  static const distanceFar = '(lejos)';
  static const retry = 'Reintentar';
  static const emptyState = 'Sin resultados';
  static const notAvailable = '-';

  static String agoMinutes(int minutes) => 'Hace $minutes min';
}
