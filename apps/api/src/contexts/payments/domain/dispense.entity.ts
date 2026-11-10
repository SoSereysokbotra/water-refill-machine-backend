export interface DispenseProps {
  tranId: string;
  machineId: string;
  result: 'ok' | 'partial' | 'error';
  flowMl: number;
  weightG: number;
  diffPercent: number;
  fault?: string | null;
  occurredAt: Date;
  receivedAt?: Date;
  clockSkew?: boolean;
  late?: boolean;
}

export class Dispense {
  readonly tranId: string;
  readonly machineId: string;
  readonly result: 'ok' | 'partial' | 'error';
  readonly flowMl: number;
  readonly weightG: number;
  readonly diffPercent: number;
  readonly fault: string | null;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly clockSkew: boolean;
  readonly late: boolean;

  constructor(props: DispenseProps) {
    this.tranId = props.tranId;
    this.machineId = props.machineId;
    this.result = props.result;
    this.flowMl = props.flowMl;
    this.weightG = props.weightG;
    this.diffPercent = props.diffPercent;
    this.fault = props.fault ?? null;
    this.occurredAt = props.occurredAt;
    this.receivedAt = props.receivedAt ?? new Date();
    this.clockSkew = props.clockSkew ?? false;
    this.late = props.late ?? false;
  }

  static calculateDiffPercent(flowMl: number, weightG: number, volumeMl: number): number {
    const target = Math.max(1, volumeMl);
    const diff = Math.abs(flowMl - weightG);
    const pct = (diff / target) * 100;
    return Number(pct.toFixed(2));
  }

  get hasAccuracyMismatch(): boolean {
    return this.diffPercent > 5.0;
  }
}
