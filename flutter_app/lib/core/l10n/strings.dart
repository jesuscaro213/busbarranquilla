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
  static const osmTileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
  // Voyager: colorful, shows street names, POIs, parks, buildings — for trip navigation
  static const tripTileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
  static const osmTileSubdomains = <String>['a', 'b', 'c', 'd'];
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
  static const nearbyTitle = 'Cerca de ti';
  static const tripSelectStopOptional = 'Selecciona una parada de destino (opcional)';
  static const tripStartButton = 'Iniciar viaje';
  static const tripNoStops = 'Esta ruta no tiene paradas registradas';
  static const tripDurationLabel = 'Duración';
  static const tripCreditsLabel = 'Créditos';
  static const tripClose = 'Cerrar';
  static const tripNoReports = 'No hay reportes activos';
  static const tripDropoffStop = 'Parada de bajada';
  static const tripChangeStop = 'Cambiar';
  static const tripNoDropoff = 'Sin parada de destino';
  static const tripConfirm = 'Confirmar';
  static const tripStartFirst = 'Primero inicia un viaje';

  static const tabMap = 'Mapa';
  static const tabRoutes = 'Mis Rutas';
  static const tabTrip = 'Viaje';
  static const tabProfile = 'Perfil';

  static const boardedButton = 'Me subí';
  static const boardedWaitingButton = '¡Ya me subí!';
  static const alightedButton = 'Me bajé';
  static const planButton = 'Buscar rutas';
  static const originLabel = 'Origen';
  static const destLabel = 'Destino';
  static const currentLocationLabel = 'Mi ubicación';
  static const plannerPickPointsError = 'Selecciona origen y destino para continuar.';
  static const plannerDestRequired = 'Escribe un destino para buscar rutas.';
  static const favoritesTitle = 'Favoritos';
  static const noFavorites = 'Aún no tienes rutas favoritas';
  static const nearbyRoutesTitle = 'Buses en tu zona';
  static const nearbyRoutesHint = '¿Va a tu destino? Escríbelo arriba ↑';
  static const distanceOriginLabel = 'origen';
  static const distanceDestLabel = 'destino';
  static const frequencyLabel = 'Frecuencia';

  static const reportTypes = {
    'trancon': '🚗 Trancón',
    'lleno': '🔴 Bus lleno',
    'bus_disponible': '🟢 Hay sillas',
    'sin_parar': '⚠️ Sin parar en parada',
    'desvio': '🔀 Desvío',
    'ruta_real': '🗺️ Ruta diferente al mapa',
  };

  static const prepareToAlight = 'Prepárate para bajar';
  static const prepareToAlightBody = 'Tu parada está a unos 700 m. Ve acercándote a la puerta.';
  static const alightNow = '¡Bájate ya!';
  static const alightNowBody = 'Tu parada está a menos de 200 m. ¡Es hora de bajar!';
  static const missedStop = 'Pasaste tu parada';
  static const stillOnBus = '¿Sigues en el bus?';
  static const stillOnBusBody = 'Detectamos que llevas mucho tiempo sin moverte. ¿Todavía estás en el bus?';
  static const stillOnBusYes = 'Sí, sigo aquí';
  static const desvioTitle = 'El bus se alejó de la ruta';
  static const desvioBody = '¿Qué está pasando?';
  static const desvioRepeatTitle = 'Sigues fuera de la ruta';
  static const desvioRepeatBody = '¿Ya resolviste el desvío o te bajaste?';
  static const desvioTemporal = 'Desvío temporal (trancón)';
  static const desvioTemporalDesc = 'El bus tomó un atajo por tráfico. Es temporal.';
  static const desvioRutaDiferente = 'La ruta del bus es diferente al mapa';
  static const desvioRutaDiferenteDesc = 'El bus siempre va por aquí — el mapa está desactualizado.';
  static const desvioGetOff = 'Me bajé';
  static const desvioIgnore = 'Ignorar 5 min';
  static const desvioRutaRealSent = 'Reporte enviado. Monitoreando re-ingreso a la ruta...';
  static const desvioRutaRealOnRoute = 'Estás sobre la ruta registrada, el reporte no aplica';
  static const desvioRutaRealReEntry = '✓ Segmento desactualizado registrado. ¡Gracias!';
  static const desvioEscalateTitle = 'Llevas 30 min fuera de la ruta';
  static const desvioEscalateBody = '¿Sigues en el bus?';
  static const desvioEscalateTransconTitle = '¿El trancón continúa?';
  static const desvioEscalateTransconBody = 'Llevas 30 min en el desvío. ¿Sigues a bordo del bus?';
  static const desvioAutoEndTitle = 'Viaje cerrado — sin respuesta';
  static const desvioAutoEndBody = 'No respondiste al alerta de desvío. Tu viaje fue cerrado automáticamente.';
  static const desvioReturnedTitle = '¡El bus retomó la ruta!';
  static const desvioReturnedBody = 'El desvío ha sido cerrado automáticamente.';

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

  // Trip summary — distance + bonus
  static const tripDistanceLabel = 'Distancia';
  static const tripCompletionBonus = '+5 créditos por completar el viaje';
  static const tripShortDistance = 'Recorriste menos de 2 km — no se otorgó el bonus de completación';
  static const tripKmSuffix = 'km';
  static const tripMetersSuffix = 'm';
  static const tripSummaryCompleted = '¡Viaje completado!';
  static const tripSummaryReports = 'Reportes en el viaje';
  static const tripSummaryNoReports = 'Sin reportes';
  static const tripSummaryStreakLabel = 'Racha de reportes';
  static const tripSummaryStreakDays = 'días seguidos 🔥';
  static const tripSummaryStreakNone = 'Reporta hoy para empezar tu racha';
  static const tripEndConfirmTitle = '¿Ya te bajaste?';
  static const tripEndConfirmBody = 'Confirma que bajaste del bus para guardar tu viaje y créditos.';
  static const tripEndConfirmYes = 'Sí, me bajé';
  static const tripEndConfirmNo = 'Seguir en el bus';

  // Trancón resolved notifications
  static const tranconResolvedWithDuration = 'Trancón resuelto — duró ~';
  static const tranconResolvedMinutes = ' min';
  static const tranconResolved = 'El trancón en esta ruta fue resuelto';
  static const tranconResolvedWaiting = '✅ El trancón en esta ruta se resolvió';

  // Trip history
  static const tripHistoryTitle = 'Tus últimos viajes';
  static const tripHistoryEmpty = 'Aún no has hecho ningún viaje.';
  static const tripHistoryEmptySub = '¡Sube a un bus y empieza!';
  static const tripHistoryLink = 'Ver mis viajes';
  static const tripDurationMinutes = 'min';

  // Route activity
  static const activityUsersActive = 'usuarios activos ahora';
  static const activityOneUserActive = 'usuario activo ahora';
  static const activityLastSeen = 'Última actividad hace';
  static const activityLastSeenMin = 'min';
  static const activityNone = 'Sin actividad reciente';
  static const activityLoading = 'Verificando actividad...';
  static const String activityShowTimeline = 'Ver actividad reciente';
  static const String activityHideTimeline = 'Ocultar actividad';
  static const String activityEventBoarding = 'Subió';
  static const String activityEventAlighting = 'Bajó';
  static const String activityEventReport = 'Reporte';
  static const String activityEventJustNow = 'ahora mismo';

  // Nearby routes
  static const String nearbyRefreshTooltip = 'Actualizar rutas cercanas';
  static const String nearbyBoardButton = 'Subir a este bus';

  // Referral code
  static const referralCodeLabel = 'Código de referido (opcional)';
  static const referralCodeHint = 'Ej: ABC123';
  static const referralCodeSection = 'Tu código de referido';
  static const referralCodeCopied = 'Código copiado al portapapeles';
  static const referralCodeShare = 'Comparte tu código y gana +25 créditos por cada amigo';
  static const referralCodeNone = 'Tu código se genera al registrarte';
  static const referralShareText = '¡Únete a MiBus! Usa mi código y gana 25 créditos:';

  // Route update voting
  static const reportRouteTitle = 'Reportar problema de ruta';
  static const reportTrancon = 'Hay trancón';
  static const reportRutaReal = 'Ruta difiere del mapa';
  static const reportRouteSent = 'Reporte enviado. ¡Gracias!';
  static const reportRouteError = 'No se pudo enviar el reporte';
  static const reportTranconDesc = 'El bus está atascado en tráfico';
  static const reportRutaRealDesc = 'El bus tomó una ruta diferente a la del mapa';

  // Premium benefits
  static const premiumBenefitsTitle = 'Beneficios Premium';
  static const premiumActiveUntil = 'Activo hasta';

  // Map trip visuals
  static const youAreOnBus = '🚌 Estás en el bus';
  static const activeBusOnRoute = '🚌 Bus activo en ruta';

  // Boarding reports
  static const boardingReportsTitle = 'Reportes de la ruta';
  static const boardingReportsEmpty = 'Sin reportes activos';

  // Map pick mode
  static const mapPickTitle = 'Seleccionar en mapa';
  static const mapPickInstruction = 'Mueve el mapa hasta el punto deseado';
  static const mapPickConfirm = 'Confirmar punto';
  static const mapPickGeocoding = 'Identificando dirección...';
  static const mapPickError = 'No se pudo identificar el punto. Intenta de nuevo.';

  // Boarding map preview
  static const boardingPickOnMap = 'Seleccionar en mapa';
  static const boardingOriginLabel = 'Tu posición';
  static const boardingDestLabel = 'Bajada';
  static const boardingPreviewTitle = 'Recorrido de la ruta';
  static const boardingPreviewConfirm = 'Me monté en este bus';
  static const boardingPreviewLoading = 'Cargando recorrido...';
  static const boardingPreviewNoGeometry = 'Sin recorrido disponible';

  // Splash screen
  static const splashTagline = 'Barranquilla en tiempo real';
  static const splashLoading = 'Cargando...';

  // Google sign-in
  static const loginWithGoogle = 'Continuar con Google';
  static const googleSignInError = 'No se pudo iniciar sesión con Google';
  static const googleSignInCancelled = 'Inicio de sesión cancelado';

  static const String ok = 'OK';
  static const String gpsLostBanner = 'GPS perdido — verifica tu señal';
  // GPS required dialog
  static const String gpsRequiredTitle = 'GPS desactivado';
  static const String gpsRequiredBody =
      'Necesitas tener el GPS activo para iniciar un viaje. '
      'Sin él no podemos transmitir tu ubicación.';
  static const String gpsRequiredOpenSettings = 'Activar GPS';

  static const String boardingDistanceTitle = 'Estás lejos de esta ruta';
  static const String boardingDistanceBody =
      'Pareces estar a más de 800 m de la ruta. ¿Seguro que quieres subir?';
  static const String boardingDistanceConfirm = 'Sí, subir igual';
  static const String cancel = 'Cancelar';
  static const String occupancyLleno = '🔴 Bus lleno';
  static const String occupancyDisponible = '🟢 Hay sillas';

  // Suspicious inactivity
  static const String suspiciousTitle = 'Viaje cerrado por inactividad';
  static const String suspiciousBody =
      'No detectamos movimiento por mucho tiempo. El viaje fue cerrado automáticamente.';

  // Dropoff prompt
  static const String dropoffPromptTitle = 'Activar alertas de bajada';
  static const String dropoffPromptBody =
      'Te avisaremos cuando estés cerca de tu parada. Cuesta 5 créditos por viaje.';
  static const String dropoffPromptDecline = 'No, gracias';
  static const String dropoffPromptAccept = 'Activar (5 créditos)';
  static const String dropoffDestinationSet = '¡Listo! Te avisaremos al acercarte a ese punto.';
  static const String tripChangeDestination = 'Cambiar destino';
  static const String dropoffConfirmButton = 'Confirmar parada';
  static const String dropoffCancelButton = 'Elegir otro punto';

  // Active trip bottom bar
  static const tripActiveBar = 'Viaje activo';

  // Onboarding
  static const onboardingSkip = 'Omitir';
  static const onboardingNext = 'Siguiente';
  static const onboardingStart = 'Empezar';

  static const onboarding1Title = '¿Dónde está el bus?';
  static const onboarding1Body =
      'MiBus te muestra en tiempo real dónde están los buses de Barranquilla, '
      'reportados por los mismos pasajeros.';

  static const onboarding2Title = 'Tú eres el GPS';
  static const onboarding2Body =
      'Cuando te subes al bus, transmites tu ubicación en vivo. '
      'Otros pasajeros te ven moverse en el mapa y saben que el bus viene.';

  static const onboarding3Title = 'Gana créditos';
  static const onboarding3Body =
      'Reportar trancones, confirmar reportes y completar viajes te da créditos. '
      'Úsalos para activar alertas de bajada y más.';

  // Waiting mode
  static const waitingTitle = 'Esperando tu bus';
  static const waitButton = 'Esperar este bus';
  static const waitingCancel = 'Dejar de esperar';
  static const waitingEtaSearching = 'Buscando buses...';
  static const waitingEtaNoData = 'Sin buses activos';
  static const waitingEtaArriving = 'Bus llegando ahora 🎉';
  static const waitingEtaMinutes = 'min';
  static const waitingActiveBar = '🔔 Esperando bus';
  static const waitingBusNearTitle = 'Tu bus está cerca';
  static const autoboardDetected = 'Subiste al bus automáticamente';
  static const autoboardUndo = 'Deshacer';
  static const autoboardCancelled = 'Auto-boarding cancelado';
  static const waitingAutoCancelled = 'Modo espera cancelado — parece que tomaste otro bus';
  static const waitingSlowOnRouteTitle = '¿Ya te subiste al bus?';
  static const waitingSlowOnRouteBody =
      'Llevas varios minutos moviéndote sobre esta ruta a velocidad baja.';
  static const waitingSlowOnRouteYes = 'Sí, estoy en el ';
  static const waitingSlowOnRouteOther = 'Cogí otro bus';
  static const waitingSlowOnRouteNo = 'No, sigo esperando';

  static const waitingFarOffRouteTitle = '¿Sigues esperando el bus?';
  static const waitingFarOffRouteBody =
      'Te has alejado más de 1 km de la ruta. ¿Todavía quieres tomar este bus?';
  static const waitingFarOffRouteContinue = 'Sigo esperando';
  static const waitingFarOffRouteCancel = 'Ya no voy a tomarlo';

  static const quickBoardTitle = 'Selecciona tu bus';
  static const quickBoardSearchHint = 'Buscar ruta...';

  // ── Notification opt-in dialog ──────────────────────────────────────────
  static const notifOptInDecline = 'No por ahora';

  static const notifBusNearbyTitle = 'Avisar cuando el bus llega';
  static const notifBusNearbyBody =
      'Te notificamos cuando el bus que esperas está a ~2 minutos.\n\n'
      'Cuesta 3 créditos por alerta. Los usuarios Premium no pagan.';
  static const notifBusNearbyAccept = 'Activar (3 créditos)';

  static const notifBoardingTitle = 'Alertas de bajada';
  static const notifBoardingBody =
      'Te avisamos a 400 m y a 200 m de tu parada de destino.\n\n'
      'Cuesta 5 créditos por viaje. Los usuarios Premium no pagan.';
  static const notifBoardingAccept = 'Activar (5 créditos)';

  static const notifRouteReportsTitle = 'Reportes en tu ruta';
  static const notifRouteReportsBody =
      'Recibes una notificación cuando alguien reporta un trancón '
      'o desvío en la ruta que estás usando.\n\nGratis para todos.';
  static const notifRouteReportsAccept = 'Activar';

  // ── Notification preferences section ────────────────────────────────────
  static const notifSectionTitle = 'Notificaciones';
  static const notifBusNearbyLabel = 'Avisar cuando el bus se acerca';
  static const notifBusNearbySub = 'Mientras esperas · 3 créditos por alerta';
  static const notifBoardingLabel = 'Alertas de bajada';
  static const notifBoardingSub = 'Durante el viaje · 5 créditos por viaje';
  static const notifRouteReportsLabel = 'Reportes en tu ruta';
  static const notifRouteReportsSub = 'Trancones y desvíos · Gratis';
  static const notifPremiumFree = 'Premium: gratis';
  static const notifSavedSnackbar = 'Preferencia guardada';
  static const notifBusNearbyNoCredits = 'Sin créditos para alertas de bus';
  static const notifBusNearbyChargeDescription = 'Alerta bus cercano';
  static const dropoffNoCredits = 'Sin créditos suficientes para activar las alertas de bajada (necesitas 5)';
  static const dropoffAutoActivated = 'Alertas de bajada activadas · -5 créditos';

  // Help / Guide
  static const helpTitle = 'Cómo usar MiBus';
  static const helpSubtitle = 'Aprende a sacarle el máximo provecho a la app';
  static const helpMenuLabel = 'Ayuda y guía';
  static const helpMapTitle = 'La pestaña Mapa';
  static const helpPlannerTitle = 'La pestaña Mis Rutas';
  static const helpTripTitle = 'Cómo funciona "Me subí"';
  static const helpCreditsTitle = 'Sistema de créditos';
  static const helpPremiumTitle = 'MiBus Premium';
}
