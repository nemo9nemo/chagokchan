import "server-only";
import { cookies } from "next/headers";
import { getLocalSessionClient, readLocalMe } from "@/server/local-user-session.mjs";
import { resolveDeployedSession } from "@/server/deployed-session.mjs";

async function deployedContext() {
  const store = await cookies();
  const header = store.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  return resolveDeployedSession(header);
}

export async function getAppSessionClient() {
  if (process.env.APP_AUTH_MODE === "local_fixture") return getLocalSessionClient();
  return (await deployedContext())?.client ?? null;
}

export async function readAppMe() {
  if (process.env.APP_AUTH_MODE === "local_fixture") return readLocalMe();
  return (await deployedContext())?.me ?? null;
}
