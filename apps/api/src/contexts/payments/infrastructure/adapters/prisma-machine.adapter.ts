import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, NotFoundError } from '../../../../shared-kernel';
import { PrismaService } from '../../../../platform/database/prisma.service';
import { MachineForPayment, MachinePort } from '../../domain/ports/machine.port';
import { Currency } from '../../domain/payment.types';

@Injectable()
export class PrismaMachineAdapter implements MachinePort {
  constructor(private readonly prisma: PrismaService) {}

  private getClient(tx?: unknown): Prisma.TransactionClient | PrismaService {
    return (tx as Prisma.TransactionClient) ?? this.prisma;
  }

  async getForPayment(machineId: string, tx?: unknown): Promise<MachineForPayment> {
    const client = this.getClient(tx);
    const row = await client.machine.findUnique({
      where: { id: machineId },
      include: { prices: true },
    });

    if (!row) {
      throw new NotFoundError('PAY_MACHINE_NOT_FOUND', `Machine ${machineId} does not exist`);
    }

    if (!row.enabled) {
      throw new DomainError('PAY_MACHINE_DISABLED', `Machine ${machineId} is disabled`);
    }

    const pricesMap = new Map<number, number>();
    for (const p of row.prices) {
      pricesMap.set(p.volumeMl, p.amountMinor);
    }

    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      currency: row.currency as Currency,
      prices: pricesMap,
      priceFor(volumeMl: number): number | undefined {
        return pricesMap.get(volumeMl);
      },
    };
  }
}
