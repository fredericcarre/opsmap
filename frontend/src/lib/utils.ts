import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'ok':
      return 'bg-green-500';
    case 'warning':
      return 'bg-yellow-500';
    case 'error':
      return 'bg-red-500';
    case 'starting':
    case 'stopping':
      return 'bg-blue-500 animate-pulse';
    default:
      return 'bg-gray-500';
  }
}

export function getStatusText(status: string): string {
  switch (status) {
    case 'ok':
      return 'Healthy';
    case 'warning':
      return 'Warning';
    case 'error':
      return 'Error';
    case 'starting':
      return 'Starting...';
    case 'stopping':
      return 'Stopping...';
    default:
      return 'Unknown';
  }
}
