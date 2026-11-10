import { PrismaClient, Currency } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedDatabase() {
  console.log('[Seed] Applying raw SQL constraints & indexes...');
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_payment_per_machine
    ON payments(machine_id)
    WHERE status IN ('PENDING','PAID');
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tier_check'
      ) THEN
        ALTER TABLE machine_prices ADD CONSTRAINT tier_check CHECK (volume_ml IN (500, 750, 1000));
      END IF;
    END $$;
  `);

  console.log('[Seed] Seeding WRM-001 and WRM-900...');
  const machines = [
    {
      id: 'WRM-001',
      name: 'Pilot Machine 001',
      location: 'Phnom Penh Test Site',
      enabled: true,
      currency: Currency.USD,
      mqttUsername: 'wrm-machine-001',
      prices: [
        { volumeMl: 500, amountMinor: 15 },
        { volumeMl: 750, amountMinor: 20 },
        { volumeMl: 1000, amountMinor: 25 },
      ],
    },
    {
      id: 'WRM-900',
      name: 'Test Machine 900',
      location: 'Lab Bench Test',
      enabled: true,
      currency: Currency.USD,
      mqttUsername: 'wrm-machine-900',
      prices: [
        { volumeMl: 500, amountMinor: 15 },
        { volumeMl: 750, amountMinor: 20 },
        { volumeMl: 1000, amountMinor: 25 },
      ],
    },
  ];

  for (const m of machines) {
    await prisma.machine.upsert({
      where: { id: m.id },
      update: {
        name: m.name,
        location: m.location,
        enabled: m.enabled,
        currency: m.currency,
        mqttUsername: m.mqttUsername,
      },
      create: {
        id: m.id,
        name: m.name,
        location: m.location,
        enabled: m.enabled,
        currency: m.currency,
        mqttUsername: m.mqttUsername,
      },
    });

    for (const p of m.prices) {
      await prisma.machinePrice.upsert({
        where: {
          machineId_volumeMl: {
            machineId: m.id,
            volumeMl: p.volumeMl,
          },
        },
        update: {
          amountMinor: p.amountMinor,
        },
        create: {
          machineId: m.id,
          volumeMl: p.volumeMl,
          amountMinor: p.amountMinor,
        },
      });
    }
  }

  console.log('[Seed] Seed completed successfully.');
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  seedDatabase()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
