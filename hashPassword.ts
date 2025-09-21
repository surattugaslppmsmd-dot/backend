import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

async function generateHash() {
  const password = process.env.ADMIN_PASS; 
  const saltRounds = 10;

  if (!password) {
    console.error("❌ ADMIN_PASS belum diset di .env");
    return;
  }

  const hash = await bcrypt.hash(password, saltRounds);
  console.log("Password hash:", hash);
}

generateHash();
