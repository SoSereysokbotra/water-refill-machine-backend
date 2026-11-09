export const MQTT_TOPICS = {
  PAY_REQUEST: 'pay/request',
  PAY_CANCEL: 'pay/cancel',
  PAY_QR: 'pay/qr',
  PAY_STATUS: 'pay/status',
  TRANSACTION: 'transaction',
  TRANSACTION_ACK: 'transaction/ack',
  HEARTBEAT: 'heartbeat',
  ERROR: 'error',
  ONLINE: 'online',
  CONFIG: 'config',
  CONFIG_ACK: 'config/ack',
} as const;

export function buildMachineTopic(machineId: string, topic: string): string {
  return `wrm/${machineId}/${topic}`;
}
