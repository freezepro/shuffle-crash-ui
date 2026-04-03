"use client";

import { useState } from "react";
import { apiUrl } from "../lib/apiBase";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleLogin(e: any) {
    e.preventDefault();
    setError("");

    const url = apiUrl("/auth/login");

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Login failed");
      return;
    }

    // save token in cookie
    document.cookie = `crash_token=${data.token}; path=/; max-age=2592000`;

    window.location.href = "/dashboard";
  }

  return (
    <form
      onSubmit={handleLogin}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        maxWidth: 320,
      }}
    >
      <input
        type="password"
        placeholder="Введіть пароль"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          outline: "none",
          background: "#0f172a",
          color: "white",
          border: "1px solid #1e293b",
        }}
      />

      {error && (
        <div style={{ color: "#ef4444", fontSize: 12, marginBottom: -6 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        style={{
          background: "#22c55e",
          borderRadius: 8,
          padding: "10px 0",
          border: "none",
          color: "black",
          fontWeight: 600,
        }}
      >
        Увійти
      </button>
    </form>
  );
}
