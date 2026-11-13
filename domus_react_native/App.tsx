import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  useWindowDimensions,
  View,
} from 'react-native';
import { api, apiBaseUrl, AdminReport, AdminUser, ApiError, Conversation, Message, NotificationItem, Property, User } from './src/api';
import { translate, type AppLanguage } from './src/i18n';
import { colors } from './src/theme';

const LanguageContext = createContext<AppLanguage>('fr');

function Text({ children, ...props }: TextProps) {
  const language = useContext(LanguageContext);
  const localizedChildren = React.Children.map(children, (child) =>
    typeof child === 'string' ? translate(language, child) : child,
  );
  return <NativeText {...props}>{localizedChildren}</NativeText>;
}

function TextInput(props: TextInputProps) {
  const language = useContext(LanguageContext);
  return (
    <NativeTextInput
      {...props}
      placeholder={
        props.placeholder
          ? translate(language, props.placeholder)
          : props.placeholder
      }
    />
  );
}

type Tab = 'Accueil' | 'Carte' | 'Publier' | 'Messages' | 'Profil';
type Section = 'main' | 'favorites' | 'listings' | 'notifications' | 'settings' | 'privacy';
const tabs: { label: Tab; icon: string }[] = [
  { label: 'Accueil', icon: '⌂' },
  { label: 'Carte', icon: '⌖' },
  { label: 'Publier', icon: '+' },
  { label: 'Messages', icon: '▤' },
  { label: 'Profil', icon: '○' },
];
const propertyTypes = ['Tous', 'Appartement', 'Villa', 'Terrain', 'Studio'];
const openFreeMapStyle = 'https://tiles.openfreemap.org/styles/liberty';
const cityCoordinates: Record<string, { latitude: number; longitude: number }> = {
  tunis: { latitude: 36.8065, longitude: 10.1815 },
  ariana: { latitude: 36.8625, longitude: 10.1956 },
  'ben arous': { latitude: 36.7531, longitude: 10.2189 },
  manouba: { latitude: 36.808, longitude: 10.0972 },
  'la marsa': { latitude: 36.8782, longitude: 10.3247 },
  sousse: { latitude: 35.8256, longitude: 10.6084 },
  sfax: { latitude: 34.7406, longitude: 10.7603 },
  hammamet: { latitude: 36.4, longitude: 10.6167 },
  monastir: { latitude: 35.7643, longitude: 10.8113 },
  bizerte: { latitude: 37.2744, longitude: 9.8739 },
  nabeul: { latitude: 36.4513, longitude: 10.7357 },
  kairouan: { latitude: 35.6781, longitude: 10.0963 },
  gabes: { latitude: 33.8815, longitude: 10.0982 },
  mahdia: { latitude: 35.5047, longitude: 11.0622 },
  tozeur: { latitude: 33.9197, longitude: 8.1335 },
  tataouine: { latitude: 32.9297, longitude: 10.4518 },
  djerba: { latitude: 33.8076, longitude: 10.8451 },
  'houmt souk': { latitude: 33.875, longitude: 10.857 },
  medenine: { latitude: 33.3549, longitude: 10.5055 },
  beja: { latitude: 36.7256, longitude: 9.1817 },
  jendouba: { latitude: 36.5011, longitude: 8.7802 },
  siliana: { latitude: 36.08497, longitude: 9.37082 },
  zaghouan: { latitude: 36.4029, longitude: 10.1429 },
  kef: { latitude: 36.1742, longitude: 8.7049 },
  kasserine: { latitude: 35.1676, longitude: 8.8365 },
  sidi: { latitude: 35.0382, longitude: 9.4849 },
  gafsa: { latitude: 34.425, longitude: 8.7842 },
  carthage: { latitude: 36.8528, longitude: 10.3233 },
};
function mapCityKey(city: string): string {
  const normalized = city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return ({ 'sidi bouzid': 'sidi', 'el kef': 'kef', 'ile de djerba': 'djerba' } as Record<string, string>)[normalized] ?? normalized;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Accueil');
  const [language, setLanguage] = useState<AppLanguage>('fr');
  const [isInitializing, setIsInitializing] = useState(true);
  const t = useCallback((value: string) => translate(language, value), [language]);
  const formatLocalizedPrice = useCallback(
    (price: number, transaction: Property['transaction']) =>
      `${new Intl.NumberFormat(language === 'ar' ? 'ar-TN' : 'fr-TN').format(price)} ${t('DT')}${transaction === 'Location' ? t(' / mois') : ''}`,
    [language, t],
  );
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const cameraRef = useRef<CameraRef | null>(null);
  const skipFirstPropertyReload = useRef(true);
  const { width: screenWidth } = useWindowDimensions();
  const [section, setSection] = useState<Section>('main');
  const [properties, setProperties] = useState<Property[]>([]);
  const [myProperties, setMyProperties] = useState<Property[]>([]);
  const [favorites, setFavorites] = useState<Property[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [transaction, setTransaction] = useState<'Vente' | 'Location' | 'Tous'>('Tous');
  const [type, setType] = useState('Tous');
  const [minimumPrice, setMinimumPrice] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'verify'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [postTitle, setPostTitle] = useState('');
  const [editingPropertyId, setEditingPropertyId] = useState<number | null>(null);
  const [postDescription, setPostDescription] = useState('');
  const [postPrice, setPostPrice] = useState('');
  const [postCity, setPostCity] = useState('');
  const [postLocation, setPostLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [postSurface, setPostSurface] = useState('');
  const [postBedrooms, setPostBedrooms] = useState('2');
  const [postImageUrl, setPostImageUrl] = useState('');
  const [postPhotoUrls, setPostPhotoUrls] = useState<string[]>([]);
  const [postTransaction, setPostTransaction] = useState<'Vente' | 'Location'>('Vente');
  const [postType, setPostType] = useState('Appartement');
  const [messageDraft, setMessageDraft] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [localNotificationsEnabled, setLocalNotificationsEnabled] = useState(false);
  const [localNotificationsBusy, setLocalNotificationsBusy] = useState(false);
  const localNotificationsEnabledRef = useRef(false);
  localNotificationsEnabledRef.current = localNotificationsEnabled;
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminProperties, setAdminProperties] = useState<Property[]>([]);
  const [adminReports, setAdminReports] = useState<AdminReport[]>([]);
  const [adminPropertyDetail, setAdminPropertyDetail] = useState<Property | null>(null);
  const [adminReportDetail, setAdminReportDetail] = useState<AdminReport | null>(null);
  const knownNotificationIds = useRef(new Set<number>());
  const hasLoadedNotifications = useRef(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
  const [reportProperty, setReportProperty] = useState<Property | null>(null);
  const [reportReason, setReportReason] = useState('');

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 3500);
  }, []);

  const loadProperties = useCallback(async (sessionToken = token) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (city.trim()) params.set('city', city.trim());
    if (transaction !== 'Tous') params.set('transaction', transaction);
    if (type !== 'Tous') params.set('type', type);
    if (minimumPrice) params.set('minPrice', minimumPrice);
    if (maximumPrice) params.set('maxPrice', maximumPrice);
    const result = await api<{ items: Property[] }>(`/properties?${params.toString()}`, { token: sessionToken });
    setProperties(result.items);
  }, [city, maximumPrice, minimumPrice, query, token, transaction, type]);
  const loadPropertiesRef = useRef(loadProperties);
  loadPropertiesRef.current = loadProperties;

  const loadUserData = useCallback(async (sessionToken: string) => {
    const [favoriteResult, listingResult, conversationResult, notificationResult] = await Promise.all([
      api<{ items: Property[] }>('/favorites', { token: sessionToken }),
      api<{ items: Property[] }>('/my/properties', { token: sessionToken }),
      api<{ items: Conversation[] }>('/conversations', { token: sessionToken }),
      api<{ items: NotificationItem[] }>('/notifications', { token: sessionToken }),
    ]);
    setFavorites(favoriteResult.items);
    setMyProperties(listingResult.items);
    setConversations(conversationResult.items);
    setNotifications(notificationResult.items);
    const newItems = notificationResult.items.filter(
      (item) => !knownNotificationIds.current.has(item.id),
    );
    if (hasLoadedNotifications.current) {
      for (const item of newItems) {
        if (!item.read) await showLocalNotification(item.title, item.body);
      }
    }
    for (const item of notificationResult.items) {
      knownNotificationIds.current.add(item.id);
    }
    hasLoadedNotifications.current = true;
  }, []);

  useEffect(() => {
    let active = true;
    async function initializeApp() {
      let sessionToken: string | null = null;
      try {
        const secureStoreAvailable = Platform.OS !== 'web' && await SecureStore.isAvailableAsync();
        if (secureStoreAvailable) {
          const [savedLanguage, savedToken, savedNotifications] = await Promise.all([
            SecureStore.getItemAsync('domus.language'),
            SecureStore.getItemAsync('domus.token'),
            SecureStore.getItemAsync('domus.localNotifications.enabled'),
          ]);
          if (active && savedNotifications === 'true') setLocalNotificationsEnabled(true);
          if (active && (savedLanguage === 'fr' || savedLanguage === 'en' || savedLanguage === 'ar')) {
            setLanguage(savedLanguage);
          }
          if (savedToken) {
            try {
              const account = await api<User>('/auth/me', { token: savedToken });
              if (!active) return;
              sessionToken = savedToken;
              setToken(savedToken);
              setUser(account);
              setProfileName(account.name);
              setProfilePhone(account.phone);
              if (account.role === 'admin') {
                setTab('Profil');
                setAdminToken(savedToken);
                await loadAdminData(savedToken);
              } else {
                await loadUserData(savedToken);
              }
            } catch (error) {
              if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
                await SecureStore.deleteItemAsync('domus.token');
                if (active && error.status === 403) showNotice(error.message);
              } else if (active) {
                showNotice('Impossible de restaurer la session. Vérifiez la connexion au serveur.');
              }
            }
          }
        }
        await loadPropertiesRef.current(sessionToken);
      } catch (error) {
        if (active) showNotice((error as Error).message);
      } finally {
        if (active) setIsInitializing(false);
      }
    }
    void initializeApp();
    return () => { active = false; };
  }, [loadUserData, showNotice]);

  async function changeLanguage(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage);
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.setItemAsync('domus.language', nextLanguage);
    }
  }

  async function openSupportEmail() {
    const gmailUrl = 'googlegmail://co?to=chihieya59%40gmail.com';
    try {
      if (Platform.OS !== 'web' && await Linking.canOpenURL(gmailUrl)) {
        await Linking.openURL(gmailUrl);
        return;
      }
      await Linking.openURL('mailto:chihieya59@gmail.com');
    } catch (error) {
      showNotice(`${t('Impossible d’ouvrir votre application de messagerie.')} ${error instanceof Error ? error.message : ''}`.trim());
    }
  }

  async function findMyLocation() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        showNotice(t('Autorisez l’accès à votre position pour voir les annonces proches.'));
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setCurrentLocation(nextLocation);
      cameraRef.current?.easeTo({
        center: [nextLocation.longitude, nextLocation.latitude],
        zoom: 12,
        duration: 500,
      });
      showNotice(t('Votre position est affichée. Les distances utilisent les emplacements exacts des annonces.'));
    } catch (error) {
      showNotice(`${t('Impossible d’obtenir votre position')} ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      setLocating(false);
    }
  }

  function distanceToProperty(property: Property) {
    if (!currentLocation) return 0;
    if (property.latitude === null || property.longitude === null) return Number.POSITIVE_INFINITY;
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const latitudeDelta = radians(property.latitude - currentLocation.latitude);
    const longitudeDelta = radians(property.longitude - currentLocation.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(radians(currentLocation.latitude)) * Math.cos(radians(property.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  useEffect(() => {
    if (isInitializing) return;
    if (skipFirstPropertyReload.current) {
      skipFirstPropertyReload.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setBusy(true);
      loadProperties()
        .catch((error: Error) => showNotice(error.message))
        .finally(() => setBusy(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [isInitializing, loadProperties, showNotice]);

  useEffect(() => {
    if (!token || tab !== 'Messages' || !selectedConversation) return;
    const timer = setInterval(() => {
      api<{ items: Message[] }>(`/conversations/${selectedConversation.id}/messages`, { token })
        .then((result) => setMessages(result.items))
        .catch((error: Error) => showNotice(error.message));
    }, 5000);
    return () => clearInterval(timer);
  }, [selectedConversation, showNotice, tab, token]);

  const listingCount = useMemo(() => properties.length, [properties]);

  async function setLocalNotifications(enabled: boolean) {
    setLocalNotificationsBusy(true);
    try {
      if (enabled && Platform.OS === 'web') {
        showNotice('Les notifications locales sont disponibles sur Android et iOS.');
        return;
      }
      if (enabled && Platform.OS !== 'web') {
        const Notifications = await import('expo-notifications');
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Domus',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }
        let permission = await Notifications.getPermissionsAsync();
        if (permission.status !== 'granted') {
          permission = await Notifications.requestPermissionsAsync();
        }
        if (permission.status !== 'granted') {
          showNotice('Autorisez les notifications dans les réglages de votre appareil.');
          return;
        }
      }
      setLocalNotificationsEnabled(enabled);
      localNotificationsEnabledRef.current = enabled;
      if (Platform.OS !== 'web' && await SecureStore.isAvailableAsync()) {
        await SecureStore.setItemAsync('domus.localNotifications.enabled', String(enabled));
      }
      if (enabled) {
        showNotice('Notifications locales activées sur cet appareil.');
      }
    } catch (error) {
      showNotice((error as Error).message);
    } finally {
      setLocalNotificationsBusy(false);
    }
  }

  async function showLocalNotification(title: string, body: string) {
    if (!localNotificationsEnabledRef.current || Platform.OS === 'web') return;
    const Notifications = await import('expo-notifications');
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  }

  async function signIn() {
    setBusy(true);
    try {
      const path = authMode === 'login' ? '/auth/login' : '/auth/register';
      const body = authMode === 'login'
        ? { email: authEmail, password: authPassword }
        : { name: authName, email: authEmail, password: authPassword, acceptedTerms };
      const result = await api<{ token?: string; user?: User }>(path, { method: 'POST', body });
      if (authMode === 'register' && (!result.token || !result.user)) {
        setAuthPassword('');
        setAuthMode('verify');
        showNotice('Si cette adresse peut être vérifiée, un courriel de confirmation a été envoyé. Consultez votre boîte de réception.');
        return;
      }
      if (!result.token || !result.user) throw new Error('Connexion impossible pour le moment.');
      setToken(result.token);
      setUser(result.user);
      setProfileName(result.user.name);
      setProfilePhone(result.user.phone);
      if (Platform.OS !== 'web' && await SecureStore.isAvailableAsync()) {
        await SecureStore.setItemAsync('domus.token', result.token);
      }
      if (result.user.role === 'admin') {
        setAdminToken(result.token);
        setTab('Profil');
        setSection('main');
        await loadAdminData(result.token);
      } else {
        await loadUserData(result.token);
      }
      setAuthPassword('');
      showNotice(authMode === 'login' ? 'Bienvenue chez vous !' : 'Votre compte est prêt.');
    } catch (error) {
      showNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail() {
    if (!authToken.trim()) {
      showNotice('Saisissez le code de vérification reçu par courriel.');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/verify-email', { method: 'POST', body: { token: authToken.trim() } });
      setAuthToken('');
      setAuthMode('login');
      showNotice('Adresse e-mail vérifiée. Vous pouvez maintenant vous connecter.');
    } catch {
      showNotice('Ce code de vérification est invalide ou expiré. Vérifiez-le.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (Platform.OS !== 'web' && await SecureStore.isAvailableAsync()) {
      await SecureStore.deleteItemAsync('domus.token');
    }
    setToken(null);
    setUser(null);
    setAdminToken(null);
    setAdminUsers([]);
    setAdminProperties([]);
    setAdminReports([]);
    setFavorites([]);
    setMyProperties([]);
    setConversations([]);
    setSection('main');
    showNotice('Vous êtes déconnecté(e).');
  }

  async function deleteAccount() {
    if (!token) return;
    setBusy(true);
    try {
      await api('/account', { method: 'DELETE', token });
      if (Platform.OS !== 'web' && await SecureStore.isAvailableAsync()) {
        await SecureStore.deleteItemAsync('domus.token');
      }
      setToken(null);
      setUser(null);
      setFavorites([]);
      setMyProperties([]);
      setConversations([]);
      setNotifications([]);
      setDeleteAccountVisible(false);
      setSection('main');
      setTab('Accueil');
      await loadProperties();
      showNotice('Votre compte et vos données ont été supprimés.');
    } catch (error) {
      showNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(property: Property) {
    if (!token) {
      setTab('Profil');
      showNotice('Connectez-vous pour enregistrer vos favoris.');
      return;
    }
    try {
      await api(`/favorites/${property.id}`, { method: property.favorite ? 'DELETE' : 'PUT', token });
      await Promise.all([loadProperties(), loadUserData(token)]);
      setSelectedProperty((current) => current?.id === property.id ? { ...current, favorite: !current.favorite } : current);
    } catch (error) {
      showNotice((error as Error).message);
    }
  }

  async function publishProperty() {
    if (!token) {
      setTab('Profil');
      showNotice('Connectez-vous pour publier une annonce.');
      return;
    }
    if (!postLocation) {
      showNotice(t('Sélectionnez l’emplacement exact du bien sur la carte.'));
      return;
    }
    setBusy(true);
    try {
      const property = await api<Property>(editingPropertyId ? `/my/properties/${editingPropertyId}` : '/properties', {
        method: editingPropertyId ? 'PUT' : 'POST',
        token,
        body: {
          title: postTitle,
          description: postDescription,
          price: Number(postPrice),
          city: postCity,
          latitude: postLocation.latitude,
          longitude: postLocation.longitude,
          surface: Number(postSurface),
          bedrooms: Number(postBedrooms),
          transaction: postTransaction,
          type: postType,
          imageUrl: postPhotoUrls[0] ?? postImageUrl,
          photos: postPhotoUrls.length ? postPhotoUrls : postImageUrl ? [postImageUrl] : [],
        },
      });
      setPostTitle('');
      setEditingPropertyId(null);
      setPostDescription('');
      setPostPrice('');
      setPostCity('');
      setPostLocation(null);
      setPostSurface('');
      setPostImageUrl('');
      setPostPhotoUrls([]);
      setTab('Accueil');
      setSelectedProperty(property);
      await Promise.all([loadProperties(), loadUserData(token)]);
      showNotice('Votre annonce est en ligne.');
    } catch (error) {
      showNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changePropertyStatus(property: Property) {
    if (!token) return;
    const status = property.status === 'paused' ? 'online' : 'paused';
    try {
      await api(`/my/properties/${property.id}/status`, { method: 'PATCH', token, body: { status } });
      await loadUserData(token);
      await loadProperties();
      showNotice(status === 'online' ? 'Annonce remise en ligne.' : 'Annonce mise en pause.');
    } catch (error) {
      showNotice((error as Error).message);
    }
  }

  const loadAdminData = useCallback(async (sessionToken = adminToken) => {
    if (!sessionToken) return;
    try {
      const [users, propertiesResult, reports] = await Promise.all([
        api<{ items: AdminUser[] }>('/admin/users', { token: sessionToken }),
        api<{ items: Property[] }>('/admin/properties', { token: sessionToken }),
        api<{ items: AdminReport[] }>('/admin/reports', { token: sessionToken }),
      ]);
      setAdminUsers(users.items);
      setAdminProperties(propertiesResult.items);
      setAdminReports(reports.items);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setAdminToken(null);
      }
      throw error;
    }
  }, [adminToken]);

  useEffect(() => {
    let syncing = false;
    const syncFromServer = async () => {
      if (syncing || isInitializing) return;
      syncing = true;
      try {
        await Promise.all([
          loadProperties(),
          token && user?.role === 'admin'
            ? loadAdminData(token)
            : token ? loadUserData(token) : Promise.resolve(),
        ]);
      } catch (error) {
        showNotice((error as Error).message);
      } finally {
        syncing = false;
      }
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncFromServer();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void syncFromServer();
    }, 15000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [isInitializing, loadAdminData, loadProperties, loadUserData, showNotice, token, user?.role]);

  function confirmAction(
    title: string,
    message: string,
    action: () => Promise<void>,
  ) {
    setPendingConfirmation({ title, message, action });
  }

  async function runPendingConfirmation() {
    const pending = pendingConfirmation;
    setPendingConfirmation(null);
    if (!pending) return;
    try {
      await pending.action();
    } catch (error) {
      showNotice((error as Error).message);
    }
  }

  async function deleteOwnProperty(property: Property) {
    if (!token) return;
    await api(`/my/properties/${property.id}`, { method: 'DELETE', token });
    await Promise.all([loadUserData(token), loadProperties()]);
    showNotice('Annonce supprimée.');
  }

  async function banAdminUser(userItem: AdminUser) {
    if (!adminToken) return;
    await api(`/admin/users/${userItem.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    await loadAdminData();
    showNotice('Compte banni définitivement.');
  }

  async function deleteAdminProperty(property: Property) {
    if (!adminToken) return;
    await api(`/admin/properties/${property.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    await loadAdminData();
    await loadProperties();
    showNotice('Annonce supprimée.');
  }

  async function reviewAdminReport(report: AdminReport, status: 'resolved' | 'rejected') {
    if (!adminToken) return;
    await api(`/admin/reports/${report.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { status },
    });
    await loadAdminData();
  }

  function startListingReport(property: Property) {
    if (!token) {
      showNotice('Connectez-vous pour signaler cette annonce.');
      return;
    }
    if (user?.role === 'admin') return;
    if (user?.id === property.ownerId) {
      showNotice('Vous ne pouvez pas signaler votre propre annonce.');
      return;
    }
    setReportReason('');
    setSelectedProperty(null);
    setReportProperty(property);
  }

  async function submitListingReport() {
    const property = reportProperty;
    if (!property || !token) return;
    const reason = reportReason.trim();
    if (reason.length < 5) {
      showNotice('Le motif doit contenir au moins 5 caractères.');
      return;
    }
    try {
      await api(`/properties/${property.id}/reports`, {
        method: 'POST',
        token,
        body: { reason },
      });
      setReportProperty(null);
      showNotice('Votre signalement a été envoyé à l’administration.');
    } catch (error) {
      showNotice((error as Error).message);
    }
  }

  function editProperty(property: Property) {
    setEditingPropertyId(property.id);
    setPostTitle(property.title);
    setPostDescription(property.description);
    setPostPrice(String(property.price));
    setPostCity(property.city);
    setPostLocation(
      property.latitude === null || property.longitude === null
        ? null
        : { latitude: property.latitude, longitude: property.longitude },
    );
    setPostSurface(String(property.surface));
    setPostBedrooms(String(property.bedrooms));
    setPostType(property.type);
    setPostImageUrl(property.imageUrl);
    setPostPhotoUrls(property.photos ?? []);
    setPostTransaction(property.transaction);
    setTab('Publier');
    setSection('main');
  }

  function removePropertyPhoto(index: number) {
    setPostPhotoUrls((current) => {
      const next = current.filter((_, position) => position !== index);
      setPostImageUrl(next[0] ?? '');
      return next;
    });
  }

  async function pickPropertyPhotos() {
    if (!token) {
      setTab('Profil');
      showNotice('Connectez-vous pour ajouter les photos de votre bien.');
      return;
    }
    const remaining = 10 - postPhotoUrls.length;
    if (remaining <= 0) {
      showNotice('Vous pouvez ajouter jusqu’à 10 photos.');
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showNotice('Autorisez l’accès à vos photos pour ajouter des images à votre annonce.');
        return;
      }
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.72,
        base64: true,
      });
      if (selection.canceled) return;
      setBusy(true);
      const uploaded = await Promise.all(selection.assets.map(async (asset) => {
        if (!asset.base64) throw new Error('Impossible de lire la photo sélectionnée.');
        const result = await api<{ url: string }>('/uploads', {
          method: 'POST',
          token,
          body: { mimeType: 'image/jpeg', base64: asset.base64 },
        });
        return `${apiBaseUrl}${result.url}`;
      }));
      setPostPhotoUrls((current) => [...current, ...uploaded].slice(0, 10));
      setPostImageUrl((current) => current || uploaded[0] || '');
      showNotice(`${uploaded.length} photo${uploaded.length > 1 ? 's' : ''} ajoutée${uploaded.length > 1 ? 's' : ''}.`);
    } catch (error) {
      showNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openConversation(property: Property) {
    if (!token) {
      setTab('Profil');
      showNotice('Connectez-vous pour contacter le propriétaire.');
      return;
    }
    try {
      const conversation = await api<{ id: number }>('/conversations', {
        method: 'POST',
        token,
        body: { propertyId: property.id },
      });
      const entry: Conversation = {
        id: conversation.id,
        propertyId: property.id,
        propertyTitle: property.title,
        contactName: property.ownerName,
        lastMessage: null,
      };
      setSelectedConversation(entry);
      await loadConversationMessages(conversation.id);
      setSelectedProperty(null);
      setTab('Messages');
    } catch (error) {
      showNotice((error as Error).message);
    }
  }

  async function loadConversationMessages(id: number) {
    if (!token) return;
    try {
      const result = await api<{ items: Message[] }>(`/conversations/${id}/messages`, { token });
      setMessages(result.items);
      await loadUserData(token);
    } catch (error) {
      showNotice((error as Error).message);
    }
  }

  async function sendMessage() {
    if (!token || !selectedConversation || !messageDraft.trim()) return;
    const body = messageDraft.trim();
    try {
      await api(`/conversations/${selectedConversation.id}/messages`, {
        method: 'POST',
        token,
        body: { body },
      });
      setMessageDraft('');
      await loadConversationMessages(selectedConversation.id);
    } catch (error) {
      showNotice((error as Error).message);
    }
  }

  async function saveProfile() {
    if (!token) return;
    try {
      const updated = await api<User>('/profile', {
        method: 'PATCH',
        token,
        body: { name: profileName, phone: profilePhone },
      });
      setUser(updated);
      await Promise.all([loadProperties(), loadUserData(token)]);
      showNotice('Profil mis à jour.');
    } catch (error) {
      showNotice((error as Error).message);
    }
  }

  function navigate(next: Tab) {
    setTab(next);
    setSection('main');
    setSelectedConversation(null);
  }

  function renderAuth() {
    if (authMode === 'verify') {
      return (
        <View style={styles.authCard}>
          <Text style={styles.cardTitle}>Vérifier votre adresse e-mail</Text>
          <Text style={styles.muted}>Saisissez le code de vérification reçu par e-mail.</Text>
          <Input label="Code de vérification" value={authToken} onChangeText={setAuthToken} placeholder="Code reçu par e-mail" autoCapitalize="none" />
          <Button label="Vérifier mon adresse" onPress={() => void verifyEmail()} disabled={busy} />
          <Pressable onPress={() => setAuthMode('login')}><Text style={styles.linkText}>Retour à la connexion</Text></Pressable>
        </View>
      );
    }
    return (
      <View style={styles.authCard}>
        <View style={styles.authBrand}>
          <View style={styles.authBrandMark}><Text style={styles.authBrandLetter}>D</Text></View>
          <View>
            <Text style={styles.authBrandName}>DOMUS</Text>
            <Text style={styles.authBrandCaption}>VOTRE PROCHAIN CHEZ-VOUS</Text>
          </View>
        </View>
        <Text style={styles.cardTitle}>{authMode === 'login' ? 'Ravi de vous revoir' : 'Créer un compte'}</Text>
        <Text style={styles.muted}>Connectez-vous pour garder vos favoris et contacter les propriétaires.</Text>
        {authMode === 'register' && (
          <Input label="Nom complet" value={authName} onChangeText={setAuthName} placeholder="Votre nom" />
        )}
        <Input label="Adresse e-mail" value={authEmail} onChangeText={setAuthEmail} placeholder="vous@exemple.tn" keyboardType="email-address" autoCapitalize="none" />
        <Input label="Mot de passe" value={authPassword} onChangeText={setAuthPassword} placeholder="8 caractères minimum" secureTextEntry />
        {authMode === 'register' ? (
          <Pressable style={styles.termsRow} onPress={() => setAcceptedTerms((checked) => !checked)}>
            <View style={[styles.termsCheckbox, acceptedTerms && styles.termsCheckboxChecked]}><Text style={styles.termsCheckmark}>{acceptedTerms ? '✓' : ''}</Text></View>
            <Text style={styles.termsText}>J’accepte les conditions d’utilisation et la politique de confidentialité.</Text>
          </Pressable>
        ) : null}
        <Button
          label={authMode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          onPress={() => void signIn()}
          disabled={busy || (authMode === 'register' && !acceptedTerms)}
        />
        <Pressable onPress={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
          <Text style={styles.linkText}>{authMode === 'login' ? 'Nouveau sur Domus ? Créer un compte' : 'Déjà un compte ? Se connecter'}</Text>
        </Pressable>
      </View>
    );
  }

  function renderPropertyCard(property: Property, compact = false) {
    return (
      <Pressable key={property.id} style={[styles.propertyCard, compact && styles.compactCard]} onPress={() => setSelectedProperty(property)}>
        <View style={styles.photoWrap}>
          {property.imageUrl ? <Image source={{ uri: property.imageUrl }} style={styles.propertyPhoto} /> : <View style={styles.photoFallback}><Text style={styles.fallbackText}>DOMUS</Text></View>}
          <View style={styles.saleBadge}><Text style={styles.badgeText}>{property.transaction === 'Vente' ? 'À VENDRE' : 'À LOUER'}</Text></View>
          <Pressable style={styles.heartButton} onPress={(event) => { event.stopPropagation(); void toggleFavorite(property); }}>
            <Text style={[styles.heart, property.favorite && styles.heartActive]}>{property.favorite ? '♥' : '♡'}</Text>
          </Pressable>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.price}>{formatLocalizedPrice(property.price, property.transaction)}</Text>
          <Text style={styles.propertyTitle} numberOfLines={1}>{property.title}</Text>
          <Text style={styles.muted}>{property.neighborhood ? `${property.neighborhood}, ` : ''}{property.city}</Text>
          <View style={styles.propertyMeta}>
            <Text style={styles.metaItem}>{property.surface} m²</Text>
            <Text style={styles.metaDivider}>·</Text>
            <Text style={styles.metaItem}>{property.bedrooms} {t('ch.')}</Text>
            <Text style={styles.metaDivider}>·</Text>
            <Text style={styles.metaItem}>{property.type}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  function renderHome() {
    return (
      <>
        <View style={styles.hero}>
          <View style={styles.topRow}>
            <View><Text style={styles.brand}>domus<Text style={styles.brandDot}>.</Text></Text><Text style={styles.eyebrow}>{t('VOTRE PROCHAIN CHEZ-VOUS')}</Text></View>
            <Pressable style={styles.avatarButton} onPress={() => navigate('Profil')}><Text style={styles.avatarText}>{user?.name?.slice(0, 1).toUpperCase() ?? '⌕'}</Text></Pressable>
          </View>
          <Text style={styles.heroTitle}>{t('Trouvez le bien')}{'\n'}{t('qui vous ressemble.')}</Text>
          <Text style={styles.heroSubtitle}>{t('Des lieux de vie, partout en Tunisie.')}</Text>
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput value={query} onChangeText={setQuery} placeholder={t('Ville, quartier, type de bien...')} placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" />
            <Pressable style={styles.filterButton} onPress={() => setFiltersVisible(true)}><Text style={styles.filterIcon}>☷</Text></Pressable>
          </View>
        </View>
        <View style={styles.pageContent}>
          <View style={styles.segmentRow}>
            {(['Tous', 'Vente', 'Location'] as const).map((value) => <Chip key={value} label={value} selected={transaction === value} onPress={() => setTransaction(value)} />)}
          </View>
          <View style={styles.sectionHeading}>
            <View><Text style={styles.sectionTitle}>{t('Explorer les biens')}</Text><Text style={styles.muted}>{listingCount} {t('annonces à découvrir')}</Text></View>
            <Pressable onPress={() => navigate('Carte')}><Text style={styles.linkText}>{t('Voir la carte')}  ›</Text></Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
            {propertyTypes.map((value) => <Chip key={value} label={value} selected={type === value} onPress={() => setType(value)} />)}
          </ScrollView>
          {busy && properties.length === 0 ? <ActivityIndicator color={colors.teal} style={styles.loader} /> : null}
          {properties.length ? properties.map((property) => renderPropertyCard(property)) : (
            <EmptyState title={t('Aucun bien pour le moment')} body={t('Essayez d’élargir votre recherche ou de modifier vos filtres.')} />
          )}
        </View>
      </>
    );
  }

  function renderMap() {
    const mappedProperties = properties.filter(
      (property) => property.latitude !== null && property.longitude !== null,
    );
    const nearbyProperties = [...properties].sort(
      (a, b) => distanceToProperty(a) - distanceToProperty(b),
    );
    return (
      <View style={styles.pageContent}>
        <Text style={styles.sectionTitle}>{t('Les biens autour de vous')}</Text>
        <Text style={styles.muted}>{t('Les annonces affichées ont un emplacement choisi par leur propriétaire.')}</Text>
        <Button
          label={locating ? t('Localisation…') : t('Me localiser')}
          onPress={() => void findMyLocation()}
          secondary
          disabled={locating}
        />
        {Platform.OS !== 'web' ? (
          <View style={styles.mapSurface}>
            <Map
              style={styles.mapView}
              mapStyle={openFreeMapStyle}
              attribution
            >
              <Camera
                ref={cameraRef}
                initialViewState={{
                  center: currentLocation
                    ? [currentLocation.longitude, currentLocation.latitude]
                    : [9.5, 34],
                  zoom: currentLocation ? 12 : 6,
                }}
              />
              {currentLocation ? (
                <Marker
                  id="current-location"
                  lngLat={[currentLocation.longitude, currentLocation.latitude]}
                >
                  <View style={styles.userMapMarker}>
                    <View style={styles.userMapDot} />
                  </View>
                </Marker>
              ) : null}
              {mappedProperties.map((property) => (
                <Marker
                  key={`property-${property.id}`}
                  id={`property-${property.id}`}
                  lngLat={[property.longitude!, property.latitude!]}
                  onPress={() => setSelectedProperty(property)}
                >
                  <View style={styles.propertyMapMarker}>
                    <Text style={styles.propertyMapMarkerText}>⌂</Text>
                  </View>
                </Marker>
              ))}
            </Map>
          </View>
        ) : (
          <View style={styles.mapSetupNotice}>
            <Text style={styles.mapSetupTitle}>{t('Carte mobile')}</Text>
            <Text style={styles.muted}>{t('La carte OpenFreeMap est disponible dans les applications mobiles.')}</Text>
          </View>
        )}
        {Platform.OS !== 'web' && mappedProperties.length === 0 ? (
          <Text style={styles.muted}>{t('Aucune annonce avec un emplacement exact pour le moment.')}</Text>
        ) : null}
        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{t('Annonces à proximité')}</Text><Text style={styles.muted}>{properties.length} {t('biens')}</Text></View>
        {nearbyProperties.slice(0, 4).map((property) => (
          <View key={property.id}>
            {currentLocation ? <Text style={styles.muted}>{formatDistance(distanceToProperty(property))}</Text> : null}
            {renderPropertyCard(property, true)}
          </View>
        ))}
      </View>
    );
  }

  function renderPropertyLocationPicker() {
    const initialCenter = cityCoordinates[mapCityKey(postCity)] ?? {
      latitude: 34,
      longitude: 9.5,
    };
    return (
      <View style={styles.locationPicker}>
        <Text style={styles.inputLabel}>{t('Emplacement exact du bien')}</Text>
        {Platform.OS !== 'web' ? (
          <View style={[styles.mapSurface, styles.locationPickerMap]}>
            <Map
              style={styles.mapView}
              mapStyle={openFreeMapStyle}
              attribution
              onPress={({ nativeEvent }) => {
                const [longitude, latitude] = nativeEvent.lngLat;
                setPostLocation({ latitude, longitude });
              }}
            >
              <Camera
                initialViewState={{
                  center: postLocation
                    ? [postLocation.longitude, postLocation.latitude]
                    : [initialCenter.longitude, initialCenter.latitude],
                  zoom: postLocation ? 15 : 12,
                }}
              />
              {postLocation ? (
                <Marker
                  id="listing-location"
                  lngLat={[postLocation.longitude, postLocation.latitude]}
                >
                  <View style={styles.propertyMapMarker}>
                    <Text style={styles.propertyMapMarkerText}>⌂</Text>
                  </View>
                </Marker>
              ) : null}
            </Map>
          </View>
        ) : (
          <Text style={styles.muted}>{t('La sélection de l’emplacement est disponible dans les applications mobiles.')}</Text>
        )}
        <Text style={styles.muted}>
          {postLocation
            ? `${postLocation.latitude.toFixed(5)}, ${postLocation.longitude.toFixed(5)}`
            : t('Touchez la carte à l’emplacement du bien.')}
        </Text>
      </View>
    );
  }

  function renderPublish() {
    return (
      <View style={styles.pageContent}>
        <Text style={styles.eyebrow}>ESPACE PROPRIÉTAIRE</Text>
        <Text style={styles.screenTitle}>Publier une annonce</Text>
        <Text style={styles.muted}>Présentez votre bien en quelques étapes.</Text>
        {!token ? renderAuth() : (
          <View style={styles.formCard}>
            <Text style={styles.formSectionTitle}>1. Votre bien</Text>
            <View style={styles.segmentRow}>
              <Chip label="À vendre" selected={postTransaction === 'Vente'} onPress={() => setPostTransaction('Vente')} />
              <Chip label="À louer" selected={postTransaction === 'Location'} onPress={() => setPostTransaction('Location')} />
            </View>
            <Input label="Type de bien" value={postType} onChangeText={setPostType} placeholder="Appartement, villa..." />
            <Input label="Titre de l'annonce" value={postTitle} onChangeText={setPostTitle} placeholder="Ex. Appartement lumineux avec terrasse" />
            <Input label="Description" value={postDescription} onChangeText={setPostDescription} placeholder="Décrivez votre bien..." multiline />
            <Input label="Prix (DT)" value={postPrice} onChangeText={setPostPrice} placeholder="385000" keyboardType="numeric" />
            <Input label="Ville" value={postCity} onChangeText={setPostCity} placeholder="Tunis, La Marsa..." />
            {renderPropertyLocationPicker()}
            <View style={styles.formRow}>
              <View style={styles.formHalf}><Input label="Surface (m²)" value={postSurface} onChangeText={setPostSurface} placeholder="85" keyboardType="numeric" /></View>
              <View style={styles.formHalf}><Input label="Chambres" value={postBedrooms} onChangeText={setPostBedrooms} placeholder="2" keyboardType="numeric" /></View>
            </View>
            <Text style={styles.inputLabel}>Photos ({postPhotoUrls.length}/10)</Text>
            <View style={styles.photoPickerRow}>
              {postPhotoUrls.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.uploadedPhotoWrap}>
                  <Image source={{ uri }} style={styles.uploadedPhoto} />
                  <Pressable style={styles.removePhoto} onPress={() => removePropertyPhoto(index)}><Text style={styles.removePhotoText}>×</Text></Pressable>
                </View>
              ))}
              {postPhotoUrls.length < 10 ? <Pressable style={styles.addPhoto} onPress={() => void pickPropertyPhotos()}><Text style={styles.addPhotoText}>＋</Text><Text style={styles.addPhotoLabel}>Ajouter</Text></Pressable> : null}
            </View>
            <Input label="Photo (URL, facultatif)" value={postImageUrl} onChangeText={setPostImageUrl} placeholder="https://..." autoCapitalize="none" keyboardType="url" />
            <Button label={editingPropertyId ? 'Enregistrer les modifications' : 'Publier mon annonce'} onPress={() => void publishProperty()} disabled={busy} />
          </View>
        )}
      </View>
    );
  }

  function renderMessages() {
    if (!token) return <View style={styles.pageContent}><Text style={styles.screenTitle}>Messages</Text>{renderAuth()}</View>;
    if (selectedConversation) {
      return (
        <View style={styles.pageContent}>
          <Pressable onPress={() => { setSelectedConversation(null); setMessages([]); }}><Text style={styles.linkText}>‹ Toutes les conversations</Text></Pressable>
          <Text style={styles.sectionTitle}>{selectedConversation.contactName}</Text>
          <Text style={styles.muted}>{selectedConversation.propertyTitle}</Text>
          <View style={styles.chatPanel}>
            <ScrollView contentContainerStyle={styles.chatList}>
              {messages.length === 0 ? <Text style={styles.muted}>Démarrez la conversation en posant une question sur ce bien.</Text> : messages.map((message) => (
                <View key={message.id} style={[styles.messageBubble, message.senderId === user?.id ? styles.ownMessage : styles.otherMessage]}>
                  <Text style={message.senderId === user?.id ? styles.ownMessageText : styles.otherMessageText}>{message.body}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.messageEntry}>
              <TextInput style={styles.messageInput} value={messageDraft} onChangeText={setMessageDraft} placeholder="Écrire un message..." />
              <Pressable style={styles.sendButton} onPress={() => void sendMessage()}><Text style={styles.sendButtonText}>↑</Text></Pressable>
            </View>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.pageContent}>
        <Text style={styles.eyebrow}>VOTRE ESPACE</Text><Text style={styles.screenTitle}>Messages</Text>
        {conversations.length === 0 ? <EmptyState title="Aucune conversation" body="Contactez un propriétaire depuis une annonce pour démarrer." /> : conversations.map((item) => (
          <Pressable key={item.id} style={styles.conversationCard} onPress={() => { setSelectedConversation(item); void loadConversationMessages(item.id); }}>
            <View style={styles.conversationAvatar}><Text style={styles.conversationAvatarText}>{item.contactName.slice(0, 1)}</Text></View>
            <View style={styles.conversationInfo}><Text style={styles.conversationName}>{item.contactName}</Text><Text style={styles.muted}>{item.propertyTitle}</Text><Text style={styles.conversationLast} numberOfLines={1}>{item.lastMessage ?? 'Démarrer la conversation'}</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  function renderAdmin() {
    if (user?.role !== 'admin' || !adminToken) {
      return <View style={styles.pageContent} />;
    }
    return (
      <View style={styles.pageContent}>
        <View style={styles.adminBanner}>
          <View style={styles.adminBannerIcon}><Text style={styles.adminBannerIconText}>✓</Text></View>
          <View style={styles.adminBannerCopy}>
            <Text style={styles.adminBannerTitle}>{t('Espace sécurisé')}</Text>
            <Text style={styles.muted}>{t('Gestion des comptes, annonces et signalements.')}</Text>
          </View>
        </View>
        <View style={styles.sectionHeading}>
          <Text style={styles.screenTitle}>Administration</Text>
          <Pressable onPress={() => void loadAdminData().catch((error: Error) => showNotice(error.message))}>
            <Text style={styles.linkText}>Actualiser</Text>
          </Pressable>
        </View>
        <Button label="Se déconnecter" onPress={() => void signOut()} secondary />
        <Text style={styles.sectionTitle}>{t('Comptes')} ({adminUsers.length})</Text>
        {adminUsers.map((adminUser) => (
          <View key={adminUser.id} style={styles.notificationCard}>
            <Text style={styles.notificationTitle}>{adminUser.name}</Text>
            <Text style={styles.muted}>{adminUser.email}</Text>
            {adminUser.bannedAt ? <Text style={styles.muted}>Banni</Text> : null}
            {!adminUser.bannedAt ? <Button
              label="Bannir définitivement"
              onPress={() => confirmAction(
                'Bannir définitivement ?',
                'Ce compte ne pourra plus se connecter et ses annonces seront retirées.',
                () => banAdminUser(adminUser),
              )}
              secondary
            /> : null}
          </View>
        ))}
        <Text style={styles.sectionTitle}>{t('Annonces')} ({adminProperties.length})</Text>
        {adminProperties.map((property) => (
          <View key={property.id} style={styles.notificationCard}>
            <Pressable onPress={() => setAdminPropertyDetail(property)}>
              <Text style={styles.notificationTitle}>{property.title}</Text>
              <Text style={styles.muted}>{property.city} · {formatLocalizedPrice(property.price, property.transaction)}</Text>
              <Text style={styles.muted}>{t(property.status)}</Text>
              <Text style={styles.linkText}>{t('Voir les détails')}</Text>
            </Pressable>
            <Button
              label="Supprimer"
              onPress={() => confirmAction(
                'Supprimer cette annonce ?',
                'Cette action est définitive.',
                () => deleteAdminProperty(property),
              )}
              secondary
            />
          </View>
        ))}
        <Text style={styles.sectionTitle}>{t('Signalements')} ({adminReports.length})</Text>
        {adminReports.length === 0 ? <Text style={styles.muted}>Aucun signalement.</Text> : null}
        {adminReports.map((report) => (
          <View key={report.id} style={styles.notificationCard}>
            <Pressable onPress={() => setAdminReportDetail(report)}>
              <Text style={styles.notificationTitle}>{report.propertyTitle ?? `Annonce supprimée (${report.propertyId})`}</Text>
              <Text style={styles.muted}>{report.reporterName} · {report.reporterEmail}</Text>
              <Text style={styles.description}>{report.reason}</Text>
              <Text style={styles.muted}>{t('Statut :')} {t(report.status)}</Text>
            </Pressable>
            <View style={styles.detailActions}>
              {report.status !== 'resolved' ? (
                <Button label="Résoudre" onPress={() => void reviewAdminReport(report, 'resolved').catch((error: Error) => showNotice(error.message))} secondary />
              ) : null}
              {report.status !== 'rejected' ? (
                <Button label="Rejeter" onPress={() => void reviewAdminReport(report, 'rejected').catch((error: Error) => showNotice(error.message))} secondary />
              ) : null}
            </View>
          </View>
        ))}
      </View>
    );
  }

  function renderProfile() {
    if (user?.role === 'admin') return renderAdmin();
    if (section === 'favorites') return <View style={styles.pageContent}><BackButton label="Mon profil" onPress={() => setSection('main')} /><Text style={styles.screenTitle}>Mes favoris</Text>{favorites.length ? favorites.map((property) => renderPropertyCard(property)) : <EmptyState title="Pas encore de favoris" body="Touchez le cœur d'une annonce pour la retrouver ici." />}</View>;
    if (section === 'listings') return (
      <View style={styles.pageContent}><BackButton label="Mon profil" onPress={() => setSection('main')} /><Text style={styles.screenTitle}>Mes annonces</Text>
        {myProperties.length ? myProperties.map((property) => (
          <View key={property.id}>
            {renderPropertyCard(property)}
            <View style={styles.detailActions}>
              <Button label="Modifier" onPress={() => editProperty(property)} secondary />
              <Button label={property.status === 'paused' ? 'Remettre en ligne' : 'Mettre en pause'} onPress={() => void changePropertyStatus(property)} secondary />
            </View>
            <Pressable onPress={() => confirmAction(
              'Supprimer mon annonce ?',
              'Cette action est définitive.',
              () => deleteOwnProperty(property),
            )}>
              <Text style={[styles.linkText, styles.centerText]}>Supprimer</Text>
            </Pressable>
          </View>
        )) : <EmptyState title="Aucune annonce publiée" body="Votre prochaine annonce n'attend que vous." />}
      </View>
    );
    if (section === 'settings') return (
      <View style={styles.pageContent}><BackButton label={t('Mon profil')} onPress={() => setSection('main')} /><Text style={styles.screenTitle}>{t('Paramètres')}</Text>
        <View style={styles.menuCard}>
          <View style={styles.settingRow}><View><Text style={styles.menuTitle}>{t('Notifications locales')}</Text><Text style={styles.muted}>{t('Alertes locales sur cet appareil uniquement')}</Text></View><Switch value={localNotificationsEnabled} onValueChange={(enabled) => void setLocalNotifications(enabled)} trackColor={{ true: colors.teal }} disabled={localNotificationsBusy} /></View>
          <Text style={styles.muted}>{t('Les alertes liées à une activité distante nécessitent Internet; les notifications locales ne requièrent pas Firebase.')}</Text>
          <View style={styles.settingRow}><View><Text style={styles.menuTitle}>{t('Notifications dans l’application')}</Text><Text style={styles.muted}>{t('Messages et annonces sauvegardées')}</Text></View><Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} trackColor={{ true: colors.teal }} /></View>
          <Text style={styles.menuTitle}>{t('Langue')}</Text>
          <View style={styles.featureRow}>
            {(['fr', 'en', 'ar'] as const).map((value) => <Chip key={value} label={value === 'fr' ? 'Français' : value === 'en' ? 'English' : 'العربية'} selected={language === value} onPress={() => { void changeLanguage(value).catch((error: Error) => showNotice(error.message)); }} />)}
          </View>
          <MenuRow label={t('Confidentialité')} value={language === 'en' ? 'Manage' : language === 'ar' ? 'إدارة' : 'Gérer'} onPress={() => setSection('privacy')} />
        </View>
      </View>
    );
    if (section === 'privacy') return (
      <View style={styles.pageContent}>
        <BackButton label={t('Paramètres')} onPress={() => setSection('settings')} />
        <Text style={styles.screenTitle}>{t('Confidentialité')}</Text>
        {[
          ['Données collectées', 'Le compte contient votre nom, adresse e-mail et téléphone facultatif. Les annonces peuvent contenir des photos, une ville et un emplacement précis.'],
          ['Utilisation', 'Ces données assurent la connexion, la recherche et la publication d’annonces, les favoris et les conversations.'],
          ['Visibilité et partage', 'Les annonces publiées sont visibles par les utilisateurs. Les données du compte et les échanges nécessaires sont traités par le serveur Domus; les cartes chargent les tuiles OpenFreeMap.'],
          ['Conservation et suppression', 'Les données sont conservées tant que le compte existe. La suppression du compte supprime le profil et les données associées conformément au service.'],
          ['Notifications locales', 'Les préférences et alertes locales restent sur cet appareil et ne sont pas envoyées à Firebase ni à un service push.'],
          ['Vos choix', 'Vous pouvez modifier votre profil, désactiver les notifications dans les réglages ou supprimer votre compte depuis le profil.'],
        ].map(([title, body]) => (
          <View key={title} style={styles.notificationCard}>
            <Text style={styles.notificationTitle}>{t(title)}</Text>
            <Text style={styles.description}>{t(body)}</Text>
          </View>
        ))}
      </View>
    );
    if (section === 'notifications') return (
      <View style={styles.pageContent}><BackButton label="Mon profil" onPress={() => setSection('main')} /><Text style={styles.screenTitle}>Notifications</Text>
        {notifications.length ? notifications.map((item) => (
          <View key={item.id} style={styles.notificationCard}><Text style={styles.notificationTitle}>{item.title}</Text><Text style={styles.muted}>{item.body}</Text></View>
        )) : <EmptyState title="Tout est à jour" body="Vous verrez ici les nouveaux messages et les nouvelles annonces." />}
      </View>
    );
    return (
      <View style={styles.pageContent}>
        <Text style={styles.eyebrow}>VOTRE ESPACE</Text><Text style={styles.screenTitle}>Mon profil</Text>
        {user ? (
          <>
            <View style={styles.profileCard}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{user.name.slice(0, 1).toUpperCase()}</Text></View><View><Text style={styles.profileName}>{user.name}</Text><Text style={styles.muted}>{user.email}</Text></View></View>
            <View style={styles.formCard}>
              <Text style={styles.formSectionTitle}>Modifier le profil</Text>
              <Input label="Nom complet" value={profileName} onChangeText={setProfileName} />
              <Input label="Téléphone" value={profilePhone} onChangeText={setProfilePhone} keyboardType="phone-pad" />
              <Button label="Enregistrer" onPress={() => void saveProfile()} secondary />
            </View>
            <View style={styles.menuCard}>
              <MenuRow label="Mes annonces" value="›" onPress={() => setSection('listings')} />
              <MenuRow label="Mes favoris" value="›" onPress={() => setSection('favorites')} />
              <MenuRow label="Notifications" value="›" onPress={() => setSection('notifications')} />
              <MenuRow label="Paramètres" value="›" onPress={() => setSection('settings')} />
              <MenuRow label="Centre d'aide" value="›" onPress={() => void openSupportEmail()} />
            </View>
            <Button label="Se déconnecter" onPress={() => void signOut()} secondary />
            <Button label="Supprimer mon compte" onPress={() => setDeleteAccountVisible(true)} secondary />
          </>
        ) : (
          <>
            <View style={styles.profileBanner}><Text style={styles.profileBannerTitle}>Bienvenue chez Domus</Text><Text style={styles.profileBannerText}>Un compte pour contacter les propriétaires et garder vos biens favoris.</Text></View>
            {renderAuth()}
            <View style={styles.menuCard}><MenuRow label="Mes favoris" value="›" onPress={() => { setSection('favorites'); }} /><MenuRow label="Paramètres" value="›" onPress={() => setSection('settings')} /></View>
          </>
        )}
      </View>
    );
  }

  function renderTabContent() {
    if (tab === 'Accueil') return renderHome();
    if (tab === 'Carte') return renderMap();
    if (tab === 'Publier') return renderPublish();
    if (tab === 'Messages') return renderMessages();
    return renderProfile();
  }

  return (
    <LanguageContext.Provider value={language}>
      <View style={[styles.app, { direction: language === 'ar' ? 'rtl' : 'ltr' }]}>
      <StatusBar style="dark" />
      {isInitializing ? <SplashScreen /> : <>
      {notice ? <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View> : null}
      <ScrollView style={styles.scroller} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {renderTabContent()}
      </ScrollView>
      <View style={styles.tabBar}>
        {tabs.map((item) => (
          <Pressable key={item.label} style={styles.tabItem} onPress={() => navigate(item.label)}>
            <View style={[styles.tabIconWrap, tab === item.label && styles.tabIconActive]}><Text style={[styles.tabIcon, tab === item.label && styles.tabIconSelected]}>{item.icon}</Text></View>
            <Text style={[styles.tabLabel, tab === item.label && styles.tabLabelSelected]}>{t(item.label)}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={Boolean(selectedProperty)} animationType="slide" onRequestClose={() => setSelectedProperty(null)}>
        {selectedProperty ? (
          <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView>
              <View style={styles.detailImageWrap}>
                    {selectedProperty.photos?.length ? (
                      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                        {selectedProperty.photos.map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} style={[styles.detailImage, { width: screenWidth }]} />)}
                      </ScrollView>
                    ) : selectedProperty.imageUrl ? <Image source={{ uri: selectedProperty.imageUrl }} style={styles.detailImage} /> : <View style={styles.photoFallback}><Text style={styles.fallbackText}>DOMUS</Text></View>}
                    <Pressable style={styles.closeButton} onPress={() => setSelectedProperty(null)}><Text style={styles.closeText}>‹</Text></Pressable>
                    <Pressable style={styles.detailHeart} onPress={() => void toggleFavorite(selectedProperty)}><Text style={[styles.heart, selectedProperty.favorite && styles.heartActive]}>{selectedProperty.favorite ? '♥' : '♡'}</Text></Pressable>
                    {selectedProperty.photos?.length > 1 ? <View style={styles.galleryCount}><Text style={styles.galleryCountText}>{selectedProperty.photos.length} photos</Text></View> : null}
              </View>
              <View style={styles.detailContent}>
                <Text style={styles.eyebrow}>{t(selectedProperty.transaction === 'Vente' ? 'À VENDRE' : 'À LOUER')} · {t(selectedProperty.type)}</Text>
                <Text style={styles.detailPrice}>{formatLocalizedPrice(selectedProperty.price, selectedProperty.transaction)}</Text>
                <Text style={styles.detailTitle}>{selectedProperty.title}</Text>
                <Text style={styles.muted}>⌖  {selectedProperty.neighborhood ? `${selectedProperty.neighborhood}, ` : ''}{selectedProperty.city}</Text>
                <View style={styles.statsRow}><Stat value={`${selectedProperty.surface} m²`} label={t('Surface')} /><Stat value={`${selectedProperty.bedrooms}`} label={t('Chambres')} /></View>
                <Text style={styles.sectionTitle}>À propos de ce bien</Text><Text style={styles.description}>{selectedProperty.description}</Text>
                {selectedProperty.features?.length ? <><Text style={styles.sectionTitle}>Équipements</Text><View style={styles.featureRow}>{selectedProperty.features.map((feature) => <Chip key={feature} label={feature} selected={false} />)}</View></> : null}
                <View style={styles.ownerCard}><View style={styles.conversationAvatar}><Text style={styles.conversationAvatarText}>{selectedProperty.ownerName.slice(0, 1)}</Text></View><View><Text style={styles.conversationName}>{selectedProperty.ownerName}</Text></View></View>
                <View style={styles.detailActions}><Button label="Envoyer un message" onPress={() => void openConversation(selectedProperty)} /><Button label="Appeler" secondary onPress={() => selectedProperty.ownerPhone ? void Linking.openURL(`tel:${selectedProperty.ownerPhone}`).catch(() => showNotice('Appel non disponible sur cet appareil.')) : showNotice('Numéro de téléphone non renseigné.')} /></View>
                {user?.role !== 'admin' ? (
                  <Button label="Signaler cette annonce" secondary onPress={() => startListingReport(selectedProperty)} />
                ) : null}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}
      </Modal>

      <Modal visible={filtersVisible} transparent animationType="slide" onRequestClose={() => setFiltersVisible(false)}>
        <View style={styles.sheetOverlay}><View style={styles.filterSheet}>
          <View style={styles.sheetHandle} /><Text style={styles.sectionTitle}>Filtres de recherche</Text><Text style={styles.muted}>Affinez les biens qui vous correspondent.</Text>
          <Input label="Ville ou quartier" value={city} onChangeText={setCity} placeholder="Ex. La Marsa" />
          <Text style={styles.inputLabel}>Type de bien</Text><View style={styles.featureRow}>{propertyTypes.map((value) => <Chip key={value} label={value} selected={type === value} onPress={() => setType(value)} />)}</View>
          <View style={styles.formRow}><View style={styles.formHalf}><Input label="Prix minimum" value={minimumPrice} onChangeText={setMinimumPrice} placeholder="0 DT" keyboardType="numeric" /></View><View style={styles.formHalf}><Input label="Prix maximum" value={maximumPrice} onChangeText={setMaximumPrice} placeholder="Tout prix" keyboardType="numeric" /></View></View>
          <Button label="Afficher les résultats" onPress={() => setFiltersVisible(false)} />
          <Pressable onPress={() => { setCity(''); setMinimumPrice(''); setMaximumPrice(''); setType('Tous'); }}><Text style={[styles.linkText, styles.centerText]}>Effacer les filtres</Text></Pressable>
        </View></View>
      </Modal>
      <Modal visible={deleteAccountVisible} transparent animationType="fade" onRequestClose={() => setDeleteAccountVisible(false)}>
        <View style={styles.sheetOverlay}><View style={styles.confirmCard}>
          <Text style={styles.sectionTitle}>Supprimer votre compte ?</Text>
          <Text style={styles.muted}>Cette action supprime votre profil, vos annonces, favoris et conversations. Elle est définitive.</Text>
          <Button label={busy ? 'Suppression…' : 'Supprimer définitivement'} onPress={() => void deleteAccount()} disabled={busy} />
          <Button label="Annuler" onPress={() => setDeleteAccountVisible(false)} secondary />
        </View></View>
      </Modal>
      <Modal visible={Boolean(reportProperty)} transparent animationType="fade" onRequestClose={() => setReportProperty(null)}>
        <View style={styles.sheetOverlay}><View style={styles.confirmCard}>
          <Text style={styles.sectionTitle}>Signaler cette annonce</Text>
          <Text style={styles.muted}>Décrivez le problème (5 caractères minimum)</Text>
          <TextInput
            value={reportReason}
            onChangeText={setReportReason}
            multiline
            maxLength={1000}
            textAlignVertical="top"
            style={styles.reportInput}
          />
          <Button label="Envoyer" onPress={() => void submitListingReport()} disabled={reportReason.trim().length < 5} />
          <Button label="Annuler" onPress={() => setReportProperty(null)} secondary />
        </View></View>
      </Modal>
      <Modal visible={Boolean(adminReportDetail)} animationType="slide" onRequestClose={() => setAdminReportDetail(null)}>
        {adminReportDetail ? (
          <ScrollView style={styles.modalRoot} contentContainerStyle={styles.detailContent}>
            <Button label="Fermer" onPress={() => setAdminReportDetail(null)} secondary />
            <Text style={styles.screenTitle}>
              {adminReportDetail.propertyTitle ?? `Annonce supprimée (${adminReportDetail.propertyId})`}
            </Text>
            {(() => {
              const property = adminProperties.find((item) => item.id === adminReportDetail.propertyId);
              return property ? (
                <>
                  {property.imageUrl ? <Image source={{ uri: property.imageUrl }} style={styles.detailImage} /> : null}
                  <Text style={styles.detailPrice}>{formatLocalizedPrice(property.price, property.transaction)}</Text>
                  <Text style={styles.muted}>{property.city} · {t(property.status)}</Text>
                  <Text style={styles.description}>{property.description}</Text>
                  <Text style={styles.muted}>{property.ownerName}</Text>
                  <View style={styles.statsRow}>
                    <Stat value={`${property.surface} m²`} label={t('Surface')} />
                    <Stat value={`${property.bedrooms}`} label={t('Chambres')} />
                  </View>
                </>
              ) : (
                <Text style={styles.muted}>Cette annonce a déjà été supprimée; les détails du signalement restent disponibles.</Text>
              );
            })()}
            <Text style={styles.sectionTitle}>Signalement</Text>
            <Text style={styles.muted}>{adminReportDetail.reporterName} · {adminReportDetail.reporterEmail}</Text>
            <Text style={styles.description}>{adminReportDetail.reason}</Text>
            <Text style={styles.muted}>{t('Statut :')} {t(adminReportDetail.status)}</Text>
          </ScrollView>
        ) : null}
      </Modal>
      <Modal visible={Boolean(adminPropertyDetail)} animationType="slide" onRequestClose={() => setAdminPropertyDetail(null)}>
        {adminPropertyDetail ? (
          <ScrollView style={styles.modalRoot} contentContainerStyle={styles.detailContent}>
            <Button label={t('Fermer')} onPress={() => setAdminPropertyDetail(null)} secondary />
            {adminPropertyDetail.photos?.length
              ? <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                  {adminPropertyDetail.photos.map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} style={[styles.detailImage, { width: screenWidth }]} />)}
                </ScrollView>
              : adminPropertyDetail.imageUrl
                ? <Image source={{ uri: adminPropertyDetail.imageUrl }} style={styles.detailImage} />
                : null}
            <Text style={styles.eyebrow}>{t(adminPropertyDetail.status)} · {t(adminPropertyDetail.type)}</Text>
            <Text style={styles.detailPrice}>{formatLocalizedPrice(adminPropertyDetail.price, adminPropertyDetail.transaction)}</Text>
            <Text style={styles.detailTitle}>{adminPropertyDetail.title}</Text>
            <Text style={styles.muted}>{adminPropertyDetail.neighborhood ? `${adminPropertyDetail.neighborhood}, ` : ''}{adminPropertyDetail.city}</Text>
            <View style={styles.statsRow}>
              <Stat value={`${adminPropertyDetail.surface} m²`} label={t('Surface')} />
              <Stat value={`${adminPropertyDetail.bedrooms}`} label={t('Chambres')} />
            </View>
            <Text style={styles.sectionTitle}>{t('Description')}</Text>
            <Text style={styles.description}>{adminPropertyDetail.description}</Text>
            {adminPropertyDetail.features.length ? (
              <>
                <Text style={styles.sectionTitle}>{t('Équipements')}</Text>
                <View style={styles.featureRow}>{adminPropertyDetail.features.map((feature) => <Chip key={feature} label={t(feature)} selected={false} />)}</View>
              </>
            ) : null}
            <Text style={styles.muted}>{adminPropertyDetail.ownerName}</Text>
            <Text style={styles.muted}>{t('Paru le')}: {new Date(adminPropertyDetail.createdAt).toLocaleDateString(language === 'ar' ? 'ar' : language === 'en' ? 'en' : 'fr')}</Text>
          </ScrollView>
        ) : null}
      </Modal>
      <Modal visible={Boolean(pendingConfirmation)} transparent animationType="fade" onRequestClose={() => setPendingConfirmation(null)}>
        {pendingConfirmation ? (
          <View style={styles.sheetOverlay}><View style={styles.confirmCard}>
            <Text style={styles.sectionTitle}>{pendingConfirmation.title}</Text>
            <Text style={styles.muted}>{pendingConfirmation.message}</Text>
            <Button label="Confirmer" onPress={() => void runPendingConfirmation()} />
            <Button label="Annuler" onPress={() => setPendingConfirmation(null)} secondary />
          </View></View>
        ) : null}
      </Modal>
      </>}
      </View>
    </LanguageContext.Provider>
  );
}

function SplashScreen() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 850,
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 850,
          useNativeDriver: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  return (
    <View style={styles.splash}>
      <Image source={require('./assets/icon.png')} style={styles.splashLogo} />
      <Text style={styles.splashWordmark}>domus<Text style={styles.brandDot}>.</Text></Text>
      <Text style={styles.splashTagline}>VOTRE PROCHAIN CHEZ-VOUS</Text>
      <View style={styles.splashProgressTrack}>
        <Animated.View
          style={[
            styles.splashProgress,
            {
              width: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ['16%', '88%'],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...inputProps } = props;
  return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{label}</Text><TextInput {...inputProps} style={[styles.input, inputProps.multiline && styles.multiline, style]} placeholderTextColor={colors.muted} /></View>;
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return 'Emplacement exact non renseigné';
  return `${meters < 1000 ? Math.round(meters) + ' m' : (meters / 1000).toFixed(1) + ' km'}`;
}

function Button({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.buttonDisabled]}><Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{label}</Text></Pressable>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <View style={styles.emptyState}><Text style={styles.emptyIcon}>⌂</Text><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.muted}>{body}</Text></View>;
}

function MenuRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={styles.menuRow}><Text style={styles.menuTitle}>{label}</Text><Text style={styles.menuValue}>{value}</Text></Pressable>;
}

function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable style={styles.backButton} onPress={onPress}><Text style={styles.linkText}>‹  {label}</Text></Pressable>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.muted}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.teal },
  splashLogo: { width: 88, height: 88, borderRadius: 24 },
  splashWordmark: { color: colors.white, fontSize: 36, fontWeight: '800', marginTop: 18 },
  splashTagline: { color: colors.white, opacity: 0.8, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginTop: 4 },
  splashProgressTrack: { width: 170, height: 5, borderRadius: 5, overflow: 'hidden', backgroundColor: '#62AAA5', marginTop: 32 },
  splashProgress: { height: '100%', borderRadius: 5, backgroundColor: colors.white },
  scroller: { flex: 1 },
  scrollContent: { paddingBottom: 28 },
  pageContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 },
  hero: { backgroundColor: colors.white, paddingTop: 54, paddingHorizontal: 22, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  brand: { color: colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: -1.5 },
  brandDot: { color: colors.teal },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: '700', letterSpacing: 1.6, marginBottom: 7 },
  avatarButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mint },
  avatarText: { color: colors.teal, fontWeight: '700', fontSize: 20 },
  heroTitle: { fontSize: 31, lineHeight: 37, color: colors.ink, fontWeight: '700', letterSpacing: -0.8 },
  heroSubtitle: { color: colors.muted, fontSize: 14, marginTop: 8, marginBottom: 22 },
  searchBox: { minHeight: 54, borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white },
  searchIcon: { fontSize: 24, color: colors.muted, marginHorizontal: 3 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14, paddingVertical: 11 },
  filterButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  filterIcon: { color: colors.teal, fontSize: 18 },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 18, marginBottom: 22 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, marginBottom: 14 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  screenTitle: { color: colors.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 7 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  linkText: { color: colors.teal, fontSize: 13, fontWeight: '700' },
  chipScroll: { gap: 8, paddingBottom: 18 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' },
  chipSelected: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: colors.white },
  propertyCard: { backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden', marginBottom: 16, borderColor: colors.border, borderWidth: 1 },
  compactCard: { marginTop: 12 },
  photoWrap: { height: 210, position: 'relative', backgroundColor: colors.mint },
  propertyPhoto: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoFallback: { flex: 1, minHeight: 160, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: colors.teal, fontSize: 24, fontWeight: '800', letterSpacing: 4 },
  saleBadge: { position: 'absolute', top: 14, left: 14, backgroundColor: colors.white, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: colors.teal, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  heartButton: { position: 'absolute', right: 12, top: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  heart: { color: colors.ink, fontSize: 23, lineHeight: 26 },
  heartActive: { color: colors.danger },
  cardBody: { padding: 16 },
  price: { color: colors.teal, fontSize: 19, fontWeight: '800', marginBottom: 5 },
  propertyTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  propertyMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  photoPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 8, marginBottom: 8 },
  uploadedPhotoWrap: { position: 'relative' },
  uploadedPhoto: { width: 76, height: 76, borderRadius: 12, backgroundColor: colors.mint },
  removePhoto: { position: 'absolute', top: -5, right: -5, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  removePhotoText: { color: colors.white, fontSize: 17, lineHeight: 20 },
  addPhoto: { width: 76, height: 76, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.teal, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  addPhotoText: { color: colors.teal, fontSize: 22, lineHeight: 24 },
  addPhotoLabel: { color: colors.teal, fontSize: 10, fontWeight: '700' },
  metaItem: { color: colors.text, fontSize: 12, fontWeight: '600' },
  metaDivider: { color: colors.muted, marginHorizontal: 8 },
  loader: { paddingVertical: 30 },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.white, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 22 : 10 },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabIconWrap: { height: 30, minWidth: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tabIconActive: { backgroundColor: colors.mint },
  tabIcon: { color: colors.muted, fontSize: 21, lineHeight: 24 },
  tabIconSelected: { color: colors.teal, fontWeight: '700' },
  tabLabel: { color: colors.muted, fontSize: 10, fontWeight: '500' },
  tabLabelSelected: { color: colors.teal, fontWeight: '700' },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  termsCheckbox: { width: 21, height: 21, borderRadius: 5, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  termsCheckboxChecked: { backgroundColor: colors.teal, borderColor: colors.teal },
  termsCheckmark: { color: colors.white, fontSize: 14, fontWeight: '700' },
  termsText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 18 },
  notice: { position: 'absolute', top: 38, zIndex: 5, alignSelf: 'center', backgroundColor: colors.ink, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11, maxWidth: '90%' },
  noticeText: { color: colors.white, fontSize: 13, textAlign: 'center' },
  authCard: { backgroundColor: colors.white, borderRadius: 20, padding: 20, borderColor: colors.border, borderWidth: 1, marginTop: 18, shadowColor: colors.ink, shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  authBrand: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 20 },
  authBrandMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center' },
  authBrandLetter: { color: colors.white, fontSize: 24, fontWeight: '800' },
  authBrandName: { color: colors.ink, fontSize: 13, fontWeight: '800', letterSpacing: 1.4 },
  authBrandCaption: { color: colors.teal, fontSize: 8, fontWeight: '700', letterSpacing: 1.1, marginTop: 3 },
  adminBanner: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.mint, padding: 17, borderRadius: 18, marginBottom: 18 },
  adminBannerIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  adminBannerIconText: { color: colors.teal, fontSize: 22, fontWeight: '800' },
  adminBannerCopy: { flex: 1 },
  adminBannerTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  cardTitle: { fontSize: 19, color: colors.ink, fontWeight: '700', marginBottom: 6 },
  inputGroup: { marginTop: 14 },
  inputLabel: { color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input: { minHeight: 48, borderColor: colors.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, color: colors.ink, backgroundColor: colors.white, fontSize: 14 },
  multiline: { minHeight: 100, paddingTop: 12, textAlignVertical: 'top' },
  button: { minHeight: 50, backgroundColor: colors.teal, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 14 },
  buttonSecondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.teal },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  buttonSecondaryText: { color: colors.teal },
  formCard: { marginTop: 20, padding: 17, backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  formSectionTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  formRow: { flexDirection: 'row', gap: 12 },
  formHalf: { flex: 1 },
  profileBanner: { backgroundColor: colors.mint, padding: 18, borderRadius: 16, marginTop: 18 },
  profileBannerTitle: { color: colors.ink, fontWeight: '700', fontSize: 17, marginBottom: 6 },
  profileBannerText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.white, padding: 16, borderRadius: 16, marginVertical: 16 },
  profileAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: colors.teal, fontSize: 24, fontWeight: '800' },
  profileName: { color: colors.ink, fontSize: 16, fontWeight: '700', marginBottom: 3 },
  menuCard: { backgroundColor: colors.white, paddingHorizontal: 16, borderRadius: 16, marginTop: 16, borderWidth: 1, borderColor: colors.border },
  menuRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border },
  menuTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  menuValue: { color: colors.muted, fontSize: 15 },
  notificationCard: { backgroundColor: colors.white, borderRadius: 14, padding: 15, marginTop: 10, borderWidth: 1, borderColor: colors.border },
  notificationTitle: { color: colors.ink, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  settingRow: { minHeight: 70, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  emptyState: { backgroundColor: colors.white, padding: 24, alignItems: 'center', borderRadius: 18, marginTop: 18, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { color: colors.teal, fontSize: 28, marginBottom: 8 },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '700', marginBottom: 5 },
  conversationCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 16, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.border },
  conversationAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  conversationAvatarText: { color: colors.teal, fontWeight: '700', fontSize: 18 },
  conversationInfo: { flex: 1, marginLeft: 12 },
  conversationName: { color: colors.ink, fontWeight: '700', fontSize: 14, marginBottom: 3 },
  conversationLast: { color: colors.muted, fontSize: 12, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 24, marginLeft: 8 },
  chatPanel: { minHeight: 400, maxHeight: 580, marginTop: 20, backgroundColor: colors.white, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: colors.border },
  chatList: { flexGrow: 1, gap: 10, justifyContent: 'flex-end', paddingVertical: 8 },
  messageBubble: { maxWidth: '82%', borderRadius: 15, paddingVertical: 10, paddingHorizontal: 13 },
  ownMessage: { backgroundColor: colors.teal, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  otherMessage: { backgroundColor: colors.background, alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  ownMessageText: { color: colors.white, fontSize: 14, lineHeight: 20 },
  otherMessageText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  messageEntry: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 10 },
  messageInput: { flex: 1, height: 44, paddingHorizontal: 12, backgroundColor: colors.background, borderRadius: 22, color: colors.ink },
  sendButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center' },
  sendButtonText: { color: colors.white, fontSize: 23, fontWeight: '700' },
  mapSurface: { height: 380, marginTop: 20, marginBottom: 25, borderRadius: 22, overflow: 'hidden' },
  mapView: { flex: 1 },
  propertyMapMarker: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.teal, borderWidth: 3, borderColor: colors.white, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  propertyMapMarkerText: { color: colors.white, fontSize: 17, fontWeight: '700' },
  userMapMarker: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#12807844', alignItems: 'center', justifyContent: 'center' },
  userMapDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#3478F6', borderWidth: 2, borderColor: colors.white },
  mapSetupNotice: { marginTop: 20, marginBottom: 25, padding: 18, borderRadius: 16, backgroundColor: colors.mint, borderWidth: 1, borderColor: colors.border },
  mapSetupTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  locationPicker: { marginTop: 14 },
  locationPickerMap: { height: 260, marginTop: 8, marginBottom: 8 },
  detailImageWrap: { height: 330, position: 'relative', backgroundColor: colors.mint },
  detailImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  modalRoot: { flex: 1, backgroundColor: colors.white },
  closeButton: { position: 'absolute', top: 52, left: 18, width: 42, height: 42, borderRadius: 21, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 29, color: colors.ink, lineHeight: 32 },
  detailHeart: { position: 'absolute', top: 52, right: 18, width: 42, height: 42, borderRadius: 21, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  galleryCount: { position: 'absolute', right: 18, bottom: 14, backgroundColor: colors.teal, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7 },
  galleryCountText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  detailContent: { padding: 21, paddingBottom: 36 },
  detailPrice: { color: colors.teal, fontSize: 24, fontWeight: '800', marginVertical: 6 },
  detailTitle: { color: colors.ink, fontWeight: '700', fontSize: 21, marginBottom: 8 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.background, padding: 16, borderRadius: 14, marginVertical: 20 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  description: { color: colors.text, fontSize: 14, lineHeight: 22, marginTop: 4, marginBottom: 18 },
  featureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 8 },
  ownerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14 },
  detailActions: { gap: 4 },
  sheetOverlay: { flex: 1, backgroundColor: '#17243D55', justifyContent: 'flex-end' },
  filterSheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34 },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 17 },
  centerText: { textAlign: 'center', marginTop: 15 },
  backButton: { alignSelf: 'flex-start', paddingBottom: 18 },
  confirmCard: { backgroundColor: colors.white, borderRadius: 20, padding: 22, marginHorizontal: 24 },
  reportInput: { minHeight: 120, maxHeight: 220, marginTop: 16, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.ink, backgroundColor: colors.white },
});
