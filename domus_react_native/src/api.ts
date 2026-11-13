import { Platform } from 'react-native';

export type Property = {
  id: number;
  title: string;
  description: string;
  price: number;
  transaction: 'Vente' | 'Location';
  type: string;
  city: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  surface: number;
  bedrooms: number;
  bathrooms: number;
  features: string[];
  photos: string[];
  imageUrl: string;
  status: string;
  favorite: boolean;
  ownerId: number;
  ownerName: string;
  ownerPhone: string;
  createdAt: string;
};

export type User = {
  id: number;
  name: string;
  email: string;
  phone: string;
  city: string;
  about: string;
  role?: 'user' | 'admin';
};

export type AdminUser = User & {
  bannedAt: string | null;
  listingCount?: number;
};

export type AdminReport = {
  id: number;
  propertyId: number;
  reporterId: number;
  reason: string;
  status: 'pending' | 'resolved' | 'rejected';
  createdAt: string;
  reporterName: string;
  reporterEmail: string;
  propertyTitle: string | null;
  propertyCity: string | null;
  propertyStatus: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
};

export type Conversation = {
  id: number;
  propertyId: number;
  propertyTitle: string;
  contactName: string;
  lastMessage: string | null;
};

export type Message = {
  id: number;
  body: string;
  senderId: number;
  senderName: string;
  createdAt: string;
};

export type NotificationItem = {
  id: number;
  title: string;
  body: string;
  read: number;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const fallbackHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
export const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL || `http://${fallbackHost}:4000`).replace(/\/$/, '');

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  if (!__DEV__ && !apiBaseUrl.startsWith('https://')) {
    throw new Error('Une adresse API HTTPS est obligatoire pour la version publiée.');
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new ApiError(typeof result.error === 'string' ? result.error : `Erreur API (${response.status}).`, response.status);
  }
  return result as T;
}

export function formatPrice(price: number, transaction: Property['transaction']): string {
  return `${new Intl.NumberFormat('fr-TN').format(price)} DT${transaction === 'Location' ? ' / mois' : ''}`;
}
