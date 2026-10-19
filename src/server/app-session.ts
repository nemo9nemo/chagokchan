import "server-only";
import { cookies } from "next/headers";
import { getLocalSessionClient, readLocalMe } from "@/server/local-user-session.mjs";
import { resolveDeployedSession, resolveVerifiedAuthSession } from "@/server/deployed-session.mjs";

async function deployedContext() {
  const store = await cookies();
  const header = store.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  return resolveDeployedSession(header);
}

// Registration and auth-state lookup need a verified Auth identity before an
// app account exists. Their RPCs still enforce the live DB session themselves.
export async function getVerifiedAuthContext() {
  if (process.env.APP_AUTH_MODE === "local_fixture") {
    const client = await getLocalSessionClient();
    const me = await readLocalMe();
    return client && me ? { client, userId: me.user_id as string } : null;
  }
  const store = await cookies();
  const header = store.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  return resolveVerifiedAuthSession(header);
}

export async function getAppSessionClient() {
  if (process.env.APP_AUTH_MODE === "local_fixture") return getLocalSessionClient();
  return (await deployedContext())?.client ?? null;
}

export async function readAppMe() {
  if (process.env.APP_AUTH_MODE === "local_fixture") return readLocalMe();
  return (await deployedContext())?.me ?? null;
}
