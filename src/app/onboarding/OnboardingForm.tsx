"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { createFarmAction, joinFarmAction } from "@/server/actions";

type Mode = "create" | "join";

export function OnboardingForm() {
  const [mode, setMode] = useState<Mode>("create");

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
        <button
          type="button"
          className={`rounded-md py-2 text-sm font-semibold transition-colors ${
            mode === "create" ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
          }`}
          onClick={() => setMode("create")}
        >
          Create a farm
        </button>
        <button
          type="button"
          className={`rounded-md py-2 text-sm font-semibold transition-colors ${
            mode === "join" ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
          }`}
          onClick={() => setMode("join")}
        >
          Join a farm
        </button>
      </div>
      {mode === "create" ? <CreateFarmForm /> : <JoinFarmForm />}
    </div>
  );
}

function CreateFarmForm() {
  const router = useRouter();
  const [farmName, setFarmName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createFarmAction({ farmName, adminName, email, password });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (signInRes?.error) {
      setError("Farm created — sign in with your new account.");
      router.push("/login");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-ink-soft">
        You&apos;ll become the farm&apos;s admin, and can invite workers afterward from Settings.
      </p>
      <div>
        <label className="field-label" htmlFor="farmName">Farm name</label>
        <input
          id="farmName"
          className="input"
          autoFocus
          value={farmName}
          onChange={(e) => setFarmName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="field-label" htmlFor="adminName">Your name</label>
        <input
          id="adminName"
          className="input"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          className="input"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          className="input"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && (
        <p className="alert-stripe alert-stripe--critical rounded-md bg-overdue-soft px-3 py-2 text-sm text-overdue">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Setting up your farm…" : "Create farm"}
      </button>
    </form>
  );
}

function JoinFarmForm() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await joinFarmAction({ joinCode, name, email, password });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (signInRes?.error) {
      setError("Account created — sign in.");
      router.push("/login");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-ink-soft">
        Ask your farm&apos;s admin for the join code — they can find it under Settings.
      </p>
      <div>
        <label className="field-label" htmlFor="joinCode">Farm code</label>
        <input
          id="joinCode"
          className="input font-tag uppercase"
          autoFocus
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="field-label" htmlFor="workerName">Your name</label>
        <input
          id="workerName"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="field-label" htmlFor="workerEmail">Email</label>
        <input
          id="workerEmail"
          type="email"
          className="input"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="field-label" htmlFor="workerPassword">Password</label>
        <input
          id="workerPassword"
          type="password"
          className="input"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && (
        <p className="alert-stripe alert-stripe--critical rounded-md bg-overdue-soft px-3 py-2 text-sm text-overdue">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Joining…" : "Join farm"}
      </button>
    </form>
  );
}
