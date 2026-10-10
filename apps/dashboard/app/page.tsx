"use client";
import dynamic from "next/dynamic";

// Wallet Standard needs `window`; render the dashboard on the client only.
const Dashboard = dynamic(() => import("../components/Dashboard"), { ssr: false });

export default function Page() {
  return <Dashboard />;
}
