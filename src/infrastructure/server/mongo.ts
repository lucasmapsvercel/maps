import { MongoClient } from "mongodb";
import { databaseName, mongoUri } from "./config";

const clients = globalThis as typeof globalThis & { mapsMongo?: Promise<MongoClient> };

export async function mongoClient(): Promise<MongoClient> {
  if (!clients.mapsMongo) {
    const client = new MongoClient(mongoUri(), {
      maxPoolSize: 10, minPoolSize: 0, serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000, socketTimeoutMS: 15000
    });
    clients.mapsMongo = client.connect().catch((error: unknown) => {
      clients.mapsMongo = undefined;
      throw error;
    });
  }
  return clients.mapsMongo;
}

export async function mongoDatabase() {
  return (await mongoClient()).db(databaseName());
}
