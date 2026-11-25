export type EmailStatus = 'SCHEDULED' | 'SENT' | 'FAILED' | 'RATE_LIMITED' | 'CANCELLED';

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  slackConnected: boolean;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
  hourlyLimit: number;
}

export interface EmailRow {
  id: string;
  toEmail: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  error: string | null;
  previewUrl: string | null;
  createdAt: string;
  sender?: { name: string; email: string };
}

export interface EmailListResponse {
  items: EmailRow[];
  total: number;
  page: number;
  pageSize: number;
  source: 'elasticsearch' | 'postgres';
}

export interface EmailStats {
  scheduled: number;
  rateLimited: number;
  sent: number;
  failed: number;
  cancelled: number;
  total: number;
  nextSendAt: string | null;
}

export interface ScheduleRequest {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delaySeconds: number;
  hourlyLimit?: number;
}

export interface ScheduleResponse {
  scheduled: number;
  duplicatesSkipped: number;
  totalRecipients: number;
  emailIds: string[];
}
