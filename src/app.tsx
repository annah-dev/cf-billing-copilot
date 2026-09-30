import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button } from "@cloudflare/kumo";
import {
  type CreateSandboxResponse,
  type PanelResponse
} from "./contracts/http";
import { Admin } from "./admin/admin";
import { browserStorage, createApi, readSession, saveSession } from "./ui/api";
import { createFixtureBackend } from "./ui/fixtures";
import { FixtureChat, LiveChat } from "./ui/chat";
import { ErrorNotice, InvoicePanel } from "./ui/components";

// Set VITE_BILLING_API_MODE=live when the agent HTTP surface is available.
const fixtures = import.meta.env.VITE_BILLING_API_MODE !== "live";
const sessionMode = fixtures ? "fixture" : "live";
const backend = createFixtureBackend(browserStorage());
const api = createApi(
  fixtures ? backend.transport : (path, init) => fetch(path, init)
);
// A single bootstrap promise prevents duplicate sandboxes during remounts.
let bootstrap: Promise<CreateSandboxResponse> | null = null;
function initialSession() {
  const stored = readSession(browserStorage(), sessionMode);
  return stored
    ? Promise.resolve(stored)
    : (bootstrap ??= api.createSandbox().catch((error) => {
        bootstrap = null;
        throw error;
      }));
}
function CustomerWorkspace({
  session,
  customerId
}: {
  session: CreateSandboxResponse;
  customerId: string;
}) {
  const [panel, setPanel] = useState<PanelResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true);
    try {
      const next = await api.panel(session.sandboxId, customerId);
      if (current === generation.current) {
        setPanel(next);
        setError(null);
      }
    } catch (failure) {
      if (current === generation.current) setError(failure);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [session.sandboxId, customerId]);
  useEffect(() => {
    const requests = generation;
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      requests.current++;
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  return (
    <>
      {error && (
        <div className="workspace-error">
          <ErrorNotice error={error} retry={() => void refresh()} />
        </div>
      )}
      {!panel ? (
        <output className="loading-state">
          {busy
            ? "Loading your billing records..."
            : "Billing records could not be loaded."}
        </output>
      ) : (
        <main className="workspace">
          {fixtures ? (
            <FixtureChat
              panel={panel}
              backend={backend}
              changed={() => void refresh()}
            />
          ) : (
            <LiveChat panel={panel} changed={() => void refresh()} />
          )}
          <InvoicePanel
            panel={panel}
            session={session}
            refresh={() => void refresh()}
            busy={busy}
          />
        </main>
      )}
    </>
  );
}
function Demo() {
  const [session, setSession] = useState<CreateSandboxResponse | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const [persistent, setPersistent] = useState(true);
  function activate(next: CreateSandboxResponse) {
    setPersistent(saveSession(browserStorage(), next, sessionMode));
    setSession(next);
    setCustomerId(next.customers[0].customerId);
    bootstrap = Promise.resolve(next);
  }
  useEffect(() => {
    let active = true;
    initialSession()
      .then((next) => {
        if (active) activate(next);
      })
      .catch((failure) => {
        if (active) setError(failure);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function reset() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      activate(await api.createSandbox());
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  const scenario =
    fixtures && import.meta.env.DEV
      ? new URLSearchParams(window.location.search).get("preview")
      : null;
  return (
    <>
      <div className="demo-toolbar">
        <div className="customer-picker">
          <label htmlFor="customer">Customer</label>
          <select
            id="customer"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            disabled={busy || !session}
          >
            {session?.customers.map((customer) => (
              <option key={customer.customerId} value={customer.customerId}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="secondary"
          onClick={() => void reset()}
          disabled={busy}
        >
          {busy ? "Preparing demo..." : "Reset demo"}
        </Button>
      </div>
      {!persistent && (
        <output className="storage-notice">
          Browser storage is unavailable. This demo works in this tab;{" "}
          {fixtures
            ? "Fixture approvals in another tab need browser storage."
            : "Keep the Approver view link to review credits in another tab."}
        </output>
      )}
      {error && (
        <div className="workspace-error">
          <ErrorNotice error={error} retry={() => void reset()} />
        </div>
      )}
      {scenario === "cap" && (
        <div className="workspace-error">
          <ErrorNotice
            error={{
              error: {
                code: "cap_reached",
                message:
                  "This sandbox has reached its daily message limit. No model call was made.",
                cap: {
                  name: "Messages per sandbox per UTC day",
                  limit: 30,
                  resetsAt: "2026-09-30T00:00:00Z"
                }
              }
            }}
          />
        </div>
      )}
      {session ? (
        <CustomerWorkspace
          key={`${session.sandboxId}.${customerId}`}
          session={session}
          customerId={customerId}
        />
      ) : (
        <output className="loading-state">
          {busy
            ? "Creating your demo sandbox..."
            : "Use Reset demo to try again."}
        </output>
      )}
    </>
  );
}
export default function App() {
  const admin = window.location.pathname.replace(/\/$/, "") === "/admin";
  return (
    <div className="app-shell">
      <header className="site-header">
        <a href="/" className="brand">
          <span className="brand-mark">B</span>
          <span>
            Billing <strong>copilot</strong>
          </span>
        </a>
        <div className="header-labels">
          <Badge variant="secondary">Demo sandbox</Badge>
          <span className="synthetic-label">Synthetic data only</span>
        </div>
      </header>
      {fixtures && (
        <div className="fixture-banner">
          <span className="fixture-dot" />
          <strong>Seed preview</strong>
          <span>
            Shared engine seed. No AI calls. Billing values match the live demo.
          </span>
        </div>
      )}
      {admin ? <Admin api={api} sessionMode={sessionMode} /> : <Demo />}
      <footer className="site-footer">
        <span>Deterministic billing. Human decisions. An audit trail.</span>
        <span>Built on Cloudflare</span>
      </footer>
    </div>
  );
}
