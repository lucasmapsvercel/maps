import { createHash } from "node:crypto";
import type { MongoClient, Db } from "mongodb";
import { PortalError } from "../../application/portal-error";
import type { Actor } from "./auth";

interface Budget {
  _id: string;
  count: number;
}

export class GoogleSearchBudget {
  constructor(private readonly client: MongoClient, private readonly db: Db) {}

  async reserve(actor: Actor, requestId: string, limit: number, scope: string, now = new Date()) {
    const month = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit"
    }).format(now);
    const id = createHash("sha256").update(`${scope}:${month}`).digest("hex");
    const receiptId = createHash("sha256").update(`${actor.workspaceId}:${actor.userId}:${requestId}`).digest("hex");
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        const receipts = this.db.collection<{ _id: string; createdAt: Date; workspaceId: string; userId: string }>("googleSearchRequests");
        if (await receipts.findOne({ _id: receiptId }, { session })) {
          throw new PortalError(409, "GOOGLE_REQUEST_ALREADY_USED",
            "Esta solicitação já foi utilizada. Os resultados não são armazenados; confirme uma nova consulta se necessário.");
        }
        const budgets = this.db.collection<Budget>("googleSearchBudgets");
        await budgets.updateOne({ _id: id }, { $setOnInsert: { count: 0 } }, { upsert: true, session });
        const reserved = await budgets.updateOne({ _id: id, count: { $lt: limit } }, { $inc: { count: 1 } }, { session });
        if (reserved.modifiedCount !== 1) throw new PortalError(429, "GOOGLE_MONTHLY_LIMIT", "Limite mensal de consultas deste portal atingido. Nenhuma chamada foi realizada.");
        await receipts.insertOne({ _id: receiptId, createdAt: now, workspaceId: actor.workspaceId, userId: actor.userId }, { session });
      }, { writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
  }
}
