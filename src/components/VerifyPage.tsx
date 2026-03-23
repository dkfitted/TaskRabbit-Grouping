"use client";

import { useState } from "react";
import type { VerifiedSession } from "@/app/page";

interface Props {
  onVerified: (data: VerifiedSession) => void;
}

export default function VerifyPage({ onVerified }: Props) {
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("Enter a code");
      return;
    }
    setIsLoading(true);
    setError("");
    await new Promise((r) => setTimeout(r, 400));
    onVerified({ taskRabbitId: trimmedCode });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-xs text-center">
        {/* Logo */}
        <div className="mb-8">
          <img src="/logo.png" alt="Fitted" className="h-10 mx-auto mb-2" />
          <p className="text-sm text-gray-500">TaskRabbit Upload</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError("");
            }}
            placeholder="Customer code"
            className="w-full h-12 px-4 text-center text-lg font-mono tracking-wider bg-gray-50 border border-gray-200 rounded-xl placeholder:text-gray-400 placeholder:font-sans placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            autoFocus
            autoComplete="off"
          />

          {error && (
            <p className="mt-2 text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading || !code.trim()}
            className="w-full h-12 mt-4 bg-black text-white font-medium rounded-xl disabled:opacity-40 hover:bg-gray-800 transition-colors"
          >
            {isLoading ? "..." : "Continue"}
          </button>
        </form>

        <p className="mt-6 text-xs text-gray-400">
          Customer's code is in Fitted app → Profile → TaskRabbit
        </p>
      </div>
    </div>
  );
}
