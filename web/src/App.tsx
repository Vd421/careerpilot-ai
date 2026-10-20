import { MOCK } from "@/lib/api";

export default function App() {
  return <div className="p-8 text-[13px] text-muted">CareerPilot scaffold. Mock mode: {MOCK ? "on" : "off"}</div>;
}
