import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@cloudflare/kumo";
import {
  DecisionRequestSchema,
  type AdminCreditRequestsResponse
} from "../contracts/http";
import {
  browserStorage,
  followUpDecision,
  parseAdminFragment,
  readSession,
  type BillingApi,
  type SessionMode
} from "../ui/api";
import { CreditStatus, ErrorNotice } from "../ui/components";
// After a decision the Workflow applies or rejects the request a moment later; re-fetch a few
// times so the card shows the outcome, without polling against the daily request cap.
const FOLLOW_UP_ATTEMPTS = 5;
const FOLLOW_UP_DELAY_MS = 1000;
function getCredentials(sessionMode: SessionMode) {
  try {
    const fragment = parseAdminFragment(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    if (fragment) return { credentials: fragment, error: null };
    const saved = readSession(browserStorage(), sessionMode);
    return saved
      ? {
          credentials: {
            sandboxId: saved.sandboxId,
            token: saved.approverToken
          },
          error: null
        }
      : {
          credentials: null,
          error: {
            error: {
              code: "unauthorized",
              message:
                "Open this page from the Approver view link in your demo."
            }
          }
        };
  } catch {
    window.history.replaceState(null, "", window.location.pathname);
    return {
      credentials: null,
      error: {
        error: {
          code: "unauthorized",
          message:
            "The approval link is invalid. Open a fresh link from your demo."
        }
      }
    };
  }
}
export function Admin({
  api,
  sessionMode
}: {
  api: BillingApi;
  sessionMode: SessionMode;
}) {
  const [{ credentials, error: credentialError }] = useState(() =>
    getCredentials(sessionMode)
  );
  const [data, setData] = useState<AdminCreditRequestsResponse | null>(null);
  const [error, setError] = useState<unknown>(credentialError);
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const deciding = useRef(false);
  const mounted = useRef(true);
  // A quiet refresh leaves `busy` alone, so the page stays busy (Refresh disabled) for the whole
  // decision follow-up.
  const refresh = useCallback(
    async ({ quiet = false } = {}) => {
      if (!credentials || !mounted.current) return null;
      const current = ++generation.current;
      if (!quiet) setBusy(true);
      try {
        const next = await api.creditRequests(
          credentials.sandboxId,
          credentials.token
        );
        if (current === generation.current) {
          setData(next);
          setError(null);
          return next;
        }
      } catch (failure) {
        if (current === generation.current) setError(failure);
      } finally {
        if (current === generation.current && !quiet) setBusy(false);
      }
      return null;
    },
    [api, credentials]
  );
  useEffect(() => {
    const requests = generation;
    mounted.current = true;
    void refresh();
    const onFocus = () => {
      if (!deciding.current) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      requests.current++;
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  async function decide(requestId: string, decision: "approve" | "reject") {
    if (!credentials || deciding.current) return;
    const parsed = DecisionRequestSchema.safeParse({
      decision,
      reason: reasons[requestId] ?? ""
    });
    if (!parsed.success) {
      setError({
        error: {
          code: "invalid_request",
          message:
            "Enter a reason (1 to 500 characters) before recording a decision."
        }
      });
      return;
    }
    deciding.current = true;
    setBusy(true);
    setNotice("");
    setError(null);
    try {
      const result = await api.decide(
        credentials.sandboxId,
        credentials.token,
        requestId,
        parsed.data
      );
      setNotice(
        result.alreadyRecorded
          ? "This same decision was already recorded."
          : "Decision recorded. The workflow will complete the credit request."
      );
      await followUpDecision({
        requestId,
        read: () => refresh({ quiet: true }),
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
        active: () => mounted.current,
        attempts: FOLLOW_UP_ATTEMPTS,
        delayMs: FOLLOW_UP_DELAY_MS
      });
    } catch (failure) {
      setError(failure);
    } finally {
      deciding.current = false;
      setBusy(false);
    }
  }
  const requests = [...(data?.requests ?? [])].sort(
    (a, b) =>
      Number(b.status === "pending_approval") -
        Number(a.status === "pending_approval") ||
      b.createdAt.localeCompare(a.createdAt)
  );
  return (
    <main className="admin-page">
      <div className="admin-heading">
        <div>
          <span className="eyebrow">HUMAN APPROVAL</span>
          <h1>Credit review</h1>
          <p>Validate the claim. Record a decision and a reason.</p>
        </div>
        <Button
          variant="secondary"
          disabled={busy || !credentials}
          onClick={() => {
            if (!deciding.current) void refresh();
          }}
        >
          Refresh list
        </Button>
      </div>
      <div className="admin-context">
        <strong>Demo approval access</strong>
        <p>
          The requester and approver share this browser in the demo. Decisions
          affect only this sandbox. A recorded decision cannot be changed.
        </p>
      </div>
      {Boolean(error) && <ErrorNotice error={error} />}
      {notice && <output className="success-notice">{notice}</output>}
      {busy && <output className="muted">Updating credit requests...</output>}
      {data && requests.length === 0 && (
        <div className="empty-state">
          <h2>No credit requests</h2>
          <p>Start a request in the billing chat, then refresh this list.</p>
        </div>
      )}
      <div className="admin-requests">
        {requests.map((request) => (
          <section className="admin-card" key={request.id}>
            <div className="section-title">
              <div>
                <span className="eyebrow">{request.customerName}</span>
                <h2>
                  {request.validatedAmount?.display ?? "Awaiting validation"}
                </h2>
              </div>
              <CreditStatus status={request.status} />
            </div>
            <p className="identifier small">
              {request.id} / {request.invoiceId}
            </p>
            <blockquote>{request.customerReason}</blockquote>
            {request.deadline && (
              <p className="small muted">
                Approval deadline: {new Date(request.deadline).toUTCString()}
              </p>
            )}
            {request.status === "pending_approval" ? (
              <>
                <label
                  className="reason-label"
                  htmlFor={`reason-${request.id}`}
                >
                  Decision reason{" "}
                  <span className="muted">(required for both actions)</span>
                </label>
                <textarea
                  id={`reason-${request.id}`}
                  value={reasons[request.id] ?? ""}
                  maxLength={500}
                  disabled={busy}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [request.id]: event.target.value
                    }))
                  }
                  placeholder="Explain why this claim should be approved or rejected"
                  rows={3}
                />
                <div className="button-row">
                  <Button
                    variant="primary"
                    disabled={busy || !(reasons[request.id] ?? "").trim()}
                    onClick={() => void decide(request.id, "approve")}
                  >
                    Approve credit
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || !(reasons[request.id] ?? "").trim()}
                    onClick={() => void decide(request.id, "reject")}
                  >
                    Reject request
                  </Button>
                </div>
              </>
            ) : (
              <p className="muted">
                {request.outcomeReason ??
                  request.decision?.reason ??
                  "The workflow is processing this request."}
              </p>
            )}
            {request.decision && (
              <p className="small muted">
                Decision: {request.decision.decision}. {request.decision.actor},{" "}
                {new Date(request.decision.at).toUTCString()}
              </p>
            )}
          </section>
        ))}
      </div>
      <a className="text-link back-link" href="/">
        Back to billing copilot
      </a>
    </main>
  );
}
