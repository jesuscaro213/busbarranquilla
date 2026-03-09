extension DateTimeExtensions on DateTime {
  String timeAgo() {
    final diff = DateTime.now().difference(this);

    if (diff.inMinutes < 1) {
      return 'Hace 0 min';
    }

    if (diff.inMinutes < 60) {
      return 'Hace ${diff.inMinutes} min';
    }

    if (diff.inHours < 24) {
      return 'Hace ${diff.inHours} h';
    }

    final days = diff.inDays;
    return 'Hace ${days * 24} h';
  }

  String formatDate() {
    final day = this.day.toString().padLeft(2, '0');
    final month = this.month.toString().padLeft(2, '0');
    final year = this.year.toString();
    return '$day/$month/$year';
  }
}
