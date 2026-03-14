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
      setError("Enter a code to continue");
      return;
    }

    setIsLoading(true);
    setError("");

    await new Promise((r) => setTimeout(r, 600));

    onVerified({
      taskRabbitId: trimmedCode,
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Ambient glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.15),transparent_70%)]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-center py-8">
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2.5"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <span className="text-white font-bold text-sm">F</span>
          </div>
          <span className="text-[15px] font-medium tracking-tight">
            Fitted <span className="text-[#666]">×</span> TaskRabbit
          </span>
        </motion.div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-[380px]"
        >
          {/* Card */}
          <div className="card-elevated p-8">
            <div className="text-center mb-8">
              <h1 className="text-[22px] font-semibold tracking-tight mb-2">
                Customer Code
              </h1>
              <p className="text-[15px] text-[#888] leading-relaxed">
                Enter the code provided by the Fitted customer
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setError("");
                  }}
                  placeholder="ABC123"
                  className="input h-14 px-4 text-center text-xl font-mono tracking-[0.2em] placeholder:tracking-normal placeholder:text-[15px] placeholder:font-sans"
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 text-center text-[14px] text-red-400"
                >
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={isLoading || !code.trim()}
                className="btn btn-primary w-full h-12 rounded-xl text-[15px] font-medium"
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <Spinner />
                    <span>Verifying</span>
                  </div>
                ) : (
                  "Continue"
                )}
              </button>
            </form>
          </div>

          {/* Footer note */}
          <p className="text-center text-[13px] text-[#555] mt-6 px-4">
            Customers can find their upload code in the Fitted app under Profile → TaskRabbit
          </p>
        </motion.div>
      </main>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle 
        className="opacity-20" 
        cx="12" cy="12" r="10" 
        stroke="currentColor" 
        strokeWidth="3" 
      />
      <path 
        className="opacity-80" 
        fill="currentColor" 
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" 
      />
    </svg>
  );
}
