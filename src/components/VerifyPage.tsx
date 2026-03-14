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
      setError("Please enter a code");
      return;
    }

    setIsLoading(true);
    setError("");

    // For now, accept any non-empty code
    // TODO: Add actual verification against Fitted backend
    await new Promise((r) => setTimeout(r, 800)); // Simulate verification

    onVerified({
      taskRabbitId: trimmedCode,
      customerName: undefined, // Could be fetched from backend
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mb-12"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
            <span className="text-zinc-900 font-bold text-lg">F</span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Fitted</h1>
            <p className="text-xs text-zinc-500 -mt-0.5">TaskRabbit Upload</p>
          </div>
        </div>
      </motion.div>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="w-full max-w-sm"
      >
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
          <h2 className="text-2xl font-semibold text-center mb-2">
            Enter Customer Code
          </h2>
          <p className="text-zinc-400 text-center text-sm mb-8">
            Ask the customer for their Fitted upload code
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError("");
                }}
                placeholder="e.g. ABC123"
                className="w-full px-4 py-4 bg-zinc-800 border border-zinc-700 rounded-2xl text-center text-2xl font-mono tracking-[0.3em] placeholder:text-zinc-600 placeholder:tracking-normal placeholder:text-base focus:outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 transition-all"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-sm text-center"
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={isLoading || !code.trim()}
              className="w-full py-4 bg-white text-zinc-900 font-semibold rounded-2xl hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Spinner />
                  Verifying...
                </>
              ) : (
                "Continue"
              )}
            </button>
          </form>
        </div>

        {/* Help text */}
        <p className="text-zinc-600 text-xs text-center mt-6">
          The customer can find their code in the Fitted app under Settings → TaskRabbit Upload
        </p>
      </motion.div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
