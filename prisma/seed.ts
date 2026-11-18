import { PrismaClient, Role } from "../src/generated/prisma";
import bcrypt from "bcryptjs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

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

  // Demo payments — only when SEED_DEMO=1, and only into an empty table, so
  // this can never inject sample rows next to real ones.
  // Run `SEED_DEMO=1 npm run db:seed` if you want sample data for a demo.
  // The set covers every status the All tab's dropdown can filter on.
  if (process.env.SEED_DEMO === "1" && (await prisma.payment.count()) === 0) {
    type Demo = {
      payee: string; amount: bigint; purpose: string; by: string; payFrom: string;
      status: "REQUESTED" | "SCHEDULED" | "HOLD" | "AWAITING_APPROVAL" | "RETURNED" | "PAID" | "CONFIRMED" | "CANCELLED";
      due: Date; scheduledFor?: Date; upi?: string;
    };
    const demo: Demo[] = [
      // Overdue: still REQUESTED underneath — "late" is derived, never stored.
      { payee: "Glow Cosmetics Pvt Ltd", amount: 4500000n, purpose: "Bulk SKU restock — skincare", by: "Jignesh", payFrom: "Zenith", status: "REQUESTED", due: day(-2) },
      { payee: "Shiprocket", amount: 1250000n, purpose: "Courier wallet top-up", by: "Jagat", payFrom: "Lemolite", status: "SCHEDULED", due: day(0), scheduledFor: day(0) },
      { payee: "AWS", amount: 12000000n, purpose: "Monthly cloud bill", by: "Jignesh", payFrom: "Zenith", status: "REQUESTED", due: day(3) },
      { payee: "@makeupbyzoya", amount: 2200000n, purpose: "Influencer collab — reel", by: "Bhadresh", payFrom: "Peliswan", status: "HOLD", due: day(2) },
      // Raised by a USER, so it waits on Jagat rather than going straight to the payer.
      { payee: "Packwell Cartons", amount: 870000n, purpose: "Shipping cartons — 2000 units", by: "Payal", payFrom: "Shivam", status: "AWAITING_APPROVAL", due: day(5) },
      { payee: "Nova Print Studio", amount: 340000n, purpose: "Label printing — new SKU", by: "Umang", payFrom: "Shakti", status: "RETURNED", due: day(4), upi: "novaprint@okicici" },
      { payee: "Bm Roadlines", amount: 1980000n, purpose: "Freight — Surat to Mumbai", by: "Jignesh", payFrom: "Bm roadlines", status: "PAID", due: day(-1) },
      { payee: "Tally Solutions", amount: 1800000n, purpose: "Accounting licence renewal", by: "Bhadresh", payFrom: "Lemolite", status: "CONFIRMED", due: day(-6) },
      { payee: "Dropship Weekly", amount: 450000n, purpose: "Newsletter sponsorship — cancelled", by: "Dharmesh", payFrom: "Peliswan", status: "CANCELLED", due: day(7) },
    ];

    // A payment can never be PAID without a proof file (CLAUDE.md rule 1), so
    // the demo writes a real one to UPLOAD_DIR rather than faking the status.
    const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./var/uploads");
    await mkdir(uploadDir, { recursive: true });
    const PROOF_PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPElEQVR42mNk+M9QzzCKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAUDAQBr2gQBxHe0vgAAAABJRU5ErkJggg==",
      "base64",
    );

    for (const d of demo) {
      const paid = d.status === "PAID" || d.status === "CONFIRMED";
      const p = await prisma.payment.create({
        data: {
          payee: d.payee,
          amount: d.amount,
          purpose: d.purpose,
          payFrom: d.payFrom,
          upi: d.upi ?? null,
          status: d.status,
          dueDate: d.due,
          scheduledFor: d.scheduledFor ?? null,
          requestedById: users[d.by],
          approvedById: d.status === "AWAITING_APPROVAL" || d.status === "RETURNED" ? null : users["Jagat"],
          approvedAt: d.status === "AWAITING_APPROVAL" || d.status === "RETURNED" ? null : day(-1),
          paidById: paid ? users["Mahesh"] : null,
          paidAt: paid ? day(-1) : null,
          confirmedById: d.status === "CONFIRMED" ? users[d.by] : null,
          confirmedAt: d.status === "CONFIRMED" ? day(0) : null,
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
      if (d.status === "RETURNED") {
        await prisma.paymentEvent.create({
          data: { paymentId: p.id, actorId: users["Jagat"], type: "RETURN", message: "Please attach the quote before I approve this." },
        });
      }
      if (d.status === "CANCELLED") {
        await prisma.paymentEvent.create({
          data: { paymentId: p.id, actorId: users["Jagat"], type: "CANCEL", message: "Sponsorship dropped — not going ahead." },
        });
      }
      if (paid) {
        const storedName = `${randomUUID()}.png`;
        await writeFile(path.join(uploadDir, storedName), PROOF_PNG);
        const proof = await prisma.attachment.create({
          data: {
            paymentId: p.id,
            kind: "PROOF",
            originalName: "upi-receipt.png",
            storedName,
            mimeType: "image/png",
            size: PROOF_PNG.byteLength,
            uploadedById: users["Mahesh"],
          },
        });
        await prisma.paymentEvent.create({
          data: { paymentId: p.id, actorId: users["Mahesh"], type: "PAY", message: "Paid — receipt attached.", attachmentId: proof.id },
        });
      }
      if (d.status === "CONFIRMED") {
        await prisma.paymentEvent.create({
          data: { paymentId: p.id, actorId: users[d.by], type: "CONFIRM", message: "Received, thank you." },
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
