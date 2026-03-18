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
    <div className="min-h-screen flex items-center justify-center bg-[#F9F9F7] p-5">
      <div className="w-full max-w-sm animate-fade-up">

        {/* Card */}
        <div className="bg-white rounded-3xl border border-[#E8E8E5] p-8 sm:p-10 shadow-sm">

          {/* Logo */}
          <div className="flex justify-center mb-10">
            <img src="/logo.png" alt="Fitted" className="h-7" />
          </div>

          {/* Header */}
          <div className="mb-8">
            <h1 className="font-display text-[28px] font-bold leading-[1.15] text-[#0D0D0D] mb-3 tracking-tight">
              Enter customer<br />code
            </h1>
            <p className="text-[14px] text-[#8C8C8C] leading-relaxed">
              Ask the customer to open their Fitted app and share their TaskRabbit code with you.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError("");
                }}
                placeholder="ABC-1234"
                className={`w-full h-16 px-5 text-center text-2xl font-mono tracking-[0.2em] bg-[#F9F9F7] border rounded-2xl placeholder:text-[#CFCFCB] placeholder:tracking-[0.1em] placeholder:text-xl focus:outline-none transition-all duration-150 ${
                  error
                    ? "border-red-400 focus:border-red-500"
                    : "border-[#E8E8E5] focus:border-[#0D0D0D]"
                }`}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
              />
              {error && (
                <p className="mt-2.5 text-[13px] text-red-500 text-center font-medium">
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !code.trim()}
              className="w-full h-14 mt-1 bg-[#0D0D0D] text-white font-medium rounded-2xl disabled:opacity-30 hover:bg-black active:scale-[0.99] transition-all duration-150 text-[15px] tracking-[-0.01em] flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <span className="flex items-center gap-1.5">
                  <span className="dot-1 w-1.5 h-1.5 bg-white rounded-full inline-block" />
                  <span className="dot-2 w-1.5 h-1.5 bg-white rounded-full inline-block" />
                  <span className="dot-3 w-1.5 h-1.5 bg-white rounded-full inline-block" />
                </span>
              ) : (
                "Continue"
              )}
            </button>
          </form>
        </div>

        {/* Hint */}
        <p className="mt-5 text-center text-[12px] text-[#B0B0A8] leading-relaxed">
          Fitted app → Profile → TaskRabbit
        </p>

      </div>
    </div>
  );
}
