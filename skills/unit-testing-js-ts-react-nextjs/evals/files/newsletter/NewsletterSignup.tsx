"use client";

import { useState } from "react";
import { track } from "./analytics";
import { isValidEmail } from "./validation";

type Status = "idle" | "pending" | "subscribed" | "error";

export function NewsletterSignup({ listId }: { listId: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function subscribe() {
    if (!isValidEmail(email)) {
      setStatus("error");
      setMessage("Please enter a valid email");
      return;
    }
    setStatus("pending");
    const res = await fetch(`/api/lists/${listId}/subscribers`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      setStatus("subscribed");
      setMessage(`Thanks! Check ${email} to confirm.`);
      track("newsletter_subscribed", { listId });
    } else {
      setStatus("error");
      setMessage("Could not subscribe. Try again later.");
    }
  }

  if (status === "subscribed") return <p role="status">{message}</p>;

  return (
    <div className="newsletter">
      <label htmlFor="nl-email">Email</label>
      <input
        id="nl-email"
        data-testid="email-input"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        type="button"
        data-testid="subscribe-btn"
        onClick={subscribe}
        disabled={status === "pending"}
      >
        Subscribe
      </button>
      {status === "error" && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
    </div>
  );
}
