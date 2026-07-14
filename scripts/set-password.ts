// Admin CLI to set/rotate a user's password. There is no self-serve password
// change in the app — only this script (run by an admin).
//   npm run set-password -- mahesh@payment.com "new-password"
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const [loginIdArg, password] = process.argv.slice(2);
  if (!loginIdArg || !password) {
    console.error('Usage: npm run set-password -- <loginId> "<password>"');
    process.exit(1);
  }
  const email = loginIdArg.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with login ID "${email}".`);
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { email }, data: { passwordHash } });
  console.log(`✓ Password updated for ${email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
