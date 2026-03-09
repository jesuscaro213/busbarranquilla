class NominatimResult {
  final String displayName;
  final double lat;
  final double lng;

  const NominatimResult({
    required this.displayName,
    required this.lat,
    required this.lng,
  });

  factory NominatimResult.fromJson(Map<String, dynamic> json) {
    final lat = double.tryParse(json['lat']?.toString() ?? '') ?? 0;
    final lng = double.tryParse(json['lon']?.toString() ?? '') ?? 0;

    return NominatimResult(
      displayName: json['display_name']?.toString() ?? '',
      lat: lat,
      lng: lng,
    );
  }
}
