export const FAULT_CODES = {
  NONE: 'NONE',
  TANK_EMPTY: 'TANK_EMPTY',
  TANK_LOW: 'TANK_LOW',
  NO_FLOW: 'NO_FLOW',
  OVERFLOW: 'OVERFLOW',
  BOTTLE_REMOVED: 'BOTTLE_REMOVED',
  BOTTLE_TIMEOUT: 'BOTTLE_TIMEOUT',
  DISPENSE_TIMEOUT: 'DISPENSE_TIMEOUT',
  LOADCELL_FAULT: 'LOADCELL_FAULT',
  FLOW_SENSOR_FAULT: 'FLOW_SENSOR_FAULT',
  VALVE_FAULT: 'VALVE_FAULT',
  PUMP_FAULT: 'PUMP_FAULT',
  PAID_NOT_ACCEPTED: 'PAID_NOT_ACCEPTED',
  POWER_LOSS_RECOVERY: 'POWER_LOSS_RECOVERY',
  CFG_INVALID: 'CFG_INVALID',
  UNKNOWN: 'UNKNOWN',
} as const;

export type FaultCode = (typeof FAULT_CODES)[keyof typeof FAULT_CODES];

export type FaultSeverity = 'info' | 'warning' | 'critical';

export const FAULT_SEVERITY: Record<FaultCode, FaultSeverity | null> = {
  NONE: null,
  TANK_EMPTY: 'critical',
  TANK_LOW: 'warning',
  NO_FLOW: 'critical',
  OVERFLOW: 'critical',
  BOTTLE_REMOVED: 'warning',
  BOTTLE_TIMEOUT: 'info',
  DISPENSE_TIMEOUT: 'critical',
  LOADCELL_FAULT: 'critical',
  FLOW_SENSOR_FAULT: 'critical',
  VALVE_FAULT: 'critical',
  PUMP_FAULT: 'critical',
  PAID_NOT_ACCEPTED: 'warning',
  POWER_LOSS_RECOVERY: 'warning',
  CFG_INVALID: 'warning',
  UNKNOWN: 'warning',
} as const;

