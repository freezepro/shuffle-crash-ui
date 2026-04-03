"use client";

import { useState } from "react";
import { apiUrl } from "../lib/apiBase";

const AUTH_URL = apiUrl("/auth/login");
const AUTH_KEY = "crash_auth";

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [passed, setPassed] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const password = (form.elements.namedItem("password") as HTMLInputElement)?.value || "";

    try {
      setLoading(true);
      const res = await fetch(AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        setPassed(true);
        localStorage.setItem(AUTH_KEY, "1");
      } else {
        alert("❌ Wrong password");
      }
    } catch {
      alert("❌ Wrong password");
    } finally {
      setLoading(false);
    }
  };

  if (!passed && typeof window !== "undefined" && localStorage.getItem(AUTH_KEY) === "1") {
    setPassed(true);
  }

  if (passed) return <>{children}</>;

  return (
    <div style={styles.wrap}>
      <form onSubmit={submit} style={styles.box}>
        <p style={styles.subtitle}>Enter password</p>
        <input name="password" type="password" placeholder="Password" style={styles.input} />
        <button style={styles.button} disabled={loading}>
          {loading ? "Checking..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1a1d25",
  },
  box: {
    background: "#222",
    padding: 30,
    borderRadius: 12,
    width: 350,
    display: "flex",
    flexDirection: "column",
    gap: 15,
    boxShadow: "0 4px 15px rgba(0,0,0,0.4)",
    textAlign: "center",
  },
  subtitle: {
    fontSize: "14px",
    color: "#aaa",
    margin: 0,
    marginBottom: 10,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    border: "1px solid #444",
    background: "#111",
    color: "white",
    fontSize: "14px",
  },
  button: {
    padding: 12,
    borderRadius: 8,
    background: "#3a7bfd",
    border: "none",
    color: "white",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "15px",
    marginTop: 5,
  },
};
