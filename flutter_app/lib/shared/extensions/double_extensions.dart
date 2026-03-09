extension DoubleExtensions on double {
  String toDistanceString() {
    if (this < 1000) {
      return '${round()} m';
    }

    final km = this / 1000;
    return '${km.toStringAsFixed(1)} km';
  }
}
