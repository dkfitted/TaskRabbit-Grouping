"use client";

import { useState } from "react";
import { motion } from "framer-motion";
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

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setCode(text.trim().toUpperCase());
        setError("");
      }
    } catch {
      // Clipboard API may not be available; fall back silently
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6 pb-safe">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="Fitted" className="h-[4.5rem] mb-3" />
          <p className="text-sm text-gray-400 font-medium tracking-wide uppercase">
            TaskRabbit Upload
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer code
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError("");
                }}
                placeholder="Paste or type code"
                className="flex-1 h-14 px-4 text-center text-lg font-mono tracking-wider bg-gray-50 border border-gray-200 rounded-xl placeholder:text-gray-300 placeholder:font-sans placeholder:tracking-normal placeholder:text-base focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-shadow"
                autoFocus
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handlePaste}
                className="h-14 w-14 flex-shrink-0 flex items-center justify-center bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
                aria-label="Paste from clipboard"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
              </button>
            </div>

            {error && (
              <p className="mt-2 text-sm text-red-500 font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading || !code.trim()}
              className="w-full h-14 mt-6 bg-black text-white text-base font-semibold rounded-xl disabled:opacity-30 active:scale-[0.98] transition-all"
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying
                </span>
              ) : (
                "Continue"
              )}
            </button>
          </form>
        </div>

        <p className="mt-5 text-xs text-gray-400 text-center leading-relaxed">
          Find code in Fitted app &rarr; Profile &rarr; TaskRabbit
        </p>
      </motion.div>
    </div>
  );
}
