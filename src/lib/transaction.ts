import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/** Callbacks must contain database work only: a conflict can replay the callback. */
export async function serializableTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: "Serializable",
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (attempt >= 5 || !["P2034", "P2002", "P1008", "P2028"].includes(code ?? "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * 2 ** attempt));
    }
  }
}
