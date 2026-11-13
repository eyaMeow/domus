import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/material.dart' as material;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:mime/mime.dart';
import 'package:url_launcher/url_launcher.dart';

import 'localization.dart';

const ink = Color(0xFF17243D);
const teal = Color(0xFF128078);
const tealDark = Color(0xFF0A6863);
const mint = Color(0xFFE8F2F0);
const background = Color(0xFFF6F8F9);
const muted = Color(0xFF7D8795);
const border = Color(0xFFE6EAED);
const danger = Color(0xFFB54F48);
const openFreeMapStyle = 'https://tiles.openfreemap.org/styles/liberty';
final _activeLanguage = ValueNotifier<String>('fr');
final _localNotifications = FlutterLocalNotificationsPlugin();

class _LocalizedText extends StatelessWidget {
  const _LocalizedText(
    this.data, {
    this.style,
    this.textAlign,
    this.overflow,
    this.maxLines,
  });

  final String data;
  final TextStyle? style;
  final TextAlign? textAlign;
  final TextOverflow? overflow;
  final int? maxLines;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<String>(
    valueListenable: _activeLanguage,
    builder: (context, language, _) => material.Text(
      translate(language, data),
      style: style,
      textAlign: textAlign,
      overflow: overflow,
      maxLines: maxLines,
    ),
  );
}

String get apiBaseUrl {
  const configured = String.fromEnvironment('DOMUS_API_URL');
  if (configured.isNotEmpty) return configured.replaceFirst(RegExp(r'/$'), '');
  if (kIsWeb) return 'http://localhost:4000';
  if (defaultTargetPlatform == TargetPlatform.android) {
    return 'http://10.0.2.2:4000';
  }
  return 'http://localhost:4000';
}

String resolvePhotoUrl(String value) {
  var url = value.trim();
  if (url.isEmpty) return '';

  final apiOrigin = Uri.parse(apiBaseUrl).origin;
  if (url.startsWith(apiOrigin)) {
    final remainder = url.substring(apiOrigin.length);
    if (remainder.startsWith('http://') || remainder.startsWith('https://')) {
      url = remainder;
    }
  }

  final uri = Uri.parse(url);
  return uri.hasScheme
      ? uri.toString()
      : Uri.parse(apiBaseUrl).resolveUri(uri).toString();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (kIsWeb) {
    MapLibreMap.webLibrarySource = const MapLibreJsSource.urls(
      scriptUrl: 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.mjs',
      styleUrl: 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.css',
      timeout: Duration(seconds: 45),
    );
  }
  if (!kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS)) {
    await _localNotifications.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
    );
  }
  runApp(const DomusApp());
}

class DomusApp extends StatelessWidget {
  const DomusApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Domus',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        fontFamily: 'Nunito',
        scaffoldBackgroundColor: background,
        colorScheme: ColorScheme.fromSeed(seedColor: teal, primary: teal),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: ink,
          elevation: 0,
          centerTitle: false,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 14,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: teal, width: 1.4),
          ),
        ),
      ),
      home: const DomusHome(),
    );
  }
}

class DomusHome extends StatefulWidget {
  const DomusHome({super.key});

  @override
  State<DomusHome> createState() => _DomusHomeState();
}

class _DomusHomeState extends State<DomusHome> with WidgetsBindingObserver {
  static const _storage = FlutterSecureStorage();
  int _tab = 0;
  String _section = 'main';
  String _query = '';
  String _city = '';
  String _transaction = 'Tous';
  String _type = 'Tous';
  String _postTransaction = 'Vente';
  String _postType = 'Appartement';
  String _minPrice = '';
  String _maxPrice = '';
  String? _token;
  Map<String, dynamic>? _user;
  Map<String, dynamic>? _selectedConversation;
  List<Map<String, dynamic>> _properties = [];
  List<Map<String, dynamic>> _favorites = [];
  List<Map<String, dynamic>> _myProperties = [];
  List<Map<String, dynamic>> _conversations = [];
  List<Map<String, dynamic>> _notifications = [];
  List<Map<String, dynamic>> _adminUsers = [];
  List<Map<String, dynamic>> _adminProperties = [];
  List<Map<String, dynamic>> _adminReports = [];
  List<Map<String, dynamic>> _messages = [];
  final Set<Object?> _knownNotificationIds = {};
  bool _hasLoadedNotifications = false;
  bool _busy = false;
  bool _isInitializing = true;
  bool _isSyncing = false;
  bool _isAppActive = true;
  bool _registerMode = false;
  String _language = 'fr';
  String _authFlow = 'login';
  bool _acceptedTerms = false;
  bool _notificationsEnabled = true;
  bool _localNotificationsEnabled = false;
  bool _localNotificationsBusy = false;
  bool _locating = false;
  LatLng? _currentLocation;
  double? _currentLocationAccuracy;
  LatLng? _listingLocation;
  MapLibreMapController? _propertyMapController;
  MapLibreMapController? _listingMapController;
  bool _propertyMapStyleLoaded = false;
  bool _listingMapStyleLoaded = false;
  final Map<String, Map<String, dynamic>> _propertyCircleListings = {};
  int? _editingPropertyId;
  int _galleryIndex = 0;
  List<String> _listingPhotos = [];
  final _imagePicker = ImagePicker();
  Timer? _searchDebounce;
  Timer? _messagePoll;
  Timer? _syncPoll;

