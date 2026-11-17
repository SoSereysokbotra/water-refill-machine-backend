import { PrismaClient, Currency, UserRole } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

// Seed = test data only. Schema, indexes and constraints come from prisma/migrations
// (run `pnpm --filter @wrm/api db:deploy` first).
export async function seedDatabase() {
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

  // The default users have passwords written in this file: never create them on a server.
  const appEnv = process.env.APP_ENV ?? 'local';
  if (appEnv !== 'local') {
    console.log(`[Seed] APP_ENV=${appEnv}: default development users NOT created (create real users via /v1/users).`);
    console.log('[Seed] Seed completed successfully.');
    return;
  }

  console.log('[Seed] Seeding default development users...');
  const users = [
    {
      id: 'usr-admin-seed',
      email: 'admin@wrm.kh',
      name: 'WRM Administrator',
      role: UserRole.admin,
      password: 'AdminPassword123!',
    },
    {
      id: 'usr-operator-seed',
      email: 'operator@wrm.kh',
      name: 'WRM Operator',
      role: UserRole.operator,
      password: 'OperatorPassword123!',
    },
    {
      id: 'usr-viewer-seed',
      email: 'viewer@wrm.kh',
      name: 'WRM Viewer',
      role: UserRole.viewer,
      password: 'ViewerPassword123!',
    },
  ];

  for (const u of users) {
    const passwordHash = await hash(u.password);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        passwordHash,
      },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
      },
    });
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
