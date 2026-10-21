// All shared types for the entire system

export type CommandType = 'press' | 'open' | 'close';

export type CommandStatus =
  | 'pending'       // awaiting user confirmation
  | 'confirmed'     // user confirmed, awaiting device pickup
  | 'delivered'     // device has fetched it
  | 'executed'      // device pulsed relay and ACK'd
  | 'cancelled'     // user cancelled
  | 'expired'       // confirmation or execution window elapsed
  | 'uncertain'     // device timed out after delivery; state unknown
  | 'failed';       // explicit failure reported by device

export type ExecutionResult = 'success' | 'uncertain' | 'failed';

export interface AuthorizedUser {
  id: number;
  telegramUserId: string;   // store as TEXT (bigint safe in JS strings)
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
  notes: string | null;
}

export interface Device {
  id: string;               // UUID
  deviceName: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
}

export interface Command {
  id: string;               // UUID
  deviceId: string;
  requestedByUserId: string; // telegram user id as string
  commandType: CommandType;
  status: CommandStatus;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
  cancelledAt: Date | null;
  executionResult: ExecutionResult | null;
  executionDetail: string | null;
  telegramChatId: string | null;
  telegramMessageId: string | null;
  confirmationCallbackId: string | null;
  idempotencyKey: string | null;
}

export interface DeviceHeartbeat {
  id: number;
  deviceId: string;
  receivedAt: Date;
  firmwareVersion: string | null;
  freeHeap: number | null;
  uptimeSeconds: number | null;
  wifiRssi: number | null;
}

export interface AuditEvent {
  id: number;
  eventType: string;
  telegramUserId: string | null;
  deviceId: string | null;
  commandId: string | null;
  occurredAt: Date;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
}

// API request/response types for device communication
export interface HeartbeatRequest {
  deviceKey: string;
  firmwareVersion?: string;
  freeHeap?: number;
  uptimeSeconds?: number;
  wifiRssi?: number;
}

export interface HeartbeatResponse {
  ok: boolean;
  serverTime: string; // ISO 8601
}

export interface PendingCommandResponse {
  ok: boolean;
  command: {
    id: string;
    commandType: CommandType;
    expiresAt: string;
    pulseDurationMs: number;
  } | null;
}

export interface AckRequest {
  deviceKey: string;
  commandId: string;
  result: ExecutionResult;
  detail?: string;
}

export interface AckResponse {
  ok: boolean;
  accepted: boolean;
  reason?: string;
}

export interface DeviceAuthRequest {
  deviceKey: string;
}

export interface DeviceAuthResponse {
  ok: boolean;
  deviceId: string;
  deviceName: string;
}

export interface StatusResponse {
  deviceOnline: boolean;
  lastHeartbeat: string | null;
  lastCommand: {
    commandType: CommandType;
    status: CommandStatus;
    executionResult: ExecutionResult | null;
    createdAt: string;
  } | null;
  doorPositionKnown: boolean;
}
