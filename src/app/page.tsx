"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import VerifyPage from "@/components/VerifyPage";
import UploadPage from "@/components/UploadPage";

export type AppStage = "verify" | "upload" | "success";

export interface VerifiedSession {
  taskRabbitId: string;
}

export default function App() {
  const [stage, setStage] = useState<AppStage>("verify");
  const [session, setSession] = useState<VerifiedSession | null>(null);
  const [result, setResult] = useState<{ itemCount: number; photoCount: number } | null>(null);

  if (stage === "success" && result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6 pb-safe">
        <div className="text-center max-w-sm w-full">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
            className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4"
          >
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            <h1 className="text-2xl font-bold mb-2">Done!</h1>
            <p className="text-base text-gray-400 mb-8">
              {result.itemCount} {result.itemCount === 1 ? "item" : "items"} uploaded to Fitted
            </p>
            <button
              onClick={() => {
                setStage("verify");
                setSession(null);
                setResult(null);
              }}
              className="w-full h-14 bg-black text-white text-base font-semibold rounded-xl active:scale-[0.98] transition-all"
            >
              Next customer
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  if (stage === "upload" && session) {
    return (
      <UploadPage
        session={session}
        onComplete={(r) => {
          setResult(r);
          setStage("success");
        }}
        onBack={() => setStage("verify")}
      />
    );
  }

  return (
    <VerifyPage
      onVerified={(s) => {
        setSession(s);
        setStage("upload");
      }}
    />
  );
}
