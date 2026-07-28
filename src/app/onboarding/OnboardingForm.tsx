"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { redeemInviteAction } from "@/server/actions";

export function OnboardingForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
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
    const res = await redeemInviteAction({ code, farmName, adminName, email, password });
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
      <div>
        <label className="field-label" htmlFor="code">Invite code</label>
        <input
          id="code"
          className="input font-tag"
          autoFocus={!code}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="field-label" htmlFor="farmName">Farm name</label>
        <input
          id="farmName"
          className="input"
          autoFocus={!!code}
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
