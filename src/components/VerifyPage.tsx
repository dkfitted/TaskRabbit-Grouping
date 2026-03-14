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

    await new Promise((r) => setTimeout(r, 500));

    onVerified({
      taskRabbitId: trimmedCode,
    });
  };

  return (
    <div className="min-h-screen bg-[#faf5f3] flex flex-col">
      {/* Simple header */}
      <header className="py-6 px-6">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-center gap-2"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm font-medium tracking-wide">FITTED</span>
        </motion.div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="bg-white rounded-3xl shadow-sm border border-neutral-100 p-8">
            <div className="text-center mb-8">
              <h1 className="text-xl font-semibold text-neutral-900 mb-2">
                Enter customer code
              </h1>
              <p className="text-sm text-neutral-500">
                Ask the Fitted customer for their upload code
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError("");
                }}
                placeholder="ABC123"
                className="w-full h-14 px-4 text-center text-xl font-mono tracking-[0.15em] bg-neutral-50 border border-neutral-200 rounded-2xl placeholder:text-neutral-300 placeholder:tracking-normal placeholder:text-base placeholder:font-sans focus:outline-none focus:border-neutral-900 focus:bg-white transition-all"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />

              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-3 text-center text-sm text-red-500"
                >
                  {error}
                </motion.p>
              )}

              <button
                type="submit"
                disabled={isLoading || !code.trim()}
                className="w-full h-12 mt-6 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Spinner />
                    Verifying
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-neutral-400 mt-6">
            Customers find their code in Profile → TaskRabbit Upload
          </p>
        </motion.div>
      </main>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
