import { PrismaClient, Role } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Fixed roster. ADMINs view everything; capability flags decide duties:
// Mahesh pays, Jagat approves user requests, Jignesh manages accounts.
// USERs see only their own payments and route through Jagat for approval.
type SeedUser = { name: string; email: string; role: Role; isPayer?: boolean; isApprover?: boolean; isManager?: boolean };
const ROSTER: SeedUser[] = [
  { name: "Mahesh", email: "mahesh@payment.com", role: Role.ADMIN, isPayer: true },
  { name: "Jagat", email: "jagat@payment.com", role: Role.ADMIN, isApprover: true },
  { name: "Jignesh", email: "jignesh@payment.com", role: Role.ADMIN, isManager: true },
  { name: "Bhadresh", email: "bhadresh@payment.com", role: Role.ADMIN },
  { name: "Payal", email: "payal@payment.com", role: Role.USER },
  { name: "Umang", email: "umang@payment.com", role: Role.USER },
  { name: "Dharmesh", email: "dharmesh@payment.com", role: Role.USER },
];

// Temporary password set on first creation only (never overwrites a changed
// one). Change it with: npm run set-password -- <loginId> <newPassword>
const TEMP_PASSWORD = process.env.SEED_PASSWORD ?? "paytrack123";

const day = (offset: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

async function main() {
  const users: Record<string, string> = {};
  for (const u of ROSTER) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    const passwordHash = existing?.passwordHash ?? (await bcrypt.hash(TEMP_PASSWORD, 10));
    const flags = {
      role: u.role,
      isPayer: !!u.isPayer,
      isApprover: !!u.isApprover,
      isManager: !!u.isManager,
      active: true,
    };
    const rec = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, ...flags, passwordHash },
      create: { name: u.name, email: u.email, ...flags, passwordHash },
    });
    users[u.name] = rec.id;
  }

  // Pay-from accounts (the "Pay from" list) in priority order. Admins reorder in-app.
  const seedAccounts: [string, number][] = [
    ["Shivam", 1],
    ["Peliswan", 2],
    ["Bm roadlines", 3],
    ["Zenith", 4],
    ["Lemolite", 5],
    ["Shakti", 6],
  ];
  for (const [name, sortOrder] of seedAccounts) {
    await prisma.payAccount.upsert({
      where: { name },
      update: { sortOrder, active: true },
      create: { name, sortOrder },
    });
  }

  const seedPrivateMembers: [string, number][] = [["Jagat", 1], ["Jignesh", 2]];
  for (const [name, sortOrder] of seedPrivateMembers) {
    await prisma.privateMember.upsert({
      where: { name },
      update: { sortOrder, active: true },
      create: { name, sortOrder },
    });
  }

  // Demo payments — only when SEED_DEMO=1 (never in real/production seeding).
  // Run `SEED_DEMO=1 npm run db:seed` if you want sample data for a demo.
  if (process.env.SEED_DEMO === "1" && (await prisma.payment.count()) === 0) {
    const demo = [
      { payee: "Glow Cosmetics Pvt Ltd", amount: 4500000n, purpose: "Bulk SKU restock — skincare", by: "Jignesh", payFrom: "Zenith", status: "REQUESTED" as const, due: day(-2) },
      { payee: "Shiprocket", amount: 1250000n, purpose: "Courier wallet top-up", by: "Jagat", payFrom: "Lemolite", status: "SCHEDULED" as const, due: day(0), scheduledFor: day(0) },
      { payee: "AWS", amount: 12000000n, purpose: "Monthly cloud bill", by: "Jignesh", payFrom: "Zenith", status: "REQUESTED" as const, due: day(3) },
      { payee: "@makeupbyzoya", amount: 2200000n, purpose: "Influencer collab — reel", by: "Bhadresh", payFrom: "Peliswan", status: "HOLD" as const, due: day(2) },
    ];
    for (const d of demo) {
      const p = await prisma.payment.create({
        data: {
          payee: d.payee,
          amount: d.amount,
          purpose: d.purpose,
          payFrom: d.payFrom,
          status: d.status,
          dueDate: d.due,
          scheduledFor: d.scheduledFor ?? null,
          requestedById: users[d.by],
        },
      });
      await prisma.paymentEvent.create({
        data: { paymentId: p.id, actorId: users[d.by], type: "REQUEST", message: `${d.purpose}.` },
      });
      if (d.status === "SCHEDULED") {
        await prisma.paymentEvent.create({
          data: { paymentId: p.id, actorId: users["Mahesh"], type: "SCHEDULE", message: "Mahesh scheduled this for today." },
        });
      }
    }
    console.log(`Seeded ${demo.length} demo payments.`);
  }

  const count = await prisma.user.count();
  console.log(`Seeded users. Total users in DB: ${count}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
