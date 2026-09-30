import { useEffect, useRef } from "react";
import { Badge, Button } from "@cloudflare/kumo";
import { type UIMessage } from "ai";
import {
  type PanelResponse,
  type CreateSandboxResponse
} from "../contracts/http";
import { ToolSchemas } from "../contracts/tools";
import { adminLink } from "./api";
import { describeError } from "./errors";
import { validatedTool, displayValues } from "./messages";

export function ErrorNotice({
  error,
  retry
}: {
  error: unknown;
  retry?: () => void;
}) {
  const view = describeError(error);
  return (
    <div className="error-notice" role="alert">
      <strong>{view.title}</strong>
      <p>{view.message}</p>
      {view.detail && <p>{view.detail}</p>}
      {retry && (
        <Button variant="secondary" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function CreditStatus({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
export function Messages({
  messages,
  approve,
  busy
}: {
  messages: UIMessage[];
  approve: (id: string, approved: boolean) => void;
  busy: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);
  return (
    <div
      ref={scroller}
      className="messages"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.map((message) => (
        <article className={`message message-${message.role}`} key={message.id}>
          <div className="message-author">
            {message.role === "user" ? "You" : "Billing copilot"}
          </div>
          {message.parts.map((part, index) => {
            if (part.type === "text")
              return (
                <p className="message-text" key={index}>
                  {part.text}
                </p>
              );
            const tool = validatedTool(part);
            if (!tool) return null;
            const { name, input, output } = tool;
            if (
              tool.part.state === "approval-requested" &&
              name === "startCreditRequest"
            ) {
              const claim = ToolSchemas.startCreditRequest.input.safeParse(
                tool.part.input
              );
              if (!claim.success)
                return (
                  <ErrorNotice
                    key={index}
                    error={new Error("Invalid credit confirmation")}
                  />
                );
              return (
                <section
                  className="confirmation"
                  key={index}
                  aria-label="Credit confirmation"
                >
                  <span className="eyebrow">YOUR CONFIRMATION</span>
                  <h3>Request a credit?</h3>
                  <p>
                    Invoice{" "}
                    <span className="identifier">{claim.data.invoiceId}</span>
                  </p>
                  <blockquote>{claim.data.reason}</blockquote>
                  <p>
                    This starts validation and an approval workflow. A human
                    must approve before any credit is applied.
                  </p>
                  <div className="button-row">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => approve(tool.part.approval!.id, true)}
                    >
                      Confirm request
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => approve(tool.part.approval!.id, false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </section>
              );
            }
            const invalid =
              (input && !input.success) || (output && !output.success);
            return (
              <div className="tool-evidence" key={index}>
                <Badge variant="secondary">{name}</Badge>
                <span>
                  {invalid
                    ? "Invalid tool data"
                    : tool.part.state === "output-available"
                      ? "Source verified"
                      : tool.part.state === "output-denied"
                        ? "Cancelled"
                        : tool.part.state === "output-error"
                          ? "Tool failed"
                          : "Working"}
                </span>
                {output?.success && (
                  <details>
                    <summary>View source values</summary>
                    <p>
                      {displayValues(output.data).join(" | ") ||
                        "Tool returned account or workflow information."}
                    </p>
                  </details>
                )}
                {tool.part.state === "output-error" && (
                  <p>{tool.part.errorText}</p>
                )}
              </div>
            );
          })}
        </article>
      ))}
    </div>
  );
}
export function InvoicePanel({
  panel,
  session,
  refresh,
  busy
}: {
  panel: PanelResponse;
  session: CreateSandboxResponse;
  refresh: () => void;
  busy: boolean;
}) {
  const invoice = panel.currentInvoice;
  return (
    <aside className="invoice-panel" aria-label="Invoice and audit panel">
      <div className="section-title">
        <h2>Account snapshot</h2>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={busy}>
          Refresh
        </Button>
      </div>
      <section className="invoice-card">
        <div className="section-title">
          <span className="eyebrow">CURRENT INVOICE</span>
          <span className="period">{invoice.period}</span>
        </div>
        <div className="invoice-total">{invoice.total.display}</div>
        <p>
          {panel.plan.name} plan <span className="separator">/</span>{" "}
          {panel.customerName}
        </p>
        <dl className="invoice-lines">
          {invoice.lines.map((line) => (
            <div key={line.id}>
              <dt>{line.description}</dt>
              <dd>{line.amount.display}</dd>
            </div>
          ))}
        </dl>
        <dl className="totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{invoice.subtotal.display}</dd>
          </div>
          <div>
            <dt>Credits</dt>
            <dd>{invoice.credits.display}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{invoice.tax.display}</dd>
          </div>
          <div className="total-row">
            <dt>Invoice total</dt>
            <dd>{invoice.total.display}</dd>
          </div>
        </dl>
        <div className="balance">
          <span>Ledger balance</span>
          <strong>{panel.balance.display}</strong>
        </div>
        <p className="small muted">
          The ledger balance includes posted debits and credits. It can differ
          from this issued invoice.
        </p>
      </section>
      <section className="panel-section">
        <div className="section-title">
          <h2>Credit requests</h2>
          <a
            className="text-link"
            href={adminLink(session)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Approver view
          </a>
        </div>
        {panel.creditRequests.length === 0 ? (
          <p className="muted">No credit requests yet.</p>
        ) : (
          panel.creditRequests.map((request) => (
            <div className="request-summary" key={request.id}>
              <div className="section-title">
                <strong>
                  {request.validatedAmount?.display ?? "Awaiting validation"}
                </strong>
                <CreditStatus status={request.status} />
              </div>
              <p>{request.customerReason}</p>
              {request.deadline && (
                <p className="small muted">
                  Approval deadline: {new Date(request.deadline).toUTCString()}
                </p>
              )}
              {request.outcomeReason && (
                <p className="small muted">{request.outcomeReason}</p>
              )}
            </div>
          ))
        )}
      </section>
      <section className="panel-section">
        <h2>Audit trail</h2>
        <p className="small muted">
          Newest first. Every change has an actor and a reason.
        </p>
        {panel.audit.length === 0 ? (
          <p className="muted">No audit records yet.</p>
        ) : (
          <ol className="audit-list">
            {[...panel.audit]
              .sort((a, b) => b.seq - a.seq)
              .map((record) => (
                <li key={record.seq}>
                  <span className="audit-dot" />
                  <strong>{record.action.replaceAll("_", " ")}</strong>
                  <p>{record.reason}</p>
                  <p className="small muted">
                    <time dateTime={record.at}>
                      {new Date(record.at).toUTCString()}
                    </time>
                    <br />
                    <span className="identifier">{record.actor}</span>
                  </p>
                  <details>
                    <summary>Record #{record.seq}</summary>
                    <p className="small identifier">
                      {record.subject.type}: {record.subject.id}
                    </p>
                    <pre>
                      {JSON.stringify(
                        { before: record.before, after: record.after },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                </li>
              ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
