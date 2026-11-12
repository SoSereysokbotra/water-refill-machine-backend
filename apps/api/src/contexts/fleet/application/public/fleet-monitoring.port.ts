export const FLEET_MONITORING = 'FleetMonitoringPort';

export interface MachineStuckOutcomes {
  machineId: string;
  pendingOutcomes: number;
  pendingOutcomesSince: Date;
}

export interface FleetMonitoringPort {
  getMachinesWithStuckOutcomes(olderThanMinutes: number): Promise<MachineStuckOutcomes[]>;
}