  final _authName = TextEditingController();
  final _authEmail = TextEditingController();
  final _authPassword = TextEditingController();
  final _authToken = TextEditingController();
  final _listingTitle = TextEditingController();
  final _listingDescription = TextEditingController();
  final _listingPrice = TextEditingController();
  final _listingCity = TextEditingController();
  final _listingSurface = TextEditingController();
  final _listingBedrooms = TextEditingController(text: '2');
  final _listingImage = TextEditingController();
  final _messageDraft = TextEditingController();
  final _profileName = TextEditingController();
  final _profilePhone = TextEditingController();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _activeLanguage.value = _language;
    _initializeApp();
    _restoreLocalNotifications();
    _loadProperties();
    _syncPoll = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!_isInitializing && _isAppActive && mounted) {
        unawaited(
          _syncFromServer().catchError((Object error) {
            if (mounted) {
              _showNotice(error.toString().replaceFirst('Exception: ', ''));
            }
          }),
        );
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _isAppActive = state == AppLifecycleState.resumed;
    if (_isAppActive && !_isInitializing) {
      unawaited(_syncFromServer());
    }
  }

  Future<void> _initializeApp() async {
    await Future.wait([
      _restoreLanguage(),
      _restoreSession(),
      Future<void>.delayed(const Duration(milliseconds: 700)),
    ]);
    if (mounted) setState(() => _isInitializing = false);
  }

  Future<void> _restoreLocalNotifications() async {
    final enabled = await _storage.read(
      key: 'domus.localNotifications.enabled',
    );
    if (!mounted) return;
    setState(() => _localNotificationsEnabled = enabled == 'true');
  }

  Future<void> _syncFromServer() async {
    if (_isSyncing) return;
    _isSyncing = true;
    try {
      await _loadProperties();
      final session = _token;
      if (session == null) return;
      if (_user?['role'] == 'admin') {
        await _loadAdminData(session);
      } else {
        await _loadUserData(session);
      }
    } finally {
      _isSyncing = false;
    }
  }

  String _t(String value) => translate(_language, value);

  List<Map<String, dynamic>> get _nearbyProperties {
    final location = _currentLocation;
    if (location == null) return _properties;
    final sorted = [..._properties];
    sorted.sort(
      (a, b) => _distanceTo(a, location).compareTo(_distanceTo(b, location)),
    );
    return sorted;
  }

  double _distanceTo(Map<String, dynamic> property, LatLng location) {
    final latitude = (property['latitude'] as num?)?.toDouble();
    final longitude = (property['longitude'] as num?)?.toDouble();
    if (latitude == null || longitude == null) return double.infinity;
    return Geolocator.distanceBetween(
      location.latitude,
      location.longitude,
      latitude,
      longitude,
    );
  }

  Future<void> _locateMe() async {
    setState(() => _locating = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        _showNotice(
          'Activez la localisation de votre appareil puis réessayez.',
        );
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied) {
        _showNotice(
          'Autorisez l’accès à votre position pour voir les annonces proches.',
        );
        return;
      }
      if (permission == LocationPermission.deniedForever) {
        _showNotice(
          'Autorisez la localisation de Domus dans les réglages de votre appareil.',
        );
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 30),
        ),
      );
      if (!mounted) return;
      setState(() {
        _currentLocation = LatLng(position.latitude, position.longitude);
        _currentLocationAccuracy = position.accuracy;
      });
      await _propertyMapController?.animateCamera(
        CameraUpdate.newLatLngZoom(_currentLocation!, 11),
      );
      await _syncPropertyMapMarkers();
      _showNotice(
        'Votre position est affichée. Les distances utilisent les emplacements exacts des annonces.',
      );
    } catch (error) {
      if (mounted) {
        _showNotice('${_t('Impossible d’obtenir votre position :')} $error');
      }
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _restoreLanguage() async {
    try {
      final saved = await _storage.read(key: 'domus.language');
      if (!mounted || saved == null || !['fr', 'en', 'ar'].contains(saved)) {
        return;
      }
      _activeLanguage.value = saved;
      setState(() => _language = saved);
    } catch (error) {
      if (mounted) {
        _showNotice('${_t('Impossible de restaurer la langue :')} $error');
      }
    }
  }

  Future<void> _setLanguage(String language) async {
    if (!['fr', 'en', 'ar'].contains(language)) return;
    _activeLanguage.value = language;
    setState(() => _language = language);
    try {
      await _storage.write(key: 'domus.language', value: language);
    } catch (error) {
      if (mounted) {
        _showNotice('${_t('Impossible d’enregistrer la langue :')} $error');
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _searchDebounce?.cancel();
    _messagePoll?.cancel();
    _syncPoll?.cancel();
    for (final controller in [
      _authName,
      _authEmail,
      _authPassword,
      _authToken,
      _listingTitle,
      _listingDescription,
      _listingPrice,
      _listingCity,
      _listingSurface,
      _listingBedrooms,
      _listingImage,
      _messageDraft,
      _profileName,
      _profilePhone,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<Map<String, dynamic>> _request(
    String path, {
    String method = 'GET',
    Object? body,
    String? session,
  }) async {
    if (!kDebugMode && !apiBaseUrl.startsWith('https://')) {
      throw StateError(
        'Une adresse API HTTPS est obligatoire pour la version publiée.',
      );
    }
    final uri = Uri.parse('$apiBaseUrl$path');
    final headers = <String, String>{'content-type': 'application/json'};
    if (session != null) headers['authorization'] = 'Bearer $session';
    final encoded = body == null ? null : jsonEncode(body);
    final response = switch (method) {
      'POST' => await http.post(uri, headers: headers, body: encoded),
      'PUT' => await http.put(uri, headers: headers, body: encoded),
      'PATCH' => await http.patch(uri, headers: headers, body: encoded),
      'DELETE' => await http.delete(uri, headers: headers, body: encoded),
      _ => await http.get(uri, headers: headers),
    };
    final data = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw DomusApiException(
        response.statusCode,
        data['error']?.toString() ?? 'Erreur API (${response.statusCode}).',
        data['code']?.toString(),
      );
    }
    return data;
  }

  Future<void> _restoreSession() async {
    try {
      final saved = await _storage.read(key: 'domus.token');
      if (saved == null) return;
      final account = await _request('/auth/me', session: saved);
      if (!mounted) return;
      setState(() {
        _token = saved;
        _user = account;
        _profileName.text = account['name'] as String? ?? '';
        _profilePhone.text = account['phone'] as String? ?? '';
      });
      if (account['role'] == 'admin') {
        await _loadAdminData();
      } else {
        await _loadUserData(saved);
      }
      await _loadProperties();
    } catch (error) {
      if (error is DomusApiException &&
          (error.statusCode == 401 || error.statusCode == 403)) {
        await _storage.delete(key: 'domus.token');
      } else if (mounted) {
        _showNotice(
          'Impossible de restaurer la session : ${error.toString().replaceFirst('Exception: ', '')}',
        );
      }
    }
  }

  Future<void> _loadProperties() async {
    final query = <String, String>{};
    if (_query.trim().isNotEmpty) query['q'] = _query.trim();
    if (_city.trim().isNotEmpty) query['city'] = _city.trim();
    if (_transaction != 'Tous') query['transaction'] = _transaction;
    if (_type != 'Tous') query['type'] = _type;
    if (_minPrice.isNotEmpty) query['minPrice'] = _minPrice;
    if (_maxPrice.isNotEmpty) query['maxPrice'] = _maxPrice;
    try {
      final path = Uri(path: '/properties', queryParameters: query).toString();
      final result = await _request(path, session: _token);
      if (mounted) {
        setState(() => _properties = _mapList(result['items']));
        if (_propertyMapStyleLoaded) {
          unawaited(_syncPropertyMapMarkers());
        }
      }
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  Future<void> _syncPropertyMapMarkers() async {
    final controller = _propertyMapController;
    if (!mounted || !_propertyMapStyleLoaded || controller == null) return;
    try {
      await controller.clearCircles();
      _propertyCircleListings.clear();
      for (final property in _properties) {
        final latitude = (property['latitude'] as num?)?.toDouble();
        final longitude = (property['longitude'] as num?)?.toDouble();
        if (latitude == null || longitude == null) continue;
        final circle = await controller.addCircle(
          CircleOptions(
            geometry: LatLng(latitude, longitude),
            circleRadius: 9,
            circleColor: '#128078',
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 2,
          ),
        );
        _propertyCircleListings[circle.id] = property;
      }
      final location = _currentLocation;
      if (location != null) {
        await controller.addCircle(
          CircleOptions(
            geometry: location,
            circleRadius: 19,
            circleColor: '#3376FF',
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 3,
          ),
        );
        await controller.addCircle(
          CircleOptions(
            geometry: location,
            circleRadius: 7,
            circleColor: '#2176FF',
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 2,
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        _showNotice(
          '${_t('Impossible d’afficher les annonces sur la carte :')} $error',
        );
      }
    }
  }

  Future<void> _syncListingMapMarker() async {
    final controller = _listingMapController;
    if (!mounted || !_listingMapStyleLoaded || controller == null) return;
    try {
      await controller.clearCircles();
      final location = _listingLocation;
      if (location != null) {
        await controller.addCircle(
          CircleOptions(
            geometry: location,
            circleRadius: 10,
            circleColor: '#128078',
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 3,
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        _showNotice(
          '${_t('Impossible d’afficher l’emplacement choisi :')} $error',
        );
      }
    }
  }

  void _selectListingLocation(LatLng location) {
    setState(() => _listingLocation = location);
    unawaited(_syncListingMapMarker());
  }

  void _scheduleSearch() {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 220), _loadProperties);
  }

  Future<void> _loadUserData(String session) async {
    final results = await Future.wait([
      _request('/favorites', session: session),
      _request('/my/properties', session: session),
      _request('/conversations', session: session),
      _request('/notifications', session: session),
    ]);
    if (!mounted) return;
    setState(() {
      _favorites = _mapList(results[0]['items']);
      _myProperties = _mapList(results[1]['items']);
      _conversations = _mapList(results[2]['items']);
      _notifications = _mapList(results[3]['items']);
    });
    final notificationItems = _mapList(results[3]['items']);
    if (_hasLoadedNotifications) {
      for (final item in notificationItems) {
        if (!_knownNotificationIds.contains(item['id']) &&
            (item['read'] == false || item['read'] == 0)) {
          await _notifyLocally(
            item['title'] as String? ?? 'Domus',
            item['body'] as String? ?? '',
          );
        }
      }
    }
    _knownNotificationIds.addAll(notificationItems.map((item) => item['id']));
    _hasLoadedNotifications = true;
  }

  Future<void> _signIn() async {
    setState(() => _busy = true);
    try {
      final result = await _request(
        _registerMode ? '/auth/register' : '/auth/login',
        method: 'POST',
        body: _registerMode
            ? {
                'name': _authName.text.trim(),
                'email': _authEmail.text.trim(),
                'password': _authPassword.text,
                'acceptedTerms': _acceptedTerms,
              }
            : {'email': _authEmail.text.trim(), 'password': _authPassword.text},
      );
      final session = result['token'] as String?;
      final accountValue = result['user'];
      if (_registerMode && (session == null || accountValue is! Map)) {
        _authPassword.clear();
        if (!mounted) return;
        setState(() {
          _registerMode = false;
          _authFlow = 'verify';
        });
        _showNotice(
          'Si cette adresse peut être vérifiée, un courriel de confirmation a été envoyé. Consultez votre boîte de réception.',
        );
        return;
      }
      if (session == null || accountValue is! Map<String, dynamic>) {
        throw StateError('Connexion impossible pour le moment.');
      }
      final account = accountValue;
      await _storage.write(key: 'domus.token', value: session);
      if (!mounted) return;
      setState(() {
        _token = session;
        _user = account;
        _profileName.text = account['name'] as String? ?? '';
        _profilePhone.text = account['phone'] as String? ?? '';
        _authPassword.clear();
      });
      if (account['role'] == 'admin') {
        await _loadAdminData(session);
      } else {
        await _loadUserData(session);
      }
      if (mounted) {
        _showNotice('Bienvenue chez vous !');
      }
    } catch (error) {
      if (error is DomusApiException &&
          error.code == 'email_verification_required') {
        _authPassword.clear();
        _authToken.clear();
        if (!mounted) return;
        setState(() {
          _registerMode = false;
          _authFlow = 'verify';
        });
        _showNotice(
          'Votre adresse e-mail n’est pas encore vérifiée. Saisissez le code reçu ou demandez un nouvel envoi.',
        );
      } else if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyEmail() async {
    final code = _authToken.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      _showNotice(
        'Saisissez les 6 chiffres du code de vérification reçu par e-mail.',
      );
      return;
    }
    final email = _authEmail.text.trim();
    if (email.isEmpty) {
      _showNotice('Saisissez votre adresse e-mail.');
      return;
    }
    setState(() => _busy = true);
    try {
      await _request(
        '/auth/verify-email',
        method: 'POST',
        body: {'email': email, 'token': code},
      );
      if (!mounted) return;
      setState(() {
        _authToken.clear();
        _authFlow = 'login';
      });
      _showNotice(
        'Adresse e-mail vérifiée. Vous pouvez maintenant vous connecter.',
      );
    } catch (_) {
      _showNotice(
        'Ce code de vérification est invalide ou expiré. Vérifiez-le.',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resendVerificationEmail() async {
    final email = _authEmail.text.trim();
    if (email.isEmpty) {
      _showNotice('Saisissez votre adresse e-mail.');
      return;
    }
    setState(() => _busy = true);
    try {
      await _request(
        '/auth/resend-verification',
        method: 'POST',
        body: {'email': email},
      );
      if (mounted) {
        _showNotice(
          'Si un compte correspondant peut être vérifié, un courriel de confirmation a été envoyé.',
        );
      }
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signOut() async {
    _messagePoll?.cancel();
    await _storage.delete(key: 'domus.token');
    if (!mounted) return;
    setState(() {
      _token = null;
      _user = null;
      _favorites = [];
      _myProperties = [];
      _conversations = [];
      _notifications = [];
      _section = 'main';
    });
    _showNotice('Vous êtes déconnecté(e).');
  }

  Future<void> _setLocalNotifications(bool enabled) async {
    if (enabled &&
        (kIsWeb ||
            (defaultTargetPlatform != TargetPlatform.android &&
                defaultTargetPlatform != TargetPlatform.iOS))) {
      _showNotice(
        'Les notifications locales sont disponibles sur Android et iOS.',
      );
      return;
    }
    if (mounted) setState(() => _localNotificationsBusy = true);
    try {
      if (enabled) {
        final granted = switch (defaultTargetPlatform) {
          TargetPlatform.android =>
            await _localNotifications
                    .resolvePlatformSpecificImplementation<
                      AndroidFlutterLocalNotificationsPlugin
                    >()
                    ?.requestNotificationsPermission() ??
                false,
          TargetPlatform.iOS =>
            await _localNotifications
                    .resolvePlatformSpecificImplementation<
                      IOSFlutterLocalNotificationsPlugin
                    >()
                    ?.requestPermissions(
                      alert: true,
                      badge: true,
                      sound: true,
                    ) ??
                false,
          _ => false,
        };
        if (!granted) {
          _showNotice(
            'Autorisez les notifications dans les réglages de votre appareil.',
          );
          return;
        }
      }
      await _storage.write(
        key: 'domus.localNotifications.enabled',
        value: enabled.toString(),
      );
      if (!mounted) return;
      setState(() => _localNotificationsEnabled = enabled);
      _showNotice(
        enabled
            ? 'Les notifications locales sont activées sur cet appareil.'
            : 'Les notifications locales sont désactivées.',
      );
    } catch (error) {
      if (mounted) {
        _showNotice(
          'Impossible de modifier les notifications locales : $error',
        );
      }
    } finally {
      if (mounted) setState(() => _localNotificationsBusy = false);
    }
  }

  Future<void> _notifyLocally(String title, String body) async {
    if (!_localNotificationsEnabled || kIsWeb) return;
    await _localNotifications.show(
      id: DateTime.now().millisecondsSinceEpoch.remainder(2147483647),
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          'domus_local',
          'Domus',
          channelDescription: 'Notifications locales Domus',
        ),
        iOS: DarwinNotificationDetails(),
      ),
    );
  }

  Future<void> _toggleFavorite(Map<String, dynamic> property) async {
    if (_token == null) {
      setState(() => _tab = 4);
      _showNotice('Connectez-vous pour enregistrer vos favoris.');
      return;
    }
    final isFavorite = property['favorite'] == true;
    try {
      await _request(
        '/favorites/${property['id']}',
        method: isFavorite ? 'DELETE' : 'PUT',
        session: _token,
      );
      await Future.wait([_loadProperties(), _loadUserData(_token!)]);
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  Future<void> _publishProperty() async {
    if (_token == null) {
      setState(() => _tab = 4);
      _showNotice('Connectez-vous pour publier une annonce.');
      return;
    }
    if (_listingLocation == null) {
      _showNotice('Sélectionnez l’emplacement exact du bien sur la carte.');
      return;
    }
    setState(() => _busy = true);
    try {
      await _request(
        _editingPropertyId == null
            ? '/properties'
            : '/my/properties/$_editingPropertyId',
        method: _editingPropertyId == null ? 'POST' : 'PUT',
        session: _token,
        body: {
          'title': _listingTitle.text.trim(),
          'description': _listingDescription.text.trim(),
          'price': num.tryParse(_listingPrice.text) ?? 0,
          'city': _listingCity.text.trim(),
          'latitude': _listingLocation!.latitude,
          'longitude': _listingLocation!.longitude,
          'surface': num.tryParse(_listingSurface.text) ?? 0,
          'bedrooms': int.tryParse(_listingBedrooms.text) ?? 0,
          'transaction': _postTransaction,
          'type': _postType,
          'imageUrl': _listingPhotos.isNotEmpty
              ? _listingPhotos.first
              : _listingImage.text.trim(),
          'photos': _listingPhotos,
        },
      );
      _listingTitle.clear();
      _listingDescription.clear();
      _listingPrice.clear();
      _listingCity.clear();
      _listingSurface.clear();
      _listingImage.clear();
      if (!mounted) return;
      setState(() {
        _editingPropertyId = null;
        _listingPhotos = [];
        _listingLocation = null;
        _tab = 0;
      });
      unawaited(_syncListingMapMarker());
      await Future.wait([_loadProperties(), _loadUserData(_token!)]);
      if (mounted) _showNotice('Votre annonce est en ligne.');
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeStatus(Map<String, dynamic> property) async {
    if (_token == null) return;
    final status = property['status'] == 'paused' ? 'online' : 'paused';
    try {
      await _request(
        '/my/properties/${property['id']}/status',
        method: 'PATCH',
        session: _token,
        body: {'status': status},
      );
      await Future.wait([_loadUserData(_token!), _loadProperties()]);
      if (mounted) {
        _showNotice(
          status == 'online'
              ? 'Annonce remise en ligne.'
              : 'Annonce mise en pause.',
        );
      }
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  void _editProperty(Map<String, dynamic> property) {
    setState(() {
      _editingPropertyId = property['id'] as int;
      _listingTitle.text = property['title'] as String? ?? '';
      _listingDescription.text = property['description'] as String? ?? '';
      _listingPrice.text = property['price']?.toString() ?? '';
      _listingCity.text = property['city'] as String? ?? '';
      final latitude = (property['latitude'] as num?)?.toDouble();
      final longitude = (property['longitude'] as num?)?.toDouble();
      _listingLocation = latitude == null || longitude == null
          ? null
          : LatLng(latitude, longitude);
      _listingSurface.text = property['surface']?.toString() ?? '';
      _listingBedrooms.text = property['bedrooms']?.toString() ?? '';
      _listingImage.text = resolvePhotoUrl(
        property['imageUrl'] as String? ?? '',
      );
      _listingPhotos = (property['photos'] as List? ?? [])
          .map((photo) => resolvePhotoUrl(photo.toString()))
          .toList();
      _postTransaction = property['transaction'] as String? ?? 'Vente';
      _postType = property['type'] as String? ?? 'Appartement';
      _tab = 2;
      _section = 'main';
    });
    final location = _listingLocation;
    if (location != null) {
      unawaited(
        _listingMapController?.animateCamera(
          CameraUpdate.newLatLngZoom(location, 15),
        ),
      );
      unawaited(_syncListingMapMarker());
    }
  }

  Future<void> _pickListingPhotos() async {
    if (_token == null) {
      setState(() => _tab = 4);
      _showNotice('Connectez-vous pour ajouter les photos de votre bien.');
      return;
    }
    final remaining = 10 - _listingPhotos.length;
    if (remaining <= 0) {
      _showNotice('Vous pouvez ajouter jusqu’à 10 photos.');
      return;
    }
    try {
      final selected = await _imagePicker.pickMultiImage(
        maxWidth: 1600,
        imageQuality: 78,
        limit: remaining,
        requestFullMetadata: false,
      );
      if (selected.isEmpty) return;
      setState(() => _busy = true);
      final uploaded = await Future.wait(
        selected.map((file) async {
          final bytes = await file.readAsBytes();
          final response = await _request(
            '/uploads',
            method: 'POST',
            session: _token,
            body: {
              'mimeType': lookupMimeType(file.name) ?? 'image/jpeg',
              'base64': base64Encode(bytes),
            },
          );
          return resolvePhotoUrl(response['url'].toString());
        }),
      );
      if (!mounted) return;
      setState(
        () =>
            _listingPhotos = [..._listingPhotos, ...uploaded].take(10).toList(),
      );
      final photoLabel = _t(
        uploaded.length == 1 ? 'photo ajoutée' : 'photos ajoutées',
      );
      _showNotice(
        _language == 'ar'
            ? '$photoLabel (${uploaded.length})'
            : '${uploaded.length} $photoLabel.',
      );
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _removeListingPhoto(int index) {
    setState(() {
      _listingPhotos.removeAt(index);
      _listingImage.text = _listingPhotos.isEmpty ? '' : _listingPhotos.first;
    });
  }

  Future<void> _openConversation(Map<String, dynamic> property) async {
    if (_token == null) {
      Navigator.pop(context);
      setState(() => _tab = 4);
      _showNotice('Connectez-vous pour contacter le propriétaire.');
      return;
    }
    try {
      final result = await _request(
        '/conversations',
        method: 'POST',
        session: _token,
        body: {'propertyId': property['id']},
      );
      final id = result['id'] as int;
      final entry = <String, dynamic>{
        'id': id,
        'propertyId': property['id'],
        'propertyTitle': property['title'],
        'contactName': property['ownerName'],
        'lastMessage': null,
      };
      await _loadMessages(id);
      if (!mounted) return;
      Navigator.pop(context);
      setState(() {
        _selectedConversation = entry;
        _tab = 3;
      });
      _startMessagePolling(id);
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  Future<void> _loadMessages(int id) async {
    if (_token == null) return;
    final result = await _request(
      '/conversations/$id/messages',
      session: _token,
    );
    if (mounted) setState(() => _messages = _mapList(result['items']));
    await _loadUserData(_token!);
  }

  void _startMessagePolling(int id) {
    _messagePoll?.cancel();
    _messagePoll = Timer.periodic(const Duration(seconds: 5), (_) async {
      try {
        final result = await _request(
          '/conversations/$id/messages',
          session: _token,
        );
        if (mounted && _selectedConversation?['id'] == id) {
          setState(() => _messages = _mapList(result['items']));
        }
      } catch (error) {
        if (mounted) {
          _showNotice(error.toString().replaceFirst('Exception: ', ''));
        }
      }
    });
  }

  Future<void> _sendMessage() async {
    final conversation = _selectedConversation;
    if (_token == null ||
        conversation == null ||
        _messageDraft.text.trim().isEmpty) {
      return;
    }
    try {
      await _request(
        '/conversations/${conversation['id']}/messages',
        method: 'POST',
        session: _token,
        body: {'body': _messageDraft.text.trim()},
      );
      _messageDraft.clear();
      await _loadMessages(conversation['id'] as int);
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  Future<void> _saveProfile() async {
    if (_token == null) return;
    try {
      final updated = await _request(
        '/profile',
        method: 'PATCH',
        session: _token,
        body: {
          'name': _profileName.text.trim(),
          'phone': _profilePhone.text.trim(),
        },
      );
      if (mounted) {
        setState(() => _user = updated);
        await Future.wait([_loadUserData(_token!), _loadProperties()]);
        _showNotice('Profil mis à jour.');
      }
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  Future<void> _loadAdminData([String? session]) async {
    final token = session ?? _token;
    if (token == null) return;
    try {
      final results = await Future.wait([
        _request('/admin/users', session: token),
        _request('/admin/properties', session: token),
        _request('/admin/reports', session: token),
      ]);
      if (!mounted) return;
      setState(() {
        _adminUsers = _mapList(results[0]['items']);
        _adminProperties = _mapList(results[1]['items']);
        _adminReports = _mapList(results[2]['items']);
      });
    } catch (error) {
      if (mounted) {
        if (error is DomusApiException && error.statusCode == 403) {
          await _storage.delete(key: 'domus.token');
          setState(() {
            _token = null;
            _user = null;
          });
        }
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  Future<bool> _confirmAdminAction(String title, String message) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: _LocalizedText(title),
          content: _LocalizedText(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const _LocalizedText('Annuler'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const _LocalizedText('Confirmer'),
            ),
          ],
        ),
      ) ==
      true;

  Future<void> _banAdminUser(Map<String, dynamic> user) async {
    if (!await _confirmAdminAction(
      'Bannir définitivement ?',
      'Ce compte ne pourra plus se connecter et ses annonces seront retirées.',
    )) {
      return;
    }
    try {
      await _request(
        '/admin/users/${user['id']}',
        method: 'DELETE',
        session: _token,
      );
      await _loadAdminData();
      _showNotice('Compte banni définitivement.');
    } catch (error) {
      _showNotice(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _deleteAdminProperty(Map<String, dynamic> property) async {
    if (!await _confirmAdminAction(
      'Supprimer cette annonce ?',
      'Cette action est définitive.',
    )) {
      return;
    }
    try {
      await _request(
        '/admin/properties/${property['id']}',
        method: 'DELETE',
        session: _token,
      );
      await _loadAdminData();
      await _loadProperties();
      _showNotice('Annonce supprimée.');
    } catch (error) {
      _showNotice(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _reviewAdminReport(
    Map<String, dynamic> report,
    String status,
  ) async {
    try {
      await _request(
        '/admin/reports/${report['id']}',
        method: 'PATCH',
        session: _token,
        body: {'status': status},
      );
      await _loadAdminData();
    } catch (error) {
      _showNotice(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _deleteMyProperty(Map<String, dynamic> property) async {
    final session = _token;
    if (session == null) return;
    if (!await _confirmAdminAction(
      'Supprimer mon annonce ?',
      'Cette action est définitive.',
    )) {
      return;
    }
    try {
      await _request(
        '/my/properties/${property['id']}',
        method: 'DELETE',
        session: session,
      );
      await Future.wait([_loadProperties(), _loadUserData(session)]);
      _showNotice('Annonce supprimée.');
    } catch (error) {
      _showNotice(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _confirmDeleteAccount() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const _LocalizedText('Supprimer votre compte ?'),
        content: const _LocalizedText(
          'Cette action supprime votre profil, vos annonces, favoris et conversations. Elle est définitive.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const _LocalizedText('Annuler'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: danger),
            onPressed: () => Navigator.pop(context, true),
            child: const _LocalizedText('Supprimer'),
          ),
        ],
      ),
    );
    if (confirmed != true || _token == null) return;
    setState(() => _busy = true);
    try {
      await _request('/account', method: 'DELETE', session: _token);
      await _storage.delete(key: 'domus.token');
      if (!mounted) return;
      setState(() {
        _token = null;
        _user = null;
        _favorites = [];
        _myProperties = [];
        _conversations = [];
        _notifications = [];
        _section = 'main';
        _tab = 0;
      });
      await _loadProperties();
      if (mounted) {
        _showNotice('Votre compte et vos données ont été supprimés.');
      }
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showNotice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: _LocalizedText(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: ink,
        ),
      );
  }

  List<Map<String, dynamic>> _mapList(dynamic value) {
    if (value is! List) return [];
    return value
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  void _changeTab(int value) {
    _messagePoll?.cancel();
    setState(() {
      _tab = value;
      _section = 'main';
      _selectedConversation = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_isInitializing) {
      return Directionality(
        textDirection: _language == 'ar'
            ? TextDirection.rtl
            : TextDirection.ltr,
        child: _buildSplashScreen(),
      );
    }
    final screens = [
      _buildHome(),
      _buildMap(),
      _buildPublish(),
      _buildMessages(),
      _buildProfile(),
    ];
    return Directionality(
      textDirection: _language == 'ar' ? TextDirection.rtl : TextDirection.ltr,
      child: Scaffold(
        body: SafeArea(
          child: IndexedStack(index: _tab, children: screens),
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: _changeTab,
          backgroundColor: Colors.white,
          indicatorColor: mint,
          destinations: [
            NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home, color: teal),
              label: _t('Accueil'),
            ),
            NavigationDestination(
              icon: Icon(Icons.map_outlined),
              selectedIcon: Icon(Icons.map, color: teal),
              label: _t('Carte'),
            ),
            NavigationDestination(
              icon: Icon(Icons.add_circle_outline),
              selectedIcon: Icon(Icons.add_circle, color: teal),
              label: _t('Publier'),
            ),
            NavigationDestination(
              icon: Icon(Icons.chat_bubble_outline),
              selectedIcon: Icon(Icons.chat_bubble, color: teal),
              label: _t('Messages'),
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person, color: teal),
              label: _t('Profil'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSplashScreen() {
    return Scaffold(
      backgroundColor: teal,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(26),
                ),
                child: const Icon(Icons.home_rounded, color: teal, size: 56),
              ),
              const SizedBox(height: 20),
              const _LocalizedText(
                'domus.',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 36,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              _LocalizedText(
                _t('VOTRE PROCHAIN CHEZ-VOUS'),
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.4,
                ),
              ),
              const SizedBox(height: 34),
              SizedBox(
                width: 170,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: const LinearProgressIndicator(
                    minHeight: 5,
                    backgroundColor: Color(0x6688C7C2),
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHome() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 30),
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  RichText(
                    text: const TextSpan(
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        color: ink,
                      ),
                      children: [
                        TextSpan(text: 'domus'),
                        TextSpan(
                          text: '.',
                          style: TextStyle(color: teal),
                        ),
                      ],
                    ),
                  ),
                  _LocalizedText(
                    _t('VOTRE PROCHAIN CHEZ-VOUS'),
                    style: TextStyle(
                      color: teal,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.2,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ),
            IconButton.filledTonal(
              onPressed: () => _changeTab(4),
              style: IconButton.styleFrom(
                backgroundColor: mint,
                foregroundColor: teal,
              ),
              icon: _LocalizedText(
                _user?['name']?.toString().characters.first.toUpperCase() ??
                    '⌕',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
        const SizedBox(height: 22),
        _LocalizedText(
          '${_t('Trouvez le bien')}\n${_t('qui vous ressemble.')}',
          style: TextStyle(
            color: ink,
            fontSize: 30,
            height: 1.13,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 8),
        _LocalizedText(
          _t('Des lieux de vie, partout en Tunisie.'),
          style: TextStyle(color: muted),
        ),
        const SizedBox(height: 20),
        TextField(
          decoration: InputDecoration(
            hintText: _t('Ville, quartier, type de bien...'),
            prefixIcon: const Icon(Icons.search, color: muted),
            suffixIcon: IconButton(
              icon: const Icon(Icons.tune, color: teal),
              onPressed: _showFilters,
            ),
          ),
          onChanged: (value) {
            _query = value;
            _scheduleSearch();
          },
        ),
        const SizedBox(height: 16),
        _choiceChips(['Tous', 'Vente', 'Location'], _transaction, (value) {
          setState(() => _transaction = value);
          _loadProperties();
        }),
        const SizedBox(height: 23),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _LocalizedText(
                  _t('Explorer les biens'),
                  style: TextStyle(
                    color: ink,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                _LocalizedText(
                  '${_properties.length} ${_t('annonces à découvrir')}',
                  style: const TextStyle(color: muted, fontSize: 12),
                ),
              ],
            ),
            TextButton(
              onPressed: () => _changeTab(1),
              child: _LocalizedText('${_t('Voir la carte')}  ›'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: _choiceChips(
            ['Tous', 'Appartement', 'Villa', 'Terrain', 'Studio'],
            _type,
            (value) {
              setState(() => _type = value);
              _loadProperties();
            },
          ),
        ),
        if (_properties.isEmpty)
          _emptyState(
            'Aucun bien pour le moment',
            'Essayez de modifier votre recherche.',
          )
        else
          ..._properties.map((property) => _propertyCard(property)),
      ],
    );
  }

  Widget _buildMap() {
    final mappedProperties = _properties
        .where(
          (property) =>
              property['latitude'] != null && property['longitude'] != null,
        )
        .toList();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const _LocalizedText(
          'Les biens autour de vous',
          style: TextStyle(
            color: ink,
            fontSize: 24,
            fontWeight: FontWeight.w700,
          ),
        ),
        const _LocalizedText(
          'Les annonces affichées ont un emplacement choisi par leur propriétaire.',
          style: TextStyle(color: muted),
        ),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton.icon(
            onPressed: _locating ? null : _locateMe,
            icon: _locating
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.my_location),
            label: _LocalizedText(
              _locating ? 'Localisation...' : 'Me localiser',
            ),
          ),
        ),
        if (_currentLocation != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(
              children: [
                const _LocalizedText(
                  'Votre position est affichée sur la carte.',
                  style: TextStyle(color: teal, fontSize: 12),
                ),
                if (_currentLocationAccuracy != null) ...[
                  const SizedBox(width: 6),
                  _LocalizedText(
                    '±${_currentLocationAccuracy!.round()} m',
                    style: const TextStyle(color: teal, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
        const SizedBox(height: 18),
        ClipRRect(
          borderRadius: BorderRadius.circular(22),
          child: SizedBox(
            key: const ValueKey('property-openfreemap-map'),
            height: 370,
            child: MapLibreMap(
              styleString: openFreeMapStyle,
              initialCameraPosition: CameraPosition(
                target: _currentLocation ?? const LatLng(34, 9.5),
                zoom: _currentLocation == null ? 6 : 12,
              ),
              onMapCreated: (controller) {
                _propertyMapController = controller;
                final location = _currentLocation;
                if (location != null) {
                  unawaited(
                    controller.animateCamera(
                      CameraUpdate.newLatLngZoom(location, 11),
                    ),
                  );
                }
                controller.onCircleTapped.add((circle) {
                  final property = _propertyCircleListings[circle.id];
                  if (property != null) _showProperty(property);
                });
              },
              onStyleLoadedCallback: () {
                _propertyMapStyleLoaded = true;
                unawaited(_syncPropertyMapMarkers());
              },
              myLocationEnabled: false,
              gestureRecognizers: {
                Factory<OneSequenceGestureRecognizer>(
                  () => EagerGestureRecognizer(),
                ),
              },
            ),
          ),
        ),
        if (mappedProperties.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 10),
            child: _LocalizedText(
              'Aucune annonce avec emplacement exact pour le moment.',
              style: TextStyle(color: muted),
            ),
          ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _LocalizedText(
              _t('Annonces à proximité'),
              style: const TextStyle(
                color: ink,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
            _LocalizedText(
              '${_properties.length} ${_t('biens')}',
              style: const TextStyle(color: muted),
            ),
          ],
        ),
        if (_currentLocation != null)
          _LocalizedText(
            'Distances calculées depuis votre position et les coordonnées exactes.',
            style: const TextStyle(color: muted, fontSize: 12),
          ),
        ..._nearbyProperties
            .take(4)
            .map(
              (property) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_currentLocation != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: _LocalizedText(
                        property['latitude'] == null ||
                                property['longitude'] == null
                            ? 'Emplacement exact non renseigné'
                            : '${(_distanceTo(property, _currentLocation!) / 1000).toStringAsFixed(1)} km',
                        style: const TextStyle(color: muted, fontSize: 12),
                      ),
                    ),
                  _propertyCard(property),
                ],
              ),
            ),
      ],
    );
  }

  Widget _buildPublish() {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const _LocalizedText(
          'ESPACE PROPRIÉTAIRE',
          style: TextStyle(
            color: teal,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.3,
          ),
        ),
        const SizedBox(height: 5),
        const _LocalizedText(
          'Publier une annonce',
          style: TextStyle(
            color: ink,
            fontSize: 27,
            fontWeight: FontWeight.w700,
          ),
        ),
        const _LocalizedText(
          'Présentez votre bien en quelques étapes.',
          style: TextStyle(color: muted),
        ),
        if (_token == null)
          _authCard()
        else
          Card(
            margin: const EdgeInsets.only(top: 18),
            color: Colors.white,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _LocalizedText(
                    _editingPropertyId == null
                        ? '1. Votre bien'
                        : 'Modifier mon annonce',
                    style: const TextStyle(
                      color: ink,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _choiceChips(
                    ['Vente', 'Location'],
                    _postTransaction,
                    (value) => setState(() => _postTransaction = value),
                  ),
                  const SizedBox(height: 8),
                  _choiceChips(
                    ['Appartement', 'Villa', 'Terrain', 'Studio'],
                    _postType,
                    (value) => setState(() => _postType = value),
                  ),
                  const SizedBox(height: 12),
                  _textField(
                    'Titre de l’annonce',
                    _listingTitle,
                    hint: 'Appartement lumineux avec terrasse',
                  ),
                  _textField(
                    'Description',
                    _listingDescription,
                    hint: 'Décrivez votre bien...',
                    maxLines: 4,
                  ),
                  _textField(
                    'Prix (DT)',
                    _listingPrice,
                    keyboard: TextInputType.number,
                  ),
                  _textField('Ville', _listingCity, hint: 'Tunis, La Marsa...'),
                  _buildListingLocationPicker(),
                  Row(
                    children: [
                      Expanded(
                        child: _textField(
                          'Surface (m²)',
                          _listingSurface,
                          keyboard: TextInputType.number,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _textField(
                          'Chambres',
                          _listingBedrooms,
                          keyboard: TextInputType.number,
                        ),
                      ),
                    ],
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: _LocalizedText(
                      '${_t('Photos')} (${_listingPhotos.length}/10)',
                      style: const TextStyle(
                        color: ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Wrap(
                    spacing: 9,
                    runSpacing: 9,
                    children: [
                      ..._listingPhotos.asMap().entries.map(
                        (entry) => Stack(
                          clipBehavior: Clip.none,
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: Image.network(
                                entry.value,
                                width: 76,
                                height: 76,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => _photoFallback(),
                              ),
                            ),
                            Positioned(
                              top: -7,
                              right: -7,
                              child: IconButton.filled(
                                visualDensity: VisualDensity.compact,
                                constraints: const BoxConstraints.tightFor(
                                  width: 26,
                                  height: 26,
                                ),
                                padding: EdgeInsets.zero,
                                style: IconButton.styleFrom(
                                  backgroundColor: ink,
                                  foregroundColor: Colors.white,
                                ),
                                onPressed: () => _removeListingPhoto(entry.key),
                                icon: const Icon(Icons.close, size: 15),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (_listingPhotos.length < 10)
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _pickListingPhotos,
                          style: OutlinedButton.styleFrom(
                            foregroundColor: teal,
                            side: const BorderSide(color: teal),
                            minimumSize: const Size(125, 76),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          icon: const Icon(Icons.add_photo_alternate_outlined),
                          label: const _LocalizedText('Ajouter'),
                        ),
                    ],
                  ),
                  _textField(
                    'Photo (URL, facultatif)',
                    _listingImage,
                    hint: 'https://...',
                  ),
                  const SizedBox(height: 14),
                  _primaryButton(
                    _busy
                        ? 'Enregistrement…'
                        : (_editingPropertyId == null
                              ? 'Publier mon annonce'
                              : 'Enregistrer les modifications'),
                    _busy ? null : _publishProperty,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildListingLocationPicker() {
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _LocalizedText(
            'Emplacement exact du bien',
            style: TextStyle(color: ink, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: SizedBox(
              key: const ValueKey('listing-openfreemap-map'),
              height: 260,
              child: MapLibreMap(
                styleString: openFreeMapStyle,
                initialCameraPosition: CameraPosition(
                  target: _listingLocation ?? const LatLng(34, 9.5),
                  zoom: _listingLocation == null ? 6 : 15,
                ),
                onMapCreated: (controller) {
                  _listingMapController = controller;
                  final location = _listingLocation;
                  if (location != null) {
                    unawaited(
                      controller.animateCamera(
                        CameraUpdate.newLatLngZoom(location, 15),
                      ),
                    );
                  }
                },
                onStyleLoadedCallback: () {
                  _listingMapStyleLoaded = true;
                  unawaited(_syncListingMapMarker());
                },
                onMapClick: (_, coordinates) =>
                    _selectListingLocation(coordinates),
                gestureRecognizers: {
                  Factory<OneSequenceGestureRecognizer>(
                    () => EagerGestureRecognizer(),
                  ),
                },
              ),
            ),
          ),
          const SizedBox(height: 6),
          _LocalizedText(
            _listingLocation == null
                ? 'Touchez la carte à l’emplacement du bien.'
                : '${_listingLocation!.latitude.toStringAsFixed(5)}, ${_listingLocation!.longitude.toStringAsFixed(5)}',
            style: const TextStyle(color: muted, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _buildMessages() {
    if (_token == null) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const _LocalizedText(
            'Messages',
            style: TextStyle(
              color: ink,
              fontSize: 27,
              fontWeight: FontWeight.w700,
            ),
          ),
          _authCard(),
        ],
      );
    }
    if (_selectedConversation != null) return _buildConversation();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const _LocalizedText(
          'VOTRE ESPACE',
          style: TextStyle(
            color: teal,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.3,
          ),
        ),
        const SizedBox(height: 5),
        const _LocalizedText(
          'Messages',
          style: TextStyle(
            color: ink,
            fontSize: 27,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (_conversations.isEmpty)
          _emptyState(
            'Aucune conversation',
            'Contactez un propriétaire depuis une annonce pour démarrer.',
          )
        else
          ..._conversations.map(
            (conversation) => Card(
              color: Colors.white,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: mint,
                  foregroundColor: teal,
                  child: _LocalizedText(
                    (conversation['contactName'] as String? ?? '?')
                        .characters
                        .first,
                  ),
                ),
                title: _LocalizedText(
                  conversation['contactName'] as String? ?? 'Propriétaire',
                  style: const TextStyle(
                    color: ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                subtitle: _LocalizedText(
                  '${conversation['propertyTitle'] ?? ''}\n${conversation['lastMessage'] ?? 'Démarrer la conversation'}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: const Icon(Icons.chevron_right, color: muted),
                onTap: () async {
                  final id = conversation['id'] as int;
                  await _loadMessages(id);
                  if (mounted) {
                    setState(() => _selectedConversation = conversation);
                    _startMessagePolling(id);
                  }
                },
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildConversation() {
    final conversation = _selectedConversation!;
    return Column(
      children: [
        ListTile(
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: teal),
            onPressed: () {
              _messagePoll?.cancel();
              setState(() => _selectedConversation = null);
            },
          ),
          title: _LocalizedText(
            conversation['contactName'] as String? ?? 'Conversation',
            style: const TextStyle(color: ink, fontWeight: FontWeight.w700),
          ),
          subtitle: _LocalizedText(
            conversation['propertyTitle'] as String? ?? '',
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: _messages.isEmpty
                ? [
                    const Center(
                      child: _LocalizedText(
                        'Posez une question sur ce bien pour démarrer.',
                        style: TextStyle(color: muted),
                      ),
                    ),
                  ]
                : _messages.map((message) {
                    final own = message['senderId'] == _user?['id'];
                    return Align(
                      alignment: own
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 300),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 10,
                        ),
                        margin: const EdgeInsets.only(bottom: 9),
                        decoration: BoxDecoration(
                          color: own ? teal : Colors.white,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: _LocalizedText(
                          message['body'] as String? ?? '',
                          style: TextStyle(color: own ? Colors.white : ink),
                        ),
                      ),
                    );
                  }).toList(),
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageDraft,
                    decoration: const InputDecoration(
                      hintText: 'Écrire un message...',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: _sendMessage,
                  icon: const Icon(Icons.arrow_upward),
                  style: IconButton.styleFrom(
                    backgroundColor: teal,
                    foregroundColor: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildProfile() {
    if (_user?['role'] == 'admin') return _buildAdminConsole();
    if (_section == 'favorites') {
      return _subPage(
        'Mes favoris',
        _favorites.isEmpty
            ? [
                _emptyState(
                  'Pas encore de favoris',
                  'Touchez le cœur d’une annonce pour la retrouver ici.',
                ),
              ]
            : _favorites.map(_propertyCard).toList(),
      );
    }
    if (_section == 'listings') {
      return _subPage(
        'Mes annonces',
        _myProperties.isEmpty
            ? [
                _emptyState(
                  'Aucune annonce publiée',
                  'Votre prochaine annonce n’attend que vous.',
                ),
              ]
            : _myProperties
                  .map(
                    (property) => Column(
                      children: [
                        _propertyCard(property),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () => _editProperty(property),
                                child: const _LocalizedText('Modifier'),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () => _changeStatus(property),
                                child: _LocalizedText(
                                  property['status'] == 'paused'
                                      ? 'Remettre en ligne'
                                      : 'Mettre en pause',
                                ),
                              ),
                            ),
                          ],
                        ),
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton.icon(
                            onPressed: () => _deleteMyProperty(property),
                            icon: const Icon(
                              Icons.delete_outline,
                              color: danger,
                            ),
                            label: const _LocalizedText(
                              'Supprimer',
                              style: TextStyle(color: danger),
                            ),
                          ),
                        ),
                      ],
                    ),
                  )
                  .toList(),
      );
    }
    if (_section == 'notifications') {
      return _subPage(
        'Notifications',
        _notifications.isEmpty
            ? [
                _emptyState(
                  'Tout est à jour',
                  'Les nouveaux messages et annonces apparaîtront ici.',
                ),
              ]
            : _notifications
                  .map(
                    (item) => Card(
                      color: Colors.white,
                      child: ListTile(
                        leading: const CircleAvatar(
                          backgroundColor: mint,
                          child: Icon(Icons.notifications_none, color: teal),
                        ),
                        title: _LocalizedText(
                          item['title'] as String? ?? 'Notification',
                          style: const TextStyle(
                            color: ink,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        subtitle: _LocalizedText(item['body'] as String? ?? ''),
                      ),
                    ),
                  )
                  .toList(),
      );
    }
    if (_section == 'privacy') {
      return _subPage('Confidentialité', [
        _privacyItem(
          'Données collectées',
          'Nom, adresse e-mail et téléphone facultatif du compte; annonces, photos, ville et emplacement précis fournis par leur propriétaire.',
        ),
        _privacyItem(
          'Activité du compte',
          'Favoris, conversations et messages sont enregistrés pour fournir les fonctions de l’application.',
        ),
        _privacyItem(
          'Utilisation des données',
          'Les données servent à publier et rechercher des biens, afficher les cartes et permettre aux acheteurs et propriétaires de communiquer.',
        ),
        _privacyItem(
          'Partage et services',
          'Les annonces et les emplacements choisis sont visibles par les utilisateurs. Les données nécessaires sont échangées avec le serveur Domus; les cartes chargent les tuiles OpenFreeMap.',
        ),
        _privacyItem(
          'Notifications locales',
          'Les préférences et alertes locales sont gérées sur cet appareil. Elles ne sont pas envoyées à Firebase ou à un service push.',
        ),
        _privacyItem(
          'Conservation et suppression',
          'Les données restent dans le compte jusqu’à suppression. La suppression du compte efface le profil, les annonces et les données associées selon le fonctionnement du service.',
        ),
        _privacyItem(
          'Vos choix',
          'Vous pouvez modifier votre profil, désactiver les notifications dans les réglages de l’appareil ou supprimer votre compte depuis le profil.',
        ),
        _privacyItem(
          'Contact',
          'Pour toute question relative à la confidentialité, contactez le support Domus.',
        ),
      ]);
    }
    if (_section == 'settings') {
      return _subPage(_t('Paramètres'), [
        SwitchListTile(
          value: _localNotificationsEnabled,
          onChanged: _localNotificationsBusy ? null : _setLocalNotifications,
          activeTrackColor: teal,
          title: _LocalizedText(
            _t('Notifications locales'),
            style: const TextStyle(color: ink),
          ),
          subtitle: _LocalizedText(
            _t('Alertes locales sur cet appareil uniquement'),
            style: TextStyle(color: muted),
          ),
        ),
        SwitchListTile(
          value: _notificationsEnabled,
          onChanged: (value) => setState(() => _notificationsEnabled = value),
          activeTrackColor: teal,
          title: _LocalizedText(
            _t('Notifications dans l’application'),
            style: TextStyle(color: ink),
          ),
          subtitle: _LocalizedText(
            _t('Messages et annonces sauvegardées'),
            style: TextStyle(color: muted),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _LocalizedText(_t('Langue'), style: const TextStyle(color: ink)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final (code, label) in [
                    ('fr', 'Français'),
                    ('en', 'English'),
                    ('ar', 'العربية'),
                  ])
                    ChoiceChip(
                      label: _LocalizedText(label),
                      selected: _language == code,
                      onSelected: (_) => _setLanguage(code),
                      selectedColor: mint,
                      side: BorderSide(
                        color: _language == code ? teal : border,
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
        ListTile(
          title: _LocalizedText(_t('Confidentialité')),
          trailing: _LocalizedText(_t('Gérer')),
          onTap: () => setState(() => _section = 'privacy'),
        ),
      ]);
    }
    return ListView(
      key: const ValueKey('profile-list'),
      padding: const EdgeInsets.all(20),
      children: [
        const _LocalizedText(
          'VOTRE ESPACE',
          style: TextStyle(
            color: teal,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.3,
          ),
        ),
        const SizedBox(height: 5),
        const _LocalizedText(
          'Mon profil',
          style: TextStyle(
            color: ink,
            fontSize: 27,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (_user == null) ...[
          Card(
            color: mint,
            child: const Padding(
              padding: EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _LocalizedText(
                    'Bienvenue chez Domus',
                    style: TextStyle(
                      color: ink,
                      fontWeight: FontWeight.w700,
                      fontSize: 17,
                    ),
                  ),
                  SizedBox(height: 5),
                  _LocalizedText(
                    'Un compte pour contacter les propriétaires et garder vos biens favoris.',
                    style: TextStyle(color: muted),
                  ),
                ],
              ),
            ),
          ),
          _authCard(),
          Card(
            color: Colors.white,
            child: Column(
              children: [
                _menuRow(
                  'Mes favoris',
                  () => setState(() => _section = 'favorites'),
                ),
                _menuRow(
                  'Paramètres',
                  () => setState(() => _section = 'settings'),
                ),
              ],
            ),
          ),
        ] else ...[
          Card(
            color: Colors.white,
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: mint,
                foregroundColor: teal,
                child: _LocalizedText(
                  (_user?['name'] as String? ?? 'D').characters.first
                      .toUpperCase(),
                ),
              ),
              title: _LocalizedText(
                _user?['name'] as String? ?? '',
                style: const TextStyle(color: ink, fontWeight: FontWeight.w700),
              ),
              subtitle: _LocalizedText(_user?['email'] as String? ?? ''),
            ),
          ),
          Card(
            color: Colors.white,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: _LocalizedText(
                      'Modifier le profil',
                      style: TextStyle(color: ink, fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(height: 10),
                  _textField('Nom complet', _profileName),
                  _textField(
                    'Téléphone',
                    _profilePhone,
                    keyboard: TextInputType.phone,
                  ),
                  const SizedBox(height: 10),
                  _secondaryButton('Enregistrer', _saveProfile),
                ],
              ),
            ),
          ),
          Card(
            color: Colors.white,
            child: Column(
              children: [
                _menuRow(
                  'Mes annonces',
                  () => setState(() => _section = 'listings'),
                ),
                _menuRow(
                  'Mes favoris',
                  () => setState(() => _section = 'favorites'),
                ),
                _menuRow(
                  'Notifications',
                  () => setState(() => _section = 'notifications'),
                ),
                _menuRow(
                  'Paramètres',
                  () => setState(() => _section = 'settings'),
                ),
                _menuRow('Centre d’aide', _openSupportEmail),
              ],
            ),
          ),
          const SizedBox(height: 8),
          _secondaryButton('Se déconnecter', _signOut),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _busy ? null : _confirmDeleteAccount,
            child: const _LocalizedText(
              'Supprimer mon compte',
              style: TextStyle(color: danger),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildAdminConsole() {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: mint,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: const Icon(Icons.shield_outlined, color: teal),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _LocalizedText(
                      'Espace sécurisé',
                      style: TextStyle(color: ink, fontWeight: FontWeight.w700),
                    ),
                    SizedBox(height: 3),
                    _LocalizedText(
                      'Gestion des comptes, annonces et signalements.',
                      style: TextStyle(color: muted, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() => _section = 'main'),
            icon: const Icon(Icons.arrow_back, size: 18),
            label: const _LocalizedText('Mon profil'),
          ),
        ),
        Row(
          children: [
            const Expanded(
              child: _LocalizedText(
                'Administration',
                style: TextStyle(
                  color: ink,
                  fontSize: 27,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            IconButton(
              tooltip: _t('Actualiser'),
              onPressed: _loadAdminData,
              icon: const Icon(Icons.refresh),
            ),
            IconButton(
              tooltip: _t('Se déconnecter'),
              onPressed: _signOut,
              icon: const Icon(Icons.logout),
            ),
          ],
        ),
        _adminSectionHeader('Comptes', _adminUsers.length),
        ..._adminUsers.map((user) {
          final banned = user['bannedAt'] != null;
          return Card(
            color: Colors.white,
            child: ListTile(
              title: _LocalizedText(user['name'] as String? ?? ''),
              subtitle: _LocalizedText(user['email'] as String? ?? ''),
              trailing: banned
                  ? const Icon(Icons.block, color: danger)
                  : IconButton(
                      tooltip: _t('Bannir définitivement'),
                      onPressed: () => _banAdminUser(user),
                      icon: const Icon(
                        Icons.person_off_outlined,
                        color: danger,
                      ),
                    ),
              titleTextStyle: const TextStyle(
                color: ink,
                fontWeight: FontWeight.w700,
              ),
              subtitleTextStyle: const TextStyle(color: muted),
              leading: const Icon(Icons.person_outline, color: teal),
            ),
          );
        }),
        const SizedBox(height: 16),
        _adminSectionHeader('Annonces', _adminProperties.length),
        ..._adminProperties.map(
          (property) => Card(
            color: Colors.white,
            child: ListTile(
              onTap: () => _showAdminProperty(property),
              title: _LocalizedText(property['title'] as String? ?? ''),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _LocalizedText(
                    '${property['city'] ?? ''} · ${_formatPrice(property)} · ${_t(property['status'] as String? ?? '')}',
                  ),
                  const _LocalizedText(
                    'Voir les détails',
                    style: TextStyle(color: teal, fontSize: 12),
                  ),
                ],
              ),
              trailing: IconButton(
                tooltip: _t('Supprimer'),
                onPressed: () => _deleteAdminProperty(property),
                icon: const Icon(Icons.delete_outline, color: danger),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        _adminSectionHeader('Signalements', _adminReports.length),
        if (_adminReports.isEmpty)
          const Card(
            color: Colors.white,
            child: ListTile(title: _LocalizedText('Aucun signalement.')),
          ),
        ..._adminReports.map((report) {
          final status = report['status'] as String? ?? 'pending';
          return Card(
            color: Colors.white,
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => _showAdminReport(report),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _LocalizedText(
                      report['propertyTitle'] as String? ??
                          'Annonce supprimée (${report['propertyId']})',
                      style: const TextStyle(
                        color: ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    _LocalizedText(
                      '${report['reporterName'] ?? ''} · ${report['reporterEmail'] ?? ''}',
                      style: const TextStyle(color: muted, fontSize: 12),
                    ),
                    const SizedBox(height: 6),
                    _LocalizedText(report['reason'] as String? ?? ''),
                    Row(
                      children: [
                        const _LocalizedText('Statut :'),
                        const SizedBox(width: 4),
                        _LocalizedText(status),
                        const Spacer(),
                        if (status != 'resolved')
                          TextButton(
                            onPressed: () =>
                                _reviewAdminReport(report, 'resolved'),
                            child: const _LocalizedText('Résoudre'),
                          ),
                        if (status != 'rejected')
                          TextButton(
                            onPressed: () =>
                                _reviewAdminReport(report, 'rejected'),
                            child: const _LocalizedText('Rejeter'),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        }),
      ],
    );
  }

  Widget _adminSectionHeader(String label, int count) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      children: [
        Expanded(
          child: _LocalizedText(
            label,
            style: const TextStyle(
              color: ink,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        CircleAvatar(
          radius: 13,
          backgroundColor: mint,
          child: Text(
            '$count',
            style: const TextStyle(
              color: teal,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );

  Future<void> _showAdminProperty(Map<String, dynamic> property) async {
    final photos = _propertyPhotos(property);
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: _LocalizedText(property['title'] as String? ?? ''),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (photos.isNotEmpty)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.network(
                      photos.first,
                      height: 190,
                      width: 360,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const SizedBox.shrink(),
                    ),
                  ),
                const SizedBox(height: 10),
                _LocalizedText(
                  '${_formatPrice(property)} · ${_t(property['status'] as String? ?? '')}',
                  style: const TextStyle(
                    color: teal,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                _LocalizedText(
                  '${property['city'] ?? ''}${(property['neighborhood'] as String? ?? '').isNotEmpty ? ' · ${property['neighborhood']}' : ''}',
                  style: const TextStyle(color: muted),
                ),
                const SizedBox(height: 14),
                const _LocalizedText(
                  'Description',
                  style: TextStyle(color: ink, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                _LocalizedText(property['description'] as String? ?? ''),
                const SizedBox(height: 12),
                _LocalizedText(
                  '${property['ownerName'] ?? ''}',
                  style: const TextStyle(color: muted, fontSize: 12),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _stat('${property['surface'] ?? 0} m²', 'Surface'),
                    _stat('${property['bedrooms'] ?? 0}', 'Chambres'),
                  ],
                ),
                if (photos.length > 1) ...[
                  const SizedBox(height: 12),
                  _LocalizedText(
                    '${photos.length} ${_t('Photos')}',
                    style: const TextStyle(color: muted, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const _LocalizedText('Fermer'),
          ),
        ],
      ),
    );
  }

  Future<void> _showAdminReport(Map<String, dynamic> report) async {
    final propertyId = report['propertyId'];
    final property = _adminProperties.firstWhere(
      (item) => item['id'] == propertyId,
      orElse: () => <String, dynamic>{},
    );
    final propertyExists = property.isNotEmpty;
    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: 560,
            maxHeight: MediaQuery.sizeOf(context).height * 0.8,
          ),
          child: SizedBox(
            width: 520,
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _LocalizedText(
                    report['propertyTitle'] as String? ??
                        'Annonce supprimée ($propertyId)',
                    style: const TextStyle(
                      color: ink,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Flexible(
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (propertyExists &&
                              (property['imageUrl'] as String? ?? '')
                                  .isNotEmpty)
                            ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: Image.network(
                                resolvePhotoUrl(property['imageUrl'] as String),
                                height: 170,
                                width: 360,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) =>
                                    const SizedBox.shrink(),
                              ),
                            ),
                          if (propertyExists) ...[
                            const SizedBox(height: 10),
                            _LocalizedText(
                              '${property['city'] ?? ''} · ${_formatPrice(property)}',
                              style: const TextStyle(
                                color: teal,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
                            _LocalizedText(
                              _t(property['status'] as String? ?? ''),
                              style: const TextStyle(
                                color: muted,
                                fontSize: 12,
                              ),
                            ),
                            _LocalizedText(
                              property['description'] as String? ?? '',
                            ),
                            const SizedBox(height: 8),
                            _LocalizedText(
                              '${property['ownerName'] ?? ''}',
                              style: const TextStyle(
                                color: muted,
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceAround,
                              children: [
                                _stat(
                                  '${property['surface'] ?? 0} m²',
                                  'Surface',
                                ),
                                _stat(
                                  '${property['bedrooms'] ?? 0}',
                                  'Chambres',
                                ),
                              ],
                            ),
                          ] else
                            const _LocalizedText(
                              'Cette annonce a déjà été supprimée. Les informations du signalement restent disponibles ci-dessous.',
                              style: TextStyle(color: muted),
                            ),
                          const Divider(height: 24),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const _LocalizedText(
                                'Signalement de',
                                style: TextStyle(
                                  color: ink,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 4),
                              _LocalizedText(
                                '${report['reporterName'] ?? ''} (${report['reporterEmail'] ?? ''})',
                                style: const TextStyle(
                                  color: ink,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          _LocalizedText(report['reason'] as String? ?? ''),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const _LocalizedText('Fermer'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _privacyItem(String title, String body) => Card(
    color: Colors.white,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _LocalizedText(
            title,
            style: const TextStyle(color: ink, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 5),
          _LocalizedText(body, style: const TextStyle(color: muted)),
        ],
      ),
    ),
  );

  Future<void> _openSupportEmail() async {
    final gmailUri = Uri.parse(
      'googlegmail://co?to=chihieya59%40gmail.com&subject=Domus%20support',
    );
    if (await launchUrl(gmailUri, mode: LaunchMode.externalApplication)) return;
    final mailUri = Uri(
      scheme: 'mailto',
      path: 'chihieya59@gmail.com',
      queryParameters: {'subject': 'Domus support'},
    );
    if (!await launchUrl(mailUri, mode: LaunchMode.externalApplication) &&
        mounted) {
      _showNotice('Aucune application de messagerie n’est disponible.');
    }
  }

  Widget _subPage(String title, List<Widget> children) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() => _section = 'main'),
            icon: const Icon(Icons.arrow_back, size: 18),
            label: const _LocalizedText('Mon profil'),
          ),
        ),
        _LocalizedText(
          title,
          style: const TextStyle(
            color: ink,
            fontSize: 27,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 12),
        ...children,
      ],
    );
  }

  Widget _authCard() {
    if (_authFlow == 'verify') {
      return Card(
        color: Colors.white,
        margin: const EdgeInsets.only(top: 16, bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(17),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _LocalizedText(
                'Vérifier votre adresse e-mail',
                style: TextStyle(
                  color: ink,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              const _LocalizedText(
                'Saisissez le code de vérification à 6 chiffres reçu par e-mail.',
                style: TextStyle(color: muted, fontSize: 12),
              ),
              _textField(
                'Code de vérification',
                _authToken,
                hint: 'Code à 6 chiffres',
                keyboard: TextInputType.number,
                maxLength: 6,
                digitsOnly: true,
              ),
              const SizedBox(height: 12),
              _primaryButton(
                _busy ? 'Veuillez patienter…' : 'Vérifier mon adresse',
                _busy ? null : _verifyEmail,
              ),
              Center(
                child: TextButton(
                  onPressed: _busy ? null : _resendVerificationEmail,
                  child: const _LocalizedText(
                    'Renvoyer le courriel de vérification',
                  ),
                ),
              ),
              Center(
                child: TextButton(
                  onPressed: () => setState(() => _authFlow = 'login'),
                  child: const _LocalizedText('Retour à la connexion'),
                ),
              ),
            ],
          ),
        ),
      );
    }
    return Card(
      color: Colors.white,
      margin: const EdgeInsets.only(top: 16, bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(17),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: teal,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  alignment: Alignment.center,
                  child: const Text(
                    'D',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 11),
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _LocalizedText(
                      'DOMUS',
                      style: TextStyle(
                        color: ink,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.4,
                      ),
                    ),
                    _LocalizedText(
                      'VOTRE PROCHAIN CHEZ-VOUS',
                      style: TextStyle(
                        color: teal,
                        fontSize: 8,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.1,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 20),
            _LocalizedText(
              _registerMode ? 'Créer un compte' : 'Ravi de vous revoir',
              style: const TextStyle(
                color: ink,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 5),
            const _LocalizedText(
              'Connectez-vous pour garder vos favoris et contacter les propriétaires.',
              style: TextStyle(color: muted, fontSize: 12),
            ),
            if (_registerMode)
              _textField('Nom complet', _authName, hint: 'Votre nom'),
            _textField(
              'Adresse e-mail',
              _authEmail,
              hint: 'vous@exemple.tn',
              keyboard: TextInputType.emailAddress,
            ),
            _textField(
              'Mot de passe',
              _authPassword,
              hint: '8 caractères minimum',
              obscure: true,
            ),
            if (_registerMode)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _acceptedTerms,
                activeColor: teal,
                onChanged: (value) =>
                    setState(() => _acceptedTerms = value ?? false),
                title: const _LocalizedText(
                  'J’accepte les conditions d’utilisation et la politique de confidentialité.',
                  style: TextStyle(color: muted, fontSize: 12),
                ),
                controlAffinity: ListTileControlAffinity.leading,
              ),
            const SizedBox(height: 13),
            _primaryButton(
              _busy
                  ? 'Veuillez patienter…'
                  : (_registerMode ? 'Créer mon compte' : 'Se connecter'),
              _busy || (_registerMode && !_acceptedTerms) ? null : _signIn,
            ),
            Center(
              child: TextButton(
                onPressed: () => setState(() {
                  _registerMode = !_registerMode;
                  _authFlow = _registerMode ? 'register' : 'login';
                  _acceptedTerms = false;
                }),
                child: _LocalizedText(
                  _registerMode
                      ? 'Déjà un compte ? Se connecter'
                      : 'Nouveau sur Domus ? Créer un compte',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _propertyCard(Map<String, dynamic> property) {
    final image = resolvePhotoUrl(property['imageUrl'] as String? ?? '');
    final favorite = property['favorite'] == true;
    return Card(
      color: Colors.white,
      clipBehavior: Clip.antiAlias,
      margin: const EdgeInsets.only(top: 12, bottom: 5),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: border),
      ),
      child: InkWell(
        onTap: () => _showProperty(property),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Stack(
              children: [
                SizedBox(
                  height: 205,
                  width: double.infinity,
                  child: image.isEmpty
                      ? _photoFallback()
                      : Image.network(
                          image,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => _photoFallback(),
                        ),
                ),
                Positioned(
                  left: 13,
                  top: 13,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: _LocalizedText(
                      property['transaction'] == 'Location'
                          ? 'À LOUER'
                          : 'À VENDRE',
                      style: const TextStyle(
                        color: teal,
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.7,
                      ),
                    ),
                  ),
                ),
                Positioned(
                  right: 12,
                  top: 12,
                  child: CircleAvatar(
                    backgroundColor: Colors.white,
                    child: IconButton(
                      padding: EdgeInsets.zero,
                      onPressed: () => _toggleFavorite(property),
                      icon: Icon(
                        favorite ? Icons.favorite : Icons.favorite_border,
                        color: favorite ? danger : ink,
                        size: 20,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(15),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _LocalizedText(
                    _formatPrice(property),
                    style: const TextStyle(
                      color: teal,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  _LocalizedText(
                    property['title'] as String? ?? '',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: ink,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  _LocalizedText(
                    '${property['neighborhood'] ?? ''}${(property['neighborhood'] as String? ?? '').isNotEmpty ? ', ' : ''}${property['city'] ?? ''}',
                    style: const TextStyle(color: muted, fontSize: 12),
                  ),
                  const SizedBox(height: 10),
                  _LocalizedText(
                    '${property['surface'] ?? 0} m²   ·   ${property['bedrooms'] ?? 0} ${_t('ch.')}   ·   ${_t(property['type'] as String? ?? '')}',
                    style: const TextStyle(
                      color: ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _photoFallback() => Container(
    color: mint,
    alignment: Alignment.center,
    child: const _LocalizedText(
      'DOMUS',
      style: TextStyle(
        color: teal,
        fontWeight: FontWeight.w800,
        letterSpacing: 4,
        fontSize: 24,
      ),
    ),
  );

  Future<void> _reportProperty(Map<String, dynamic> property) async {
    final session = _token;
    if (_user?['role'] == 'admin') return;
    if (session == null) {
      Navigator.pop(context);
      _showNotice('Connectez-vous pour signaler cette annonce.');
      return;
    }
    if (_user?['id'] == property['ownerId']) {
      _showNotice('Vous ne pouvez pas signaler votre propre annonce.');
      return;
    }
    final reason = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const _LocalizedText('Signaler cette annonce'),
        content: TextField(
          controller: reason,
          minLines: 2,
          maxLines: 5,
          maxLength: 1000,
          decoration: InputDecoration(
            labelText: _t('Motif du signalement'),
            hintText: _t('Décrivez le problème (5 caractères minimum)'),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const _LocalizedText('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const _LocalizedText('Envoyer'),
          ),
        ],
      ),
    );
    final reportReason = reason.text.trim();
    reason.dispose();
    if (submitted != true) return;
    if (reportReason.length < 5) {
      _showNotice('Le motif doit contenir au moins 5 caractères.');
      return;
    }
    try {
      await _request(
        '/properties/${property['id']}/reports',
        method: 'POST',
        session: session,
        body: {'reason': reportReason},
      );
      if (mounted) {
        _showNotice('Votre signalement a été envoyé à l’administration.');
      }
    } catch (error) {
      if (mounted) {
        _showNotice(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  void _showProperty(Map<String, dynamic> property) {
    final photos = _propertyPhotos(property);
    _galleryIndex = 0;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.9,
        maxChildSize: 0.96,
        builder: (context, scrollController) => ListView(
          controller: scrollController,
          padding: const EdgeInsets.only(bottom: 25),
          children: [
            Stack(
              children: [
                SizedBox(
                  height: 290,
                  child: PageView.builder(
                    itemCount: photos.isEmpty ? 1 : photos.length,
                    onPageChanged: (index) =>
                        setState(() => _galleryIndex = index),
                    itemBuilder: (context, index) {
                      if (photos.isEmpty) return _photoFallback();
                      return SizedBox(
                        width: double.infinity,
                        child: Image.network(
                          photos[index],
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => _photoFallback(),
                        ),
                      );
                    },
                  ),
                ),
                if (photos.length > 1)
                  Positioned(
                    bottom: 12,
                    right: 14,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: teal,
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: _LocalizedText(
                        '${_galleryIndex + 1} / ${photos.length}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                Positioned(
                  top: 12,
                  left: 12,
                  child: CircleAvatar(
                    backgroundColor: Colors.white,
                    child: IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.arrow_back, color: ink),
                    ),
                  ),
                ),
                Positioned(
                  top: 12,
                  right: 12,
                  child: CircleAvatar(
                    backgroundColor: Colors.white,
                    child: IconButton(
                      onPressed: () => _toggleFavorite(property),
                      icon: Icon(
                        property['favorite'] == true
                            ? Icons.favorite
                            : Icons.favorite_border,
                        color: property['favorite'] == true ? danger : ink,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _LocalizedText(
                        property['transaction'] == 'Location'
                            ? 'À LOUER'
                            : 'À VENDRE',
                        style: const TextStyle(
                          color: teal,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1,
                          fontSize: 10,
                        ),
                      ),
                      const _LocalizedText(
                        ' · ',
                        style: TextStyle(color: teal, fontSize: 10),
                      ),
                      _LocalizedText(
                        (property['type'] as String? ?? '').toUpperCase(),
                        style: const TextStyle(
                          color: teal,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 7),
                  _LocalizedText(
                    _formatPrice(property),
                    style: const TextStyle(
                      color: teal,
                      fontSize: 23,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  _LocalizedText(
                    property['title'] as String? ?? '',
                    style: const TextStyle(
                      color: ink,
                      fontSize: 21,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 5),
                  _LocalizedText(
                    '⌖  ${property['neighborhood'] ?? ''}${(property['neighborhood'] as String? ?? '').isNotEmpty ? ', ' : ''}${property['city'] ?? ''}',
                    style: const TextStyle(color: muted),
                  ),
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(15),
                    decoration: BoxDecoration(
                      color: background,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _stat('${property['surface'] ?? 0} m²', 'Surface'),
                        _stat('${property['bedrooms'] ?? 0}', 'Chambres'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  const _LocalizedText(
                    'À propos de ce bien',
                    style: TextStyle(
                      color: ink,
                      fontWeight: FontWeight.w700,
                      fontSize: 17,
                    ),
                  ),
                  const SizedBox(height: 6),
                  _LocalizedText(
                    property['description'] as String? ?? '',
                    style: const TextStyle(color: muted, height: 1.5),
                  ),
                  if ((property['features'] as List? ?? []).isNotEmpty) ...[
                    const SizedBox(height: 18),
                    const _LocalizedText(
                      'Équipements',
                      style: TextStyle(
                        color: ink,
                        fontWeight: FontWeight.w700,
                        fontSize: 17,
                      ),
                    ),
                    Wrap(
                      spacing: 7,
                      children: (property['features'] as List)
                          .map(
                            (item) => Chip(
                              label: _LocalizedText(item.toString()),
                              backgroundColor: mint,
                              side: BorderSide.none,
                            ),
                          )
                          .toList(),
                    ),
                  ],
                  const SizedBox(height: 18),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      backgroundColor: mint,
                      foregroundColor: teal,
                      child: _LocalizedText(
                        (property['ownerName'] as String? ?? 'P')
                            .characters
                            .first,
                      ),
                    ),
                    title: _LocalizedText(
                      property['ownerName'] as String? ?? 'Propriétaire',
                      style: const TextStyle(
                        color: ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  _primaryButton(
                    'Envoyer un message',
                    () => _openConversation(property),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () => _callOwner(property),
                    icon: const Icon(Icons.call_outlined),
                    label: const _LocalizedText('Appeler'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: teal,
                      minimumSize: const Size.fromHeight(48),
                      side: const BorderSide(color: teal),
                    ),
                  ),
                  if (_user?['role'] != 'admin') ...[
                    if (_user?['role'] != 'admin') ...[
                      const SizedBox(height: 8),
                      TextButton.icon(
                        onPressed: () => _reportProperty(property),
                        icon: const Icon(Icons.flag_outlined),
                        label: const _LocalizedText('Signaler cette annonce'),
                        style: TextButton.styleFrom(foregroundColor: danger),
                      ),
                    ],
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<String> _propertyPhotos(Map<String, dynamic> property) {
    final listed = (property['photos'] as List? ?? [])
        .map((photo) => resolvePhotoUrl(photo.toString()))
        .where((photo) => photo.isNotEmpty)
        .toList();
    if (listed.isNotEmpty) return listed;
    final image = resolvePhotoUrl(property['imageUrl'] as String? ?? '');
    return image.isEmpty ? [] : [image];
  }

  Future<void> _callOwner(Map<String, dynamic> property) async {
    final phone = property['ownerPhone'] as String? ?? '';
    if (phone.isEmpty) {
      Navigator.pop(context);
      _showNotice('Numéro de téléphone non renseigné.');
      return;
    }
    final launched = await launchUrl(Uri(scheme: 'tel', path: phone));
    if (!launched) {
      await Clipboard.setData(ClipboardData(text: phone));
    }
    if (!launched && mounted) {
      Navigator.pop(context);
      _showNotice('${_t('Numéro copié :')} $phone');
    }
  }

  Widget _stat(String value, String label) => Column(
    children: [
      _LocalizedText(
        value,
        style: const TextStyle(color: ink, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 3),
      _LocalizedText(label, style: const TextStyle(color: muted, fontSize: 11)),
    ],
  );

  String _formatPrice(Map<String, dynamic> property) {
    final price = property['price'] as num? ?? 0;
    final formatted = price
        .toStringAsFixed(0)
        .replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (match) => ' ');
    return '$formatted ${_t('DT')}${property['transaction'] == 'Location' ? _t(' / mois') : ''}';
  }

  Widget _choiceChips(
    List<String> labels,
    String selected,
    ValueChanged<String> onSelected,
  ) {
    return Wrap(
      spacing: 8,
      runSpacing: 7,
      children: labels.map((label) {
        final active = selected == label;
        return ChoiceChip(
          label: _LocalizedText(_t(label)),
          selected: active,
          onSelected: (_) => onSelected(label),
          showCheckmark: false,
          backgroundColor: Colors.white,
          selectedColor: teal,
          side: BorderSide(color: active ? teal : border),
          labelStyle: TextStyle(
            color: active ? Colors.white : ink,
            fontWeight: FontWeight.w600,
            fontSize: 12,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        );
      }).toList(),
    );
  }

  Widget _textField(
    String label,
    TextEditingController controller, {
    String? hint,
    TextInputType? keyboard,
    int maxLines = 1,
    int? maxLength,
    bool digitsOnly = false,
    bool obscure = false,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        inputFormatters: digitsOnly
            ? [FilteringTextInputFormatter.digitsOnly]
            : null,
        maxLength: maxLength,
        maxLines: obscure ? 1 : maxLines,
        obscureText: obscure,
        decoration: InputDecoration(
          labelText: _t(label),
          hintText: hint == null ? null : _t(hint),
          counterText: maxLength == null ? null : '',
        ),
      ),
    );
  }

  Widget _primaryButton(String label, VoidCallback? onPressed) {
    return SizedBox(
      width: double.infinity,
      height: 49,
      child: FilledButton(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: teal,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        child: _LocalizedText(
          label,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
    );
  }

  Widget _secondaryButton(String label, VoidCallback onPressed) {
    return SizedBox(
      width: double.infinity,
      height: 47,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: teal,
          side: const BorderSide(color: teal),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        child: _LocalizedText(
          label,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
    );
  }

  Widget _emptyState(String title, String body) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(22),
    margin: const EdgeInsets.only(top: 18),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: border),
    ),
    child: Column(
      children: [
        const Icon(Icons.home_work_outlined, color: teal, size: 28),
        const SizedBox(height: 9),
        _LocalizedText(
          title,
          style: const TextStyle(color: ink, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 5),
        _LocalizedText(
          body,
          textAlign: TextAlign.center,
          style: const TextStyle(color: muted, fontSize: 12),
        ),
      ],
    ),
  );

  Widget _menuRow(String label, VoidCallback onTap) => ListTile(
    title: _LocalizedText(
      label,
      style: const TextStyle(
        color: ink,
        fontWeight: FontWeight.w600,
        fontSize: 14,
      ),
    ),
    trailing: const Icon(Icons.chevron_right, color: muted),
    onTap: onTap,
  );

  void _showFilters() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _PropertyFilterSheet(
        city: _city,
        minPrice: _minPrice,
        maxPrice: _maxPrice,
        type: _type,
        onApply: (city, minPrice, maxPrice, type) {
          setState(() {
            _city = city;
            _minPrice = minPrice;
            _maxPrice = maxPrice;
            _type = type;
          });
          Navigator.pop(context);
          _loadProperties();
        },
        onClear: () {
          setState(() {
            _city = '';
            _minPrice = '';
            _maxPrice = '';
            _type = 'Tous';
          });
          Navigator.pop(context);
          _loadProperties();
        },
      ),
    );
  }
}

class _PropertyFilterSheet extends StatefulWidget {
  const _PropertyFilterSheet({
    required this.city,
    required this.minPrice,
    required this.maxPrice,
    required this.type,
    required this.onApply,
    required this.onClear,
  });

  final String city;
  final String minPrice;
  final String maxPrice;
  final String type;
  final void Function(
    String city,
    String minPrice,
    String maxPrice,
    String type,
  )
  onApply;
  final VoidCallback onClear;

  @override
  State<_PropertyFilterSheet> createState() => _PropertyFilterSheetState();
}

class _PropertyFilterSheetState extends State<_PropertyFilterSheet> {
  late final TextEditingController _cityController;
  late final TextEditingController _minController;
  late final TextEditingController _maxController;
  late String _type;

  @override
  void initState() {
    super.initState();
    _cityController = TextEditingController(text: widget.city);
    _minController = TextEditingController(text: widget.minPrice);
    _maxController = TextEditingController(text: widget.maxPrice);
    _type = widget.type;
  }

  @override
  void dispose() {
    _cityController.dispose();
    _minController.dispose();
    _maxController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          18,
          20,
          MediaQuery.viewInsetsOf(context).bottom + 24,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: border,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 17),
              const _LocalizedText(
                'Filtres de recherche',
                style: TextStyle(
                  color: ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const _LocalizedText(
                'Affinez les biens qui vous correspondent.',
                style: TextStyle(color: muted),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _cityController,
                decoration: const InputDecoration(
                  labelText: 'Ville ou quartier',
                  hintText: 'Ex. La Marsa',
                ),
              ),
              const SizedBox(height: 12),
              const _LocalizedText(
                'Type de bien',
                style: TextStyle(color: ink, fontWeight: FontWeight.w700),
              ),
              Wrap(
                spacing: 8,
                runSpacing: 7,
                children: ['Tous', 'Appartement', 'Villa', 'Terrain', 'Studio']
                    .map((label) {
                      final active = _type == label;
                      return ChoiceChip(
                        label: _LocalizedText(label),
                        selected: active,
                        onSelected: (_) => setState(() => _type = label),
                        showCheckmark: false,
                        backgroundColor: Colors.white,
                        selectedColor: teal,
                        side: BorderSide(color: active ? teal : border),
                        labelStyle: TextStyle(
                          color: active ? Colors.white : ink,
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                      );
                    })
                    .toList(),
              ),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _minController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Prix minimum',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _maxController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Prix maximum',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                height: 49,
                child: FilledButton(
                  onPressed: () => widget.onApply(
                    _cityController.text,
                    _minController.text,
                    _maxController.text,
                    _type,
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: teal,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const _LocalizedText(
                    'Afficher les résultats',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              Center(
                child: TextButton(
                  onPressed: widget.onClear,
                  child: const _LocalizedText('Effacer les filtres'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class DomusApiException implements Exception {
  const DomusApiException(this.statusCode, this.message, [this.code]);

  final int statusCode;
  final String message;
  final String? code;

  @override
  String toString() => message;
}
