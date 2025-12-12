import dotenv from "dotenv";

dotenv.config();

export const PORT = parseInt(process.env.PORT || "4022", 10);

export const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
export const SVM_PRIVATE_KEY = process.env.SVM_PRIVATE_KEY;

if (!EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY environment variable is required");
  process.exit(1);
}

if (!SVM_PRIVATE_KEY) {
  console.error("❌ SVM_PRIVATE_KEY environment variable is required");
  process.exit(1);
}

