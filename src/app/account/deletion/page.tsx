import AuthGate from "../../auth-gate";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default function Deletion() { return <AuthGate destination="/account/deletion" />; }
