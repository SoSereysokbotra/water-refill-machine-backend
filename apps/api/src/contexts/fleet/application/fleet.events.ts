import { createDomainEvent, DomainEvent } from '../../../shared-kernel';

/** Fleet events (Plan §C4). Published through the outbox. */
export interface MachineConfigChangedData {
  machineId: string;
  reason: 'provisioned' | 'prices' | 'enabled' | 'decommissioned';
}
export interface ConfigRejectedData {
  machineId: string;
  fault: string;
}
export interface MachinePresenceData {
  machineId: string;
  at: Date;
}
export interface MachineFaultReportedData {
  machineId: string;
  fault: string;
}

export const FLEET_EVENTS = {
  MACHINE_CONFIG_CHANGED: 'fleet.MachineConfigChanged',
  CONFIG_REJECTED: 'fleet.ConfigRejected',
  MACHINE_WENT_OFFLINE: 'fleet.MachineWentOffline',
  MACHINE_CAME_ONLINE: 'fleet.MachineCameOnline',
  MACHINE_FAULT_REPORTED: 'fleet.MachineFaultReported',
} as const;

export const machineConfigChangedEvent = (data: MachineConfigChangedData, at: Date): DomainEvent<MachineConfigChangedData> =>
  createDomainEvent(FLEET_EVENTS.MACHINE_CONFIG_CHANGED, data, { occurredAt: at });
export const configRejectedEvent = (data: ConfigRejectedData, at: Date): DomainEvent<ConfigRejectedData> =>
  createDomainEvent(FLEET_EVENTS.CONFIG_REJECTED, data, { occurredAt: at });
export const machineWentOfflineEvent = (data: MachinePresenceData, at: Date): DomainEvent<MachinePresenceData> =>
  createDomainEvent(FLEET_EVENTS.MACHINE_WENT_OFFLINE, data, { occurredAt: at });
export const machineCameOnlineEvent = (data: MachinePresenceData, at: Date): DomainEvent<MachinePresenceData> =>
  createDomainEvent(FLEET_EVENTS.MACHINE_CAME_ONLINE, data, { occurredAt: at });
export const machineFaultReportedEvent = (data: MachineFaultReportedData, at: Date): DomainEvent<MachineFaultReportedData> =>
  createDomainEvent(FLEET_EVENTS.MACHINE_FAULT_REPORTED, data, { occurredAt: at });
